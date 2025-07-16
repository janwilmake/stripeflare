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

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const middleware = await stripeBalanceMiddleware<User>(
      request,
      env,
      ctx,
      "0.0.10"
    );

    // If middleware returned a response (webhook or db api), return it directly
    if (middleware.type === "response") {
      return middleware.response;
    }

    const t = Date.now();

    const { charged, message } = await middleware.charge(1, false);

    // We can also directly connect with the DB through dorm client
    const client = createClient({
      doNamespace: env.DORM_NAMESPACE,
      ctx,
      configs: [
        { name: `0.0.10-${middleware.user.access_token}` },
        { name: `0.0.10-aggregate` },
      ],
    });

    // Otherwise, inject user data and return HTML

    const { access_token, verified_user_access_token, ...rest } =
      middleware.user;
    const paymentLink = env.STRIPE_PAYMENT_LINK;
    const speed = Date.now() - t;
    const modifiedHtml = template.replace(
      "</head>",
      `<script>window.data = ${JSON.stringify({
        ...rest,
        speed,
        charged,
        message,
        paymentLink,
      })};</script></head>`
    );

    return new Response(modifiedHtml, {
      headers: { ...middleware.headers, "Content-Type": "text/html" },
    });
  },
};
