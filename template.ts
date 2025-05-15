// To use this template, replace "./middleware" by "stripeflare" and add stripeflare to your dependencies (npm i stripeflare)
import { Env, stripeBalanceMiddleware, type StripeUser } from "./middleware";
export { DORM } from "./middleware";
//@ts-ignore
import template from "./template.html";

interface User extends StripeUser {
  /** Additional properties */
  // twitter_handle: string | null;
}

export const migrations = {
  // can add any other info here
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
};

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const result = await stripeBalanceMiddleware<User>(
      request,
      env,
      ctx,
      migrations,
    );

    // If middleware returned a response (webhook or db api), return it directly
    if (result.response) {
      return result.response;
    }

    if (!result.user) {
      return new Response("Somethign went wrong", {
        status: 404,
        headers: result.headers,
      });
    }

    // Otherwise, inject user data and return HTML
    const headers = result.headers || new Headers();
    headers.append("Content-Type", "text/html");

    const { access_token, ...rest } = result.user;
    const modifiedHtml = template.replace(
      "</head>",
      `<script>window.data = ${JSON.stringify(rest)};</script></head>`,
    );
    return new Response(modifiedHtml, { headers });
  },
};
