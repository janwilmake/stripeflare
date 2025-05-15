import { Stripe } from "stripe";
import { createClient, DORM, type Records } from "dormroom";
import { decryptToken, encryptToken } from "./encypt-decrypt-js";

// Export DORM for it to be accessible
export { DORM };

export interface Env {
  DORM_NAMESPACE: DurableObjectNamespace<DORM>;
  DB_SECRET: string;
  STRIPE_WEBHOOK_SIGNING_SECRET: string;
  STRIPE_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  SKIP_LOGIN?: string;
}

export type StripeUser = {
  name: string | null;
  access_token: string;
  balance: number;
  email: string | null;
  client_reference_id: string;
};

type Migrations = { [version: number]: string[] };

export interface MiddlewareResult<T extends StripeUser> {
  response?: Response;
  user?: T;
  headers?: Headers;
}

const parseCookies = (cookieHeader: string): Record<string, string> => {
  const cookies: Record<string, string> = {};
  cookieHeader.split(";").forEach((cookie) => {
    const [name, value] = cookie.split("=").map((c) => c.trim());
    if (name && value) {
      cookies[name] = value;
    }
  });
  return cookies;
};

const streamToBuffer = async (
  readableStream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  const reader = readableStream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);

  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }

  return result;
};

export async function stripeBalanceMiddleware<T extends StripeUser>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  /**
   * Your database migrations. Required user-table columns (preferably all indexed): `CREATE TABLE users ( access_token TEXT PRIMARY KEY, balance INTEGER DEFAULT 0, email TEXT, name TEXT, client_reference_id )`.
   */
  migrations: Migrations,
  version: string = "v-verified_user_access_token",
): Promise<MiddlewareResult<T>> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Handle Stripe webhook
  if (path === "/stripe-webhook") {
    const webhookResponse = await handleStripeWebhook(
      request,
      env,
      ctx,
      migrations,
      version,
    );
    return { response: webhookResponse };
  }

  // Handle database API access
  if (path.startsWith("/aggregate/")) {
    const dbResponse = await handleDatabaseAPI(
      request,
      env,
      ctx,
      migrations,
      version,
    );
    if (dbResponse) {
      return { response: dbResponse };
    }
  }

  // Handle user session
  const headers = new Headers();
  const { user } = await handleUserSession<T>(
    request,
    env,
    ctx,
    url,
    headers,
    migrations,
    version,
  );

  return { user, headers };
}

async function handleStripeWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  migrations: Migrations,
  version: string,
): Promise<Response> {
  if (!request.body) {
    return new Response(JSON.stringify({ error: "No body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rawBody = await streamToBuffer(request.body);
  const rawBodyString = new TextDecoder().decode(rawBody);

  const stripe = new Stripe(env.STRIPE_SECRET, {
    apiVersion: "2025-03-31.basil",
  });

  const stripeSignature = request.headers.get("stripe-signature");
  if (!stripeSignature) {
    return new Response(JSON.stringify({ error: "No signature" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBodyString,
      stripeSignature,
      env.STRIPE_WEBHOOK_SIGNING_SECRET,
    );
  } catch (err) {
    console.log("WEBHOOK ERR", err.message);
    return new Response(`Webhook error: ${String(err)}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    console.log("CHECKOUT COMPLETED");
    const session = event.data.object;

    if (session.payment_status !== "paid" || !session.amount_total) {
      return new Response("Payment not completed", { status: 400 });
    }

    const {
      client_reference_id,
      customer_details,
      amount_total,
      customer,
      customer_creation,
      customer_email,
    } = session;

    if (!client_reference_id || !customer_details?.email) {
      return new Response("Missing required data", { status: 400 });
    }

    let access_token: string | undefined = undefined;
    try {
      access_token = await decryptToken(client_reference_id, env.DB_SECRET);
    } catch (e) {
      return new Response("Could not decrypt client_reference_id", {
        status: 400,
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(
      session.payment_intent as string,
    );

    // const charge = await stripe.charges.retrieve('')
    const { payment_method_details } = await stripe.charges.retrieve(
      paymentIntent.latest_charge as string,
    );

    const card_fingerprint = payment_method_details?.card?.fingerprint;

    const verified_email =
      payment_method_details?.type === "link"
        ? customer_details.email
        : undefined;

    if (verified_email || card_fingerprint) {
      const aggregateClient = createClient({
        doNamespace: env.DORM_NAMESPACE,
        version,
        migrations,
        ctx,
        name: "aggregate",
      });

      const userFromEmail = verified_email
        ? (
            await aggregateClient
              .exec<StripeUser>(
                "SELECT access_token FROM users WHERE verified_email = ?",
                verified_email,
              )
              .toArray()
          )[0]
        : undefined;
      const userFromFingerprint = card_fingerprint
        ? (
            await aggregateClient
              .exec<StripeUser>(
                "SELECT access_token FROM users WHERE card_fingerprint = ?",
                card_fingerprint,
              )
              .toArray()
          )[0]
        : undefined;

      const already_access_token =
        userFromEmail?.access_token || userFromFingerprint?.access_token;

      if (already_access_token) {
        if (already_access_token !== access_token) {
          console.warn(
            "There was another user found with this email and/or card fingerprint. We could supply additional logic here to tranfer the funds already present on that user to the new access token.",
            { verified_email, card_fingerprint },
          );
        } else {
          console.log(
            "Also found the same user through email/fingerprint, but it's the same user!",
            { verified_email, card_fingerprint },
          );
        }
        /**Proposed logic:
         - if the user at access_token had no previous payments, remove the other user and place it at this user.
         - if the user at access_token did have previous payments, do not remove the other user, and do not tranfer anything. we can assume the user paid for someone else.*/
      }
    }

    // Create client for specific user with mirror to aggregate
    const userClient = createClient({
      doNamespace: env.DORM_NAMESPACE,
      version,
      migrations,
      ctx,
      name: access_token,
      mirrorName: "aggregate",
    });

    // Check if user exists
    const existingUser = await userClient
      .exec<StripeUser>(
        "SELECT * FROM users WHERE access_token = ?",
        access_token,
      )
      .one()
      .catch(() => null);

    if (existingUser) {
      // User exists, update balance and email, and optionally name
      if (existingUser.name) {
        // User already has a name, don't update it
        await userClient
          .exec(
            "UPDATE users SET balance = balance + ?, email = ? WHERE access_token = ?",
            amount_total,
            customer_details.email,
            access_token,
          )
          .toArray();
      } else {
        // User doesn't have a name, update it if available
        await userClient
          .exec(
            "UPDATE users SET balance = balance + ?, email = ?, name = ? WHERE access_token = ?",
            amount_total,
            customer_details.email,
            customer_details.name || null,
            access_token,
          )
          .toArray();
      }
    } else {
      // User doesn't exist, create new user
      await userClient
        .exec(
          "INSERT INTO users (access_token, balance, email, verified_email, card_fingerprint, name, client_reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          access_token,
          amount_total,
          customer_details.email,
          verified_email || null,
          card_fingerprint || null,
          customer_details.name || null,
          client_reference_id,
        )
        .toArray();
    }

    return new Response("Payment processed successfully", { status: 200 });
  }

  return new Response("Event not handled", { status: 200 });
}

async function handleDatabaseAPI(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  migrations: Migrations,
  version: string,
): Promise<Response | undefined> {
  const aggregateClient = createClient({
    doNamespace: env.DORM_NAMESPACE,
    version,
    migrations,
    ctx,
    name: "aggregate",
  });

  const middlewareResponse = await aggregateClient.middleware(request, {
    prefix: "/aggregate",
    secret: env.DB_SECRET,
  });

  return middlewareResponse;
}

async function handleUserSession<T extends StripeUser>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  headers: Headers,
  migrations: Migrations,
  version: string,
): Promise<{ user: T }> {
  const cookieHeader = request.headers.get("Cookie");
  const cookies = cookieHeader ? parseCookies(cookieHeader) : {};

  let accessToken = cookies.access_token;
  let user: T | null = null;

  // Try to get existing user
  if (accessToken) {
    // NB: this takes some ms for cold starts because a global lookup is done and new db is created for the accessToken, and happens for every user. Therefore there will be tons of tiny DOs without data, which we should clean up later.
    const userClient = createClient({
      doNamespace: env.DORM_NAMESPACE,
      version,
      migrations,
      ctx,
      name: accessToken,
      mirrorName: "aggregate",
    });

    try {
      user = await userClient
        .exec<T>("SELECT * FROM users WHERE access_token = ?", accessToken)
        .one();
    } catch {
      // User not found, will create new one
    }
  }

  if (!user) {
    // Provide user with clientReferenceId without creating it
    const uuidGeneralRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!accessToken || !accessToken.match(uuidGeneralRegex)) {
      accessToken = crypto.randomUUID();
    }
    const clientReferenceId = await encryptToken(accessToken, env.DB_SECRET);

    user = {
      access_token: accessToken,
      balance: 0,
      email: null,
      client_reference_id: clientReferenceId,
    } as T;

    // Set cookie
    const skipLogin = env.SKIP_LOGIN === "true";
    const securePart = skipLogin ? "" : " Secure;";
    const domainPart = skipLogin ? "" : ` Domain=${url.hostname};`;
    const cookieSuffix = `;${domainPart} HttpOnly; Path=/;${securePart} Max-Age=34560000; SameSite=Lax`;

    headers.append(
      "Set-Cookie",
      `access_token=${user.access_token}${cookieSuffix}`,
    );
  }

  return { user };
}
