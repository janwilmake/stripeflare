# Stripeflare - Virtual Wallet System

[![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) [![](https://badge.xymake.com/janwilmake/status/1924404433317675347)](https://xymake.com/janwilmake/status/1924404433317675347) [![](https://b.lmpify.com/guide)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fstripeflare%2Ftree%2Fmain%3FpathPatterns%3Dtemplate.ts%26pathPatterns%3Dtemplate.html%0A%0APlease%20create%20a%20new%20cloudflare%20typescript%20worker%20that%20uses%20stripeflare%20for%20monetisation%20with%20the%20following%20state%20and%20functionality%3A%20...)

Stripeflare is middleware that adds Stripe Payments to a Cloudflare Worker and have users keep track of a balance in your own database, without requiring third-party authentication (Just Stripe Payment)! Let me know your thoughts in [this thread](https://x.com/janwilmake/status/1924404433317675347) and check [the demo](https://x.com/janwilmake/status/1924766605143142683)

**⚡️ Lightning Fast** | **🔑 ACID Compliant** | **☁️ Cloudflare Optimised** | **🍬 Minimal Setup**

# Installation

First install the package (which also installs [DORM](https://github.com/janwilmake/dorm))

```sh
npm i stripeflare
```

The easiest way is to use `withStripeflare` which wraps your entire `ExportedHandler`:

## `main.ts`

```ts
import { withStripeflare, StripeUser, DORM } from "stripeflare";
export { DORM };

// StripeUser can be extended
export default withStripeflare<StripeUser>({
  // customMigrations: optional way to overwrite default user table with an extension to your database
  // version: "1" // resets data
  handler: {
    async fetch(request, env, ctx): Promise<Response> {
      const t = Date.now();
      const { charged, message } = await ctx.charge(1, false);
      const { access_token, verified_user_access_token, ...rest } = ctx.user;
      const speed = Date.now() - t;
      return new Response(
        charged
          ? `Charged ${ctx.user.name} 1 cent in ${speed}ms`
          : `Could not charge user in ${speed}ms`,
      );
    },
  },
});
```

`wrangler.json|toml`

The following adds DORM durable object to your Cloudflare Bindings, which stripeflare uses to allow for lightning-fast user balance charges.

```json
{
  "name": "stripeflare-example",
  "compatibility_date": "2025-06-06",
  "main": "main.ts",
  "durable_objects": {
    "bindings": [{ "name": "DORM_NAMESPACE", "class_name": "DORM" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DORM"] }]
}
```

For TOML:

```toml

name = "stripeflare-example"
main = "main.ts"
compatibility_date = "2025-06-06"

[[durable_objects.bindings]]
name = "DORM_NAMESPACE"
class_name = "DORM"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["DORM"]
```

`.dev.vars`

```env
# Create a Stripe account, navigate to https://dashboard.stripe.com/apikeys and collect `STRIPE_SECRET` and `STRIPE_PUBLISHABLE_KEY`
STRIPE_SECRET=
STRIPE_PUBLISHABLE_KEY=
# Create a webhook at https://dashboard.stripe.com/webhooks/create. Endpoint URL: https://yourdomain.com/stripe-webhook and sollect `STRIPE_WEBHOOK_SIGNING_SECRET`
STRIPE_WEBHOOK_SIGNING_SECRET=
# Create a payment link at https://dashboard.stripe.com/payment-links and set this as `STRIPE_PAYMENT_LINK`
STRIPE_PAYMENT_LINK=
# Put a 32 character+ secret here to sign your secrets
DB_SECRET=
```

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/stripeflare) <!-- for easy deployment, ensure to add this into the readme of the created project -->

# About

## Features

- **Performant**: Creates a DB for each user while also mirroring it into an aggregate db (powered by [Durable Objects](https://developers.cloudflare.com/durable-objects/) and [DORM](https://getdorm.com)), resulting in lightning-fast worker requests with user-balance.
- **Flexible**: Leverages [`?client_reference_id`](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-client_reference_id) ensure connection to the user session whilst using any [Stripe Payment Link](https://docs.stripe.com/payment-links).
- **Extensible**: Hooks into your own DO-based database so you can extend it however you like.
- **Login by Payment**: Users can access their previous balance from any device as long as they use the same Stripe Payment method (only supports payment methods `card` and `link`, see [ADR](ADR.md))

## When can you use this?

1. You want to use Cloudflare Workers for your app, with [DORM](https://github.com/janwilmake/dorm) as your database with segmentation on the user-level with one aggregate-db
2. You are VERY concerned with the performance of charging users. A user should be able to be charged within ±20ms.
3. You can use the source code as a starting point, giving you a virtual wallet system for your DORM-database. You don't need to use it as a dependency if you need additional logic and enhanced security.

## Good to know

- When you care a lot about multiple layers of security, don't use this. Currently, access_tokens are stored in the database as-is without encryption, which could expose them if other layers of security are compromised.
- When you want more production-ready things, don't use this. May still get breaking changes. This is still a research-project with limitations. See [ADR](ADR.md) for details.
- https://github.com/janwilmake/dorm is a dependency. When you want to interact with the same database to charge a user, ensure to use the returned `userClient` from the middleware (if available) or create a client yourself. The DB name access_token, the mirrorName should be "aggregate"
- we have some well-thoguht-out logic in the stripe webhook, allowing login-by-payment; read more here: https://www.lmpify.com/httpsrawgithubus-20o3gj0
- learn how to explore the data with outerbase here: https://www.lmpify.com/how-does-stripeflare-iqt4li0
- It is a massive improvement upon [Cloudflare Sponsorware](https://github.com/janwilmake/cloudflare-sponsorware) which I made before as it dramatically reduces complexity while improving upon UX and DX.
