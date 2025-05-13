import { Stripe } from "stripe";
import { createClient, DORM, DORMClient, type Records } from "dormroom";
import indexHtml from "./index.html";

// Export DORM for it to be accessible
export { DORM };

type Env = {
  DORM_NAMESPACE: DurableObjectNamespace<DORM>;
  DB_SECRET: string;
  STRIPE_WEBHOOK_SIGNING_SECRET: string;
  STRIPE_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  SKIP_LOGIN?: string;
};

interface User extends Records {
  access_token: string;
  balance: number;
  email: string | null;
  client_reference_id: string;
}

// Migrations - keep in global scope
const migrations = {
  1: [
    `CREATE TABLE users (
      access_token TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      email TEXT,
      client_reference_id TEXT
    )`,
    `CREATE INDEX idx_users_balance ON users(balance)`,
    `CREATE INDEX idx_users_email ON users(email)`,
    `CREATE INDEX idx_users_client_reference_id ON users(client_reference_id)`,
  ],
};

// Route object
const routes: Record<string, string> = {
  "/": indexHtml,
};

// Helper functions
const generateAccessToken = () => crypto.randomUUID();
const generateClientReferenceId = () => crypto.randomUUID();

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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Handle Stripe webhook
    if (path === "/stripe-webhook") {
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

        const { client_reference_id, customer_details, amount_total } = session;

        if (!client_reference_id || !customer_details?.email) {
          return new Response("Missing required data", { status: 400 });
        }

        // Find user in aggregate by client_reference_id
        const aggregateClient = createClient({
          doNamespace: env.DORM_NAMESPACE,
          version: "v1",
          migrations,
          ctx,
          name: "aggregate",
        });

        const user = await aggregateClient
          .exec<User>(
            "SELECT * FROM users WHERE client_reference_id = ?",
            client_reference_id,
          )
          .one()
          .catch(() => null);

        if (!user) {
          return new Response("User not found", { status: 404 });
        }

        // Create client for specific user with mirror to aggregate
        const userClient = createClient({
          doNamespace: env.DORM_NAMESPACE,
          version: "v1",
          migrations,
          ctx,
          name: user.access_token,
          mirrorName: "aggregate",
        });

        // Update user balance and email
        const update = await userClient
          .exec(
            "UPDATE users SET balance = balance + ?, email = ? WHERE access_token = ?",
            amount_total,
            customer_details.email,
            user.access_token,
          )
          .toArray();

        console.log("PAYMENT PROCESSED", { user, update });
        return new Response("Payment processed successfully", { status: 200 });
      }

      return new Response("Event not handled", { status: 200 });
    }

    // Handle database API access
    if (path.startsWith("/api/db")) {
      const aggregateClient = createClient({
        doNamespace: env.DORM_NAMESPACE,
        version: "v1",
        migrations,
        ctx,
        name: "aggregate",
      });

      const middlewareResponse = await aggregateClient.middleware(request, {
        prefix: "/api/db",
        secret: env.DB_SECRET,
      });

      if (middlewareResponse) {
        return middlewareResponse;
      }
    }

    // Handle regular routes
    const headers = new Headers();
    const cookieHeader = request.headers.get("Cookie");
    const cookies = cookieHeader ? parseCookies(cookieHeader) : {};

    let accessToken = cookies.access_token;
    let user: User | null = null;

    // Create client for the user
    if (accessToken) {
      const userClient = createClient({
        doNamespace: env.DORM_NAMESPACE,
        version: "v1",
        migrations,
        ctx,
        name: accessToken,
        mirrorName: "aggregate",
      });

      try {
        user = await userClient
          .exec<User>("SELECT * FROM users WHERE access_token = ?", accessToken)
          .one();
      } catch {
        // User not found, will create new one
      }
    }

    // Create new user if needed
    if (!user) {
      accessToken = generateAccessToken();
      const clientReferenceId = generateClientReferenceId();

      const userClient = createClient({
        doNamespace: env.DORM_NAMESPACE,
        version: "v1",
        migrations,
        ctx,
        name: accessToken,
        mirrorName: "aggregate",
      });

      await userClient
        .exec(
          "INSERT INTO users (access_token, balance, email, client_reference_id) VALUES (?, ?, ?, ?)",
          accessToken,
          0,
          null,
          clientReferenceId,
        )
        .toArray();

      user = {
        access_token: accessToken,
        balance: 0,
        email: null,
        client_reference_id: clientReferenceId,
      };

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

    // Get HTML for route
    const html = routes[path] || routes["/"];

    // Inject user data into HTML
    const modifiedHtml = html.replace(
      "</head>",
      `<script>window.data = ${JSON.stringify({
        balance: user.balance,
        email: user.email,
        client_reference_id: user.client_reference_id,
      })};</script></head>`,
    );

    headers.append("Content-Type", "text/html");
    return new Response(modifiedHtml, { headers });
  },
};
