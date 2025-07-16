import { ExecutionContext } from "@cloudflare/workers-types";
import { Stripe } from "stripe";
import { createClient, DORMClient } from "dormroom";
import { decryptToken, encryptToken } from "./encrypt-decrypt-js";
import { DurableObject } from "cloudflare:workers";
import { Queryable, QueryableHandler } from "queryable-object";
import { Migratable } from "migratable-object";
// Export DORM for it to be accessible
export { createClient };

@Migratable({
  migrations: {
    1: [
      `CREATE TABLE users (
      access_token TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      name TEXT,
      email TEXT,
      verified_email TEXT,
      verified_user_access_token TEXT,
      card_fingerprint TEXT,
      client_reference_id TEXT
    )`,
      `CREATE INDEX idx_users_balance ON users(balance)`,
      `CREATE INDEX idx_users_name ON users(name)`,
      `CREATE INDEX idx_users_email ON users(email)`,
      `CREATE INDEX idx_users_verified_email ON users(verified_email)`,
      `CREATE INDEX idx_users_card_fingerprint ON users(card_fingerprint)`,
      `CREATE INDEX idx_users_client_reference_id ON users(client_reference_id)`,
    ],
  },
})
@Queryable()
export class DORM extends DurableObject {
  sql: SqlStorage;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.env = env;
  }
}

const AGGREGATE_NAME = "admin-readonly";
const DO_PREFIX = "user-";

export interface Env {
  DORM_NAMESPACE: DurableObjectNamespace<DORM & QueryableHandler>;
  DB_SECRET: string;
  STRIPE_WEBHOOK_SIGNING_SECRET: string;
  STRIPE_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_PAYMENT_LINK: string;
  SKIP_LOGIN?: string;
}

export type StripeUser = {
  access_token: string;
  verified_user_access_token: string | null;
  // public
  client_reference_id: string;
  name: string | null;
  balance: number;
  email: string | null;
  card_fingerprint: string | null;
  verified_email: string | null;
};

type StripeflareClient = DORMClient<DORM & QueryableHandler>;

export type MiddlewareResult<T extends StripeUser> =
  | {
      type: "response";
      response?: Response;
    }
  | {
      type: "session";
      user: T;
      headers: { [key: string]: string };
      client: StripeflareClient;
      paymentLink: string;
      registered: boolean;
      charge: (
        amountCent: number,
        allowNegativeBalance: boolean
      ) => Promise<{
        charged: boolean;
        message: string;
      }>;
    };

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
  readableStream: ReadableStream<Uint8Array>
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

const getClientReferenceId = async (
  access_token: string,
  secret: string
): Promise<string> => {
  return await encryptToken(access_token, secret);
};

const getDOName = (client_reference_id: string): string => {
  return DO_PREFIX + client_reference_id;
};

export async function stripeBalanceMiddleware<T extends StripeUser>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  version: string = "1"
): Promise<MiddlewareResult<T>> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (
    !env.DB_SECRET ||
    !env.STRIPE_PAYMENT_LINK ||
    !env.STRIPE_PUBLISHABLE_KEY ||
    !env.STRIPE_SECRET ||
    !env.STRIPE_WEBHOOK_SIGNING_SECRET
  ) {
    return {
      type: "response",
      response: new Response(
        "Not all stripeflare environment variables have been set up. Please set your secrets and restart your worker",
        { status: 500 }
      ),
    };
  }

  if (path === "/rotate-token") {
    const rotateResponse = await handleTokenRotation(
      request,
      env,
      ctx,
      version
    );
    return { type: "response", response: rotateResponse };
  }

  // Handle Stripe webhook
  if (path === "/stripe-webhook") {
    const webhookResponse = await handleStripeWebhook(
      request,
      env,
      ctx,
      version
    );
    return { type: "response", response: webhookResponse };
  }

  // Handle database API access
  if (path.startsWith("/db/")) {
    const nameParam = path.split("/")[2];

    let doName: string;
    let secret: string;

    if (nameParam === AGGREGATE_NAME) {
      doName = AGGREGATE_NAME;
      secret = env.DB_SECRET;
    } else {
      // nameParam should be a client_reference_id
      doName = getDOName(nameParam);
      // Decrypt the client_reference_id to get the access_token for the secret
      secret = await decryptToken(nameParam, env.DB_SECRET);
    }

    const client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      configs: [
        { name: `${version}-${doName}` },
        nameParam === AGGREGATE_NAME
          ? { name: `${version}-${AGGREGATE_NAME}` }
          : undefined,
      ],
    });

    const middlewareResponse = await client.middleware(request, {
      prefix: "/db/" + nameParam,
      basicAuth: {
        username: doName,
        password: secret,
      },
    });

    if (middlewareResponse) {
      return { type: "response", response: middlewareResponse };
    }
  }

  // Handle user session
  const { user, client, headers } = await handleUserSession<T>(
    request,
    env,
    ctx,
    url,
    version
  );

  const paymentLink = user.client_reference_id
    ? env.STRIPE_PAYMENT_LINK +
      "?client_reference_id=" +
      encodeURIComponent(user.client_reference_id)
    : undefined;
  const registered = !!user.email;

  if (path === "/me") {
    // NB: Can't put out access_token generally because it's a security leak to expose that to apps that run untrusted code.
    const {
      access_token,
      verified_user_access_token,
      client_reference_id,
      ...publicUser
    } = user || {};

    return {
      type: "response",

      response: new Response(
        JSON.stringify(
          { ...publicUser, client_reference_id, paymentLink, registered },
          undefined,
          2
        ),
        { headers }
      ),
    };
  }

  const charge = async (amountCent: number, allowNegativeBalance: boolean) => {
    if (!client || !user.access_token) {
      return {
        charged: false,
        message: "User is not signed up yet and cannot be charged",
      };
    }

    const result = allowNegativeBalance
      ? await client.exec(
          "UPDATE users SET balance = balance - ? WHERE access_token = ?",
          amountCent,
          user.access_token
        )
      : await client.exec(
          "UPDATE users SET balance = balance - ? WHERE access_token = ? and balance >= ?",
          amountCent,
          user.access_token,
          amountCent
        );

    if (result.rowsWritten === 0) {
      return { charged: false, message: "User balance too low" };
    }

    return { charged: true, message: "Successfully charged" };
  };

  return {
    type: "session",
    user,
    headers,
    client,
    charge,
    paymentLink,
    registered,
  };
}

async function handleStripeWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  version: string
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
      env.STRIPE_WEBHOOK_SIGNING_SECRET
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
      payment_link,
    } = session;

    if (!client_reference_id) {
      return new Response("Missing client_reference_id", { status: 400 });
    }

    if (!customer_details?.email) {
      return new Response("Missing customer_details.email", { status: 400 });
    }

    if (!env.DB_SECRET) {
      return new Response("Missing DB_SECRET", { status: 400 });
    }

    let access_token: string | undefined = undefined;
    try {
      access_token = await decryptToken(client_reference_id, env.DB_SECRET);
    } catch (e) {
      return new Response(
        "Could not decrypt client_reference_id. Assuming this event is not meant for this webhook.",
        {
          status: 200,
        }
      );
    }

    const aggregateClient = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      configs: [{ name: `${version}-${AGGREGATE_NAME}` }],
    });

    // check if we already have a user with this details
    const userResult: { one: StripeUser } = await aggregateClient.exec(
      "SELECT * FROM users WHERE access_token = ?",
      access_token
    );

    const userFromAccessToken = userResult.one || null;

    const doName = getDOName(client_reference_id);

    if (userFromAccessToken) {
      // existing user found at this access_token, just add balance
      const client = createClient({
        doNamespace: env.DORM_NAMESPACE,
        ctx,
        configs: [
          { name: `${version}-${doName}` },
          { name: `${version}-${AGGREGATE_NAME}` },
        ],
      });

      await client.exec(
        "UPDATE users SET balance = balance + ?, email = ?, name = ? WHERE access_token = ?",
        amount_total,
        customer_details.email,
        customer_details.name || null,
        access_token
      );

      return new Response("Payment processed successfully", { status: 200 });
    }

    // no existing user. Check which user we need to insert it into:
    const paymentIntent = await stripe.paymentIntents.retrieve(
      session.payment_intent as string
    );

    // const charge = await stripe.charges.retrieve('')
    const { payment_method_details } = await stripe.charges.retrieve(
      paymentIntent.latest_charge as string
    );

    const card_fingerprint = payment_method_details?.card?.fingerprint;

    const verified_email =
      payment_method_details?.type === "link"
        ? customer_details.email
        : undefined;

    const userFromEmailResult: { one: { access_token: string } } | null =
      verified_email
        ? await aggregateClient.exec(
            "SELECT access_token FROM users WHERE verified_email = ?",
            verified_email
          )
        : null;

    const userFromEmail = userFromEmailResult?.one;

    const userFromFingerprintResult = card_fingerprint
      ? await aggregateClient.exec(
          "SELECT access_token FROM users WHERE card_fingerprint = ?",
          card_fingerprint
        )
      : null;

    const userFromFingerprint = userFromFingerprintResult?.one;

    const verified_user_access_token =
      userFromEmail?.access_token || userFromFingerprint?.access_token;

    if (!verified_user_access_token) {
      // user did not exist and there was no alternate access token found. Let's create the user under the provided access token!

      const client = createClient({
        doNamespace: env.DORM_NAMESPACE,
        ctx,
        configs: [
          { name: `${version}-${doName}` },
          { name: `${version}-${AGGREGATE_NAME}` },
        ],
      });

      await client.exec(
        "INSERT INTO users (access_token, balance, email, verified_email, card_fingerprint, name, client_reference_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        access_token,
        amount_total,
        customer_details.email,
        verified_email || null,
        card_fingerprint || null,
        customer_details.name || null,
        client_reference_id
      );

      return new Response("Payment processed successfully", { status: 200 });
    }

    const isAlternateAccessToken = verified_user_access_token !== access_token;

    if (!isAlternateAccessToken) {
      return new Response(
        "Found the user even though 'userFromAccessToken' was not found. Data might be corrupt",
        { status: 500 }
      );
    }

    // There is an alternate access token found, and the current access_token did not have a user tied to it yet.
    // We should set `verified_user_access_token` on this user, and add the balance to the alternate user.
    // The access_token of will be switched to the verified_user_access_token at a later point

    const client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      configs: [
        { name: `${version}-${doName}` },
        { name: `${version}-${AGGREGATE_NAME}` },
      ],
    });

    await client.exec(
      "INSERT INTO users (access_token, verified_user_access_token) VALUES (?, ?)",
      access_token,
      verified_user_access_token
    );

    const verifiedUserClientReferenceId = await getClientReferenceId(
      verified_user_access_token,
      env.DB_SECRET
    );
    const verifiedUserDOName = getDOName(verifiedUserClientReferenceId);

    const verifiedUserClient = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      configs: [
        { name: `${version}-${verifiedUserDOName}` },
        { name: `${version}-${AGGREGATE_NAME}` },
      ],
    });

    // Add the balance to the verified user
    await verifiedUserClient.exec(
      "UPDATE users SET balance = balance + ?, email = ?, name = ? WHERE access_token = ?",
      amount_total,
      customer_details.email,
      customer_details.name || null,
      verified_user_access_token
    );

    return new Response("Payment processed successfully", { status: 200 });
  }

  return new Response("Event not handled", { status: 200 });
}

/**
 * Adds simple token rotation. NB: this deletes the old user and creates a new one with same balance, setting the cookie.
 *
 * Limitation: if the user has other state or user columns on their durable object, this won't be enough!
 */
async function handleTokenRotation(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  version: string
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Get current session
  const { user, client } = await handleUserSession(
    request,
    env,
    ctx,
    new URL(request.url),
    version
  );

  if (!client || !user.access_token) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Generate new access token
  const newAccessToken = crypto.randomUUID();
  const newClientReferenceId = await encryptToken(
    newAccessToken,
    env.DB_SECRET
  );
  const newDOName = getDOName(newClientReferenceId);

  // Create new user client
  const newUserClient = createClient({
    doNamespace: env.DORM_NAMESPACE,
    ctx,
    configs: [
      { name: `${version}-${newDOName}` },
      { name: `${version}-${AGGREGATE_NAME}` },
    ],
  });

  try {
    // Copy user data to new access token
    await newUserClient.exec(
      `INSERT INTO users (
        access_token, balance, email, verified_email, 
        card_fingerprint, name, client_reference_id, verified_user_access_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      newAccessToken,
      user.balance,
      user.email,
      user.verified_email,
      user.card_fingerprint,
      user.name,
      newClientReferenceId,
      null // Clear verified_user_access_token for the new token
    );

    // Delete old user data
    await client.exec(
      "DELETE FROM users WHERE access_token = ?",
      user.access_token
    );

    // Set new cookie
    const url = new URL(request.url);
    const skipLogin = env.SKIP_LOGIN === "true";
    const securePart = skipLogin ? "" : " Secure;";
    const domainPart = skipLogin ? "" : ` Domain=${url.hostname};`;
    const cookieSuffix = `;${domainPart} HttpOnly; Path=/;${securePart} Max-Age=34560000; SameSite=Lax`;

    return new Response(
      JSON.stringify({
        success: true,
        message: "Token rotated successfully",
        // Don't return the new token in response for security
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": `access_token=${newAccessToken}${cookieSuffix}`,
        },
      }
    );
  } catch (error) {
    // If something goes wrong, clean up the new token
    try {
      await newUserClient.exec(
        "DELETE FROM users WHERE access_token = ?",
        newAccessToken
      );
    } catch (cleanupError) {
      console.error("Failed to cleanup after rotation error:", cleanupError);
    }

    return new Response(JSON.stringify({ error: "Failed to rotate token" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleUserSession<T extends StripeUser>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  version: string
): Promise<{
  user: T;
  client: StripeflareClient | undefined;
  /** The set-cookie header(s) */
  headers: { [key: string]: string };
}> {
  const cookieHeader = request.headers.get("Cookie");
  const authorizationHeader = request.headers.get("Authorization");
  const bearerToken = authorizationHeader?.toLowerCase()?.startsWith("bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : undefined;

  const cookies = cookieHeader ? parseCookies(cookieHeader) : {};

  let accessToken = bearerToken || cookies.access_token;
  let user: T | null = null;
  let client: StripeflareClient | undefined = undefined;

  // Try to get existing user
  if (accessToken) {
    const clientReferenceId = await getClientReferenceId(
      accessToken,
      env.DB_SECRET
    );
    const doName = getDOName(clientReferenceId);

    // NB: this takes some ms for cold starts because a global lookup is done and new db is created for the clientReferenceId, and happens for every user. Therefore there will be tons of tiny DOs without data, which we should clean up later.

    client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      configs: [
        { name: `${version}-${doName}` },
        { name: `${version}-${AGGREGATE_NAME}` },
      ],
    });

    try {
      const userResult: { one: T } = await client.exec(
        "SELECT * FROM users WHERE access_token = ?",
        accessToken
      );
      user = userResult.one;

      if (user?.verified_user_access_token) {
        // update access_token
        accessToken = user.verified_user_access_token;

        // we should switch to this one!!!
        const verifiedClientReferenceId = await getClientReferenceId(
          accessToken,
          env.DB_SECRET
        );
        const verifiedDOName = getDOName(verifiedClientReferenceId);

        client = createClient({
          doNamespace: env.DORM_NAMESPACE,
          ctx,
          configs: [
            { name: `${version}-${verifiedDOName}` },
            { name: `${version}-${AGGREGATE_NAME}` },
          ],
        });

        const verifiedUserResult: { one: T } = await client.exec(
          "SELECT * FROM users WHERE access_token = ?",
          accessToken
        );
        user = verifiedUserResult.one;
      }

      if (user) {
        let client_reference_id = await encryptToken(
          accessToken,
          env.DB_SECRET
        );

        if (user.client_reference_id !== client_reference_id) {
          // ensure to overwrite client_reference_id incase we have a new DB_SECRET
          user.client_reference_id = client_reference_id;

          await client.exec(
            "UPDATE users SET client_reference_id = ? WHERE access_token = ?",
            client_reference_id,
            accessToken
          );
        }
      }
    } catch {
      client = undefined;
      user = null;
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
    const client_reference_id = await encryptToken(accessToken, env.DB_SECRET);

    user = {
      access_token: accessToken,
      balance: 0,
      email: null,
      client_reference_id,
    } as T;
  }

  // Set cookie
  const skipLogin = env.SKIP_LOGIN === "true";
  const securePart = skipLogin ? "" : " Secure;";
  const domainPart = skipLogin ? "" : ` Domain=${url.hostname};`;
  const cookieSuffix = `;${domainPart} HttpOnly; Path=/;${securePart} Max-Age=34560000; SameSite=Lax`;
  const headers = {
    "Set-Cookie": `access_token=${user.access_token}${cookieSuffix}`,
  };

  return { user, client, headers };
}

// https://letmeprompt.com/httpspastebincon-bthl4d0
interface StripeflareContext<T extends StripeUser = StripeUser>
  extends ExecutionContext {
  user: T;
  client?: StripeflareClient;
  registered: boolean;
  paymentLink: string;
  charge: (
    amountCent: number,
    allowNegativeBalance: boolean
  ) => Promise<{
    charged: boolean;
    message: string;
  }>;
}

interface StripeflareFetchHandler<
  T extends StripeUser = StripeUser,
  TEnv = {}
> {
  (request: Request, env: Env & TEnv, ctx: StripeflareContext<T>):
    | Response
    | Promise<Response>;
}

interface StripeflareConfig {
  /**  changing the version will "reset" the dbs by using other prefix to the DO-names */
  version?: string;
}

export function withStripeflare<
  TEnv = {},
  TUser extends StripeUser = StripeUser
>(
  handler: StripeflareFetchHandler<TUser, TEnv>,
  config?: StripeflareConfig
): ExportedHandlerFetchHandler<Env & TEnv> {
  const { version } = config || {};

  return async (
    request: Request,
    env: TEnv & Env,
    ctx: ExecutionContext
  ): Promise<Response> => {
    // Apply the stripe balance middleware
    const middlewareResult = await stripeBalanceMiddleware<TUser>(
      request,
      env,
      ctx,
      version
    );

    // If middleware returns a response, return it directly (webhooks, auth endpoints, etc.)
    if (middlewareResult.type === "response") {
      return (
        middlewareResult.response ||
        new Response("Internal Error", { status: 500 })
      );
    }

    const { user, charge, client, paymentLink, registered, headers } =
      middlewareResult;

    // Create enhanced context with user and charge function
    const enhancedCtx: StripeflareContext<TUser> = {
      passThroughOnException: () => ctx.passThroughOnException(),
      props: ctx.props,
      waitUntil: (promise: Promise<any>) => ctx.waitUntil(promise),
      user,
      charge,
      client,
      paymentLink,
      registered,
    };

    // Call the user's fetch handler
    const response = await handler(request, env, enhancedCtx);

    // Merge any headers from middleware (like Set-Cookie) with the response
    if (headers) {
      const newHeaders = new Headers(response.headers);
      Object.entries(headers).forEach(([key, value]) => {
        newHeaders.set(key, value);
      });

      const price =
        response.headers.get("x-price") &&
        !isNaN(Number(response.headers.get("x-price")))
          ? Number(response.headers.get("x-price"))
          : undefined;

      let balance = user.balance;

      if (price && price > 0) {
        // charge user and update balance
        const { charged, message } = await charge(price, true);
        if (charged) {
          balance = balance - price;
        } else {
          console.error("Unexpected: Could not charge user!", message);
        }
      }

      newHeaders.set("x-payment-link", paymentLink);
      if (!response.headers.get("X-Balance")) {
        newHeaders.set("X-Balance", String(balance));
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }

    return response;
  };
}

/** Helper function to charge a user based on their access_token */
export const chargeUser = async (
  env: Env,
  ctx: ExecutionContext,
  user_access_token: string,
  version: string,
  amountCent: number,
  allowNegativeBalance: boolean
) => {
  const clientReferenceId = await getClientReferenceId(
    user_access_token,
    env.DB_SECRET
  );
  const doName = getDOName(clientReferenceId);

  const client = createClient({
    doNamespace: env.DORM_NAMESPACE,
    ctx,
    configs: [
      { name: `${version}-${doName}` },
      { name: `${version}-${AGGREGATE_NAME}` },
    ],
  });

  if (!client || !user_access_token) {
    return {
      charged: false,
      message: "User is not signed up yet and cannot be charged",
    };
  }

  const result = allowNegativeBalance
    ? await client.exec(
        "UPDATE users SET balance = balance - ? WHERE access_token = ?",
        amountCent,
        user_access_token
      )
    : await client.exec(
        "UPDATE users SET balance = balance - ? WHERE access_token = ? and balance >= ?",
        amountCent,
        user_access_token,
        amountCent
      );

  if (result.rowsWritten === 0) {
    return { charged: false, message: "User balance too low" };
  }
  return { charged: true, message: "Successfully charged" };
};
