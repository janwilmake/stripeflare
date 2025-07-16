// To use this template, replace "./middleware" by "stripeflare" and add stripeflare to your dependencies (npm i stripeflare)
import { withStripeflare, StripeUser } from "./middleware";
export { DORM } from "./middleware";
//@ts-ignore
import template from "./template.html";

interface MyUser extends StripeUser {}
export default {
  fetch: withStripeflare<MyUser>(async (request, env, ctx) => {
    const { access_token, verified_user_access_token, ...rest } = ctx.user;
    const paymentLink = env.STRIPE_PAYMENT_LINK;
    const modifiedHtml = template.replace(
      "</head>",
      `<script>window.data = ${JSON.stringify({
        ...rest,
        paymentLink,
      })};</script></head>`
    );

    return new Response(modifiedHtml, {
      headers: { "Content-Type": "text/html", "X-Price": "1" },
    });
  }),
};
