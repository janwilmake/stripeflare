# Stripeflare - Virtual Wallet backed by Stripe Payments and Cloudflare Durable Objects

[![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) [![](https://badge.xymake.com/janwilmake/status/1924404433317675347)](https://xymake.com/janwilmake/status/1924404433317675347)

Middleware to add Stripe Payments to a Cloudflare Worker and have users keep track of a balance in your own database, without requiring third-party authentication (Just Stripe Payment)! It is a massive improvement upon [Cloudflare Sponsorware](https://github.com/janwilmake/cloudflare-sponsorware) which I made before as it dramatically reduces complexity while improving upon UX and DX.

Let me know your thoughts in [this thread](https://x.com/janwilmake/status/1924404433317675347) and check [the demo](https://x.com/janwilmake/status/1924766605143142683)

## When can you use this?

1. you want to use Cloudflare Workers for your app, with [DORM](https://github.com/janwilmake/dorm) as your database with segmentation on the user-level with one aggregate-db
2. You are VERY concerned with the performance of charging users. A user should be able to be charged within ±20ms.
3. You can use the source code as a starting point, giving you a virtual wallet system for your DORM-database. You don't need to use it as a dependency if you need additional logic and enhanced security.

## When not to use this

1. When you want more production-ready things, don't use this. May still get breaking changes. This is still a research-project with limitations. See [ADR](ADR.md) for details.
2. When you care a lot about multiple layers of security, don't use this. Currently, access_tokens are stored in the database as-is without encryption, which could expose them if other layers of security are compromised.

## Features

- **Performant**: Creates a DB for each user while also mirroring it into an aggregate db (powered by [Durable Objects](https://developers.cloudflare.com/durable-objects/) and [DORM](https://getdorm.com)), resulting in lightning-fast worker requests with user-balance.
- **Flexible**: Leverages [`?client_reference_id`](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-client_reference_id) ensure connection to the user session whilst using any [Stripe Payment Link](https://docs.stripe.com/payment-links).
- **Extensible**: Hooks into your own DO-based database so you can extend it however you like.
- **Login by Payment**: Users can access their previous balance from any device as long as they use the same Stripe Payment method (only supports payment methods `card` and `link`, see [ADR](ADR.md))

# Setup

1. Create a Stripe account, navigate to https://dashboard.stripe.com/apikeys and collect `STRIPE_SECRET` and `STRIPE_PUBLISHABLE_KEY`
2. Create a webhook at https://dashboard.stripe.com/webhooks/create. Endpoint URL: https://yourdomain.com/stripe-webhook and sollect `STRIPE_WEBHOOK_SIGNING_SECRET`
3. Create a payment link at https://dashboard.stripe.com/payment-links and use this in your frontend, but ensure to append `?client_reference_id=${client_reference_id}` taken from the `StripeUser`
4. Now you're ready to receive payments and perform logic based on the user details and balance.

For the implementation, see `middleware.ts`. For the template, see `template.ts` and `template.html`.

# Good to know:

- https://github.com/janwilmake/dorm is a dependency. When you want to interact with the same database to charge a user, ensure to use the returned `userClient` from the middleware (if available) or create a client yourself. The DB name access_token, the mirrorName should be "aggregate"
- we have some well-thoguht-out logic in the stripe webhook, allowing login-by-payment; read more here: https://www.lmpify.com/httpsrawgithubus-20o3gj0
- learn how to explore the data with outerbase here: https://www.lmpify.com/how-does-stripeflare-iqt4li0
