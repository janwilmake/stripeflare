# Stripeflare - Virtual Wallet backed by Stripe Payments and Cloudflare Durable Objects

[![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) [![](https://badge.xymake.com/janwilmake/status/1924404433317675347)](https://xymake.com/janwilmake/status/1924404433317675347) [![](https://b.lmpify.com/guide)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fstripeflare%2Ftree%2Fmain%3FpathPatterns%3Dtemplate.ts%26pathPatterns%3Dtemplate.html%0A%0APlease%20create%20a%20new%20cloudflare%20typescript%20worker%20that%20uses%20stripeflare%20for%20monetisation%20with%20the%20following%20state%20and%20functionality%3A%20...)

Middleware to add Stripe Payments to a Cloudflare Worker and have users keep track of a balance in your own database, without requiring third-party authentication (Just Stripe Payment)! It is a massive improvement upon [Cloudflare Sponsorware](https://github.com/janwilmake/cloudflare-sponsorware) which I made before as it dramatically reduces complexity while improving upon UX and DX.

Let me know your thoughts in [this thread](https://x.com/janwilmake/status/1924404433317675347) and check [the demo](https://x.com/janwilmake/status/1924766605143142683)

# Getting started

1. Use LMPIFY or any other LLM with [![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) to get started building your idea. [![](https://b.lmpify.com/guide)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fstripeflare%2Ftree%2Fmain%3FpathPatterns%3Dtemplate.ts%26pathPatterns%3Dtemplate.html%0A%0APlease%20create%20a%20new%20cloudflare%20typescript%20worker%20that%20uses%20stripeflare%20for%20monetisation%20with%20the%20following%20state%20and%20functionality%3A%20...)
2. Submit the result to a github repo and Deploy to Cloudflare
3. [Collect the environment variables and set them in dev and production](#collecting-needed-environment-variables)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/stripeflare) <!-- for easy deployment, ensure to add this into the readme of the created project -->

| Summary                                            | Prompt it                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template to use stripeflare for a new app          | [![](https://b.lmpify.com/guide)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fstripeflare%2Ftree%2Fmain%3FpathPatterns%3Dtemplate.ts%26pathPatterns%3Dtemplate.html%0A%0APlease%20create%20a%20new%20cloudflare%20typescript%20worker%20that%20uses%20stripeflare%20for%20monetisation%20with%20the%20following%20state%20and%20functionality%3A%20...) |
| Entire implementation of the package               | [![](https://b.lmpify.com/source)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fstripeflare%2Ftree%2Fmain%3FpathPatterns%3Dmiddleware.ts%26pathPatterns%3Dpackage.json%26pathPatterns%3Dencrypt-decrypt-js.js%0A%0ACan%20you%20tell%20me%20more%20about%20the%20security%20considerations%20of%20using%20this%20package%3F)                              |
| Create a customized guide for a particular usecase | [![](https://b.lmpify.com/create_guide)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fstripeflare%2Ftree%2Fmain%3FpathPatterns%3DREADME.md%26pathPatterns%3Dtemplate.ts%0A%0APlease%20create%20a%20new%20template%20for%20stripeflare%20similar%20to%20the%20provided%20template%2C%20for%20the%20following%20usecase%3A%20...)                          |
| General information                                | [![](https://b.lmpify.com/general)](https://lmpify.com?q=https%3A%2F%2Fuuithub.com%2Fjanwilmake%2Fstripeflare%2Ftree%2Fmain%3FpathPatterns%3DREADME.md%26pathPatterns%3DLICENSE.md%26pathPatterns%3Dmiddleware.ts%0A%0AWhat%20are%20the%20limitations%3F)                                                                                                                 |

# About

## Features

- **Performant**: Creates a DB for each user while also mirroring it into an aggregate db (powered by [Durable Objects](https://developers.cloudflare.com/durable-objects/) and [DORM](https://getdorm.com)), resulting in lightning-fast worker requests with user-balance.
- **Flexible**: Leverages [`?client_reference_id`](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-client_reference_id) ensure connection to the user session whilst using any [Stripe Payment Link](https://docs.stripe.com/payment-links).
- **Extensible**: Hooks into your own DO-based database so you can extend it however you like.
- **Login by Payment**: Users can access their previous balance from any device as long as they use the same Stripe Payment method (only supports payment methods `card` and `link`, see [ADR](ADR.md))

## When can you use this?

1. you want to use Cloudflare Workers for your app, with [DORM](https://github.com/janwilmake/dorm) as your database with segmentation on the user-level with one aggregate-db
2. You are VERY concerned with the performance of charging users. A user should be able to be charged within ±20ms.
3. You can use the source code as a starting point, giving you a virtual wallet system for your DORM-database. You don't need to use it as a dependency if you need additional logic and enhanced security.

## When not to use this

1. When you want more production-ready things, don't use this. May still get breaking changes. This is still a research-project with limitations. See [ADR](ADR.md) for details.
2. When you care a lot about multiple layers of security, don't use this. Currently, access_tokens are stored in the database as-is without encryption, which could expose them if other layers of security are compromised.

## Collecting Needed Environment Variables

1. Create a Stripe account, navigate to https://dashboard.stripe.com/apikeys and collect `STRIPE_SECRET` and `STRIPE_PUBLISHABLE_KEY`
2. Create a webhook at https://dashboard.stripe.com/webhooks/create. Endpoint URL: https://yourdomain.com/stripe-webhook and sollect `STRIPE_WEBHOOK_SIGNING_SECRET`
3. Create a payment link at https://dashboard.stripe.com/payment-links and set this as `STRIPE_PAYMENT_LINK`, use this in your frontend, but ensure to append `?client_reference_id=${client_reference_id}` taken from the `StripeUser`

## Good to know

- https://github.com/janwilmake/dorm is a dependency. When you want to interact with the same database to charge a user, ensure to use the returned `userClient` from the middleware (if available) or create a client yourself. The DB name access_token, the mirrorName should be "aggregate"
- we have some well-thoguht-out logic in the stripe webhook, allowing login-by-payment; read more here: https://www.lmpify.com/httpsrawgithubus-20o3gj0
- learn how to explore the data with outerbase here: https://www.lmpify.com/how-does-stripeflare-iqt4li0
