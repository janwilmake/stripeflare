// To use this template, replace "./middleware" by "stripeflare" and add stripeflare to your dependencies (npm i stripeflare)
import {
  createClient,
  Env,
  stripeBalanceMiddleware,
  type StripeUser,
} from "./middleware";
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
    const { response, charge, headers, user, userClient } =
      await stripeBalanceMiddleware<User>(
        request,
        env,
        ctx,
        migrations,
        // changing this will link to a fully new db
        "0.0.10",
      );

    // If middleware returned a response (webhook or db api), return it directly
    if (response) {
      return response;
    }

    if (!charge || !headers || !user || !userClient) {
      return new Response("Something went wrong", { status: 500 });
    }

    const t = Date.now();

    const { charged, message } = await charge(1, false);

    // We can also directly connect with the DB through dorm client
    // const client = createClient({
    //   doNamespace: env.DORM_NAMESPACE,
    //   ctx,
    //   migrations,
    //   mirrorName: "aggregate",
    //   name: result.session.user.access_token,
    //   //NB: ensure to specify the same version!
    //   version: "0.0.10",
    // });

    // let paidUser = await client
    //   .exec<User>(
    //     "SELECT * FROM users WHERE access_token = ?",
    //     result.session.user.access_token,
    //   )
    //   .one()
    //   .catch(() => null);

    // if (paidUser) {
    //   const update = client.exec(
    //     "UPDATE users SET balance = balance - 1 WHERE access_token=?",
    //     result.session.user.access_token,
    //   );

    //   await update.toArray();
    //   const { rowsRead, rowsWritten } = update;

    //   console.log("User has been charged one cent", { rowsRead, rowsWritten });

    //   const updatedUser = await client
    //     .exec<StripeUser>(
    //       "SELECT * FROM users WHERE access_token=?",
    //       result.session.user.access_token,
    //     )
    //     .one()
    //     .catch(() => null);
    //   if (!updatedUser) {
    //     return new Response("Couldn't find updated user user", { status: 500 });
    //   }
    //   user = updatedUser;
    // } else {
    //   console.log(
    //     "This user could not be found, which means they have not made a payment. Change logic accordingly",
    //   );
    // }

    // Otherwise, inject user data and return HTML

    const { access_token, verified_user_access_token, ...rest } = user;
    const payment_link = env.STRIPE_PAYMENT_LINK;
    const speed = Date.now() - t;
    const modifiedHtml = template.replace(
      "</head>",
      `<script>window.data = ${JSON.stringify({
        ...rest,
        speed,
        charged,
        message,
        payment_link,
      })};</script></head>`,
    );
    return new Response(modifiedHtml, {
      headers: { ...headers, "Content-Type": "text/html" },
    });
  },
};
