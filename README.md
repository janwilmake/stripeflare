# Stripeflare

[![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) [![](https://badge.xymake.com/janwilmake/status/1912873192160375230)](https://xymake.com/janwilmake/status/1912873192160375230)

Middleware to add Stripe Payments to a Cloudflare Worker and have users keep track of a balance in your own database, without requiring third-party authentication (Just Stripe Payment)! It is a massive improvement upon [cloudflare sponsorware](https://github.com/janwilmake/cloudflare-sponsorware) which I made before as it dramatically reduces complexity while improving upon UX and DX.

# Features

- **Performant**: Creates a DB for each user while also mirroring it into an aggregate db (powered by [Durable Objects](https://developers.cloudflare.com/durable-objects/) and [DORM](https://getdorm.com)), resulting in lightning-fast worker requests with user-balance.
- **Flexible**: Leverages [`?client_reference_id`](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-client_reference_id) ensure connection to the user session whilst using any [Stripe Payment Link](https://docs.stripe.com/payment-links).
- **Extensible**: Hooks into your own DO-based database so you can extend it however you like.

# Setup

1. Create a Stripe account, navigate to https://dashboard.stripe.com/apikeys and collect `STRIPE_SECRET` and `STRIPE_PUBLISHABLE_KEY`
2. Create a webhook at https://dashboard.stripe.com/webhooks/create. Endpoint URL: https://yourdomain.com/stripe-webhook and sollect `STRIPE_WEBHOOK_SIGNING_SECRET`
3. Create a payment link at https://dashboard.stripe.com/payment-links and use this in your frontend, but ensure to append `?client_reference_id=${client_reference_id}` taken from the `StripeUser`
4. Now you're ready to receive payments and perform logic based on the user details and balance.

For the implementation, see `middleware.ts`. For the template, see `template.ts` and `template.html`.
