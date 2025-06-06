// To use this template, replace "./middleware" by "stripeflare" and add stripeflare to your dependencies (npm i stripeflare)
import { withStripeflare } from "./middleware";
export { DORM } from "./middleware";

//@ts-ignore
import template from "./template.html";
import { StripeUser } from "./middleware";

interface MyUser extends StripeUser {}
export default withStripeflare<MyUser>({
  //customMigrations:
  // version: "2",
  handler: {
    async fetch(request, env, ctx): Promise<Response> {
      const t = Date.now();
      const { charged, message } = await ctx.charge(1, false);
      const { access_token, verified_user_access_token, ...rest } = ctx.user;
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
        })};</script></head>`,
      );

      return new Response(modifiedHtml, {
        headers: { "Content-Type": "text/html" },
      });
    },
  },
});
