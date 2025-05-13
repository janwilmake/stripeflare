# Stripeflare

Minimal demo to add Stripe Payments to a Cloudflare Worker

[![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) [![](https://badge.xymake.com/janwilmake/status/1912873192160375230)](https://xymake.com/janwilmake/status/1912873192160375230)

# Setup

1. Create a Stripe account
2. Navigate to https://dashboard.stripe.com/apikeys
3. Fill your publishable key and secret key in `.dev.vars`
4. Create a webhook at https://dashboard.stripe.com/webhooks/create. Endpoint URL: https://yourdomain.com/stripe-webhook
5. Fill your webhook singing secret in `.dev.vars`
6. Create a payment link at https://dashboard.stripe.com/payment-links
7. Fill the ID in `.dev.vars` (can be found in the URL, https://dashboard.stripe.com/payment-links/plink_SOMETHING) e.g. `plink_1REsLrHdjTpW3q7imVymkkkkk`
8. Now you're ready to receive payments and perform logic after the payment succeeded. See [main.ts](main.ts) (200 lines) and add your logic there to give the user what they paid for.

# Good to know

With any payment link you can pass 2 query params to a pre-existing link:

- `client_reference_id` - attach any identifier (or any information) to the checkout. can be up to 200 characters. no stripe customer required. in any webhook, `client_reference_id` is located at `event.data.object.client_reference_id` on `Stripe.Checkout.Session` Objects.
- `prefilled_email` - For pre-filling customer email
