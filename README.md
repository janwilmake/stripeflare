# Stripeflare

Middleware to add Stripe Payments to a Cloudflare Worker and have users keep track of a balance in your own database, without requiring third-party authentication.

[![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) [![](https://badge.xymake.com/janwilmake/status/1912873192160375230)](https://xymake.com/janwilmake/status/1912873192160375230)

# Setup

1. Create a Stripe account, navigate to https://dashboard.stripe.com/apikeys and collect `STRIPE_SECRET` and `STRIPE_PUBLISHABLE_KEY`
2. Create a webhook at https://dashboard.stripe.com/webhooks/create. Endpoint URL: https://yourdomain.com/stripe-webhook and sollect `STRIPE_WEBHOOK_SIGNING_SECRET`
3. Create a payment link at https://dashboard.stripe.com/payment-links and use this in your frontend, but ensure to append `?client_reference_id=${client_reference_id}` taken from the `StripeUser`
4. Now you're ready to receive payments and perform logic based on the user details and balance.

For the implementation, see `middleware.ts`. For the template, see `template.ts` and `template.html`.
