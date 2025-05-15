# Login by payment

Goal is to identify buyers after a payment link payment (without them being logged in). My Learnings:

- payment links don't provide customer ids that identify the customer. even if enabled to gather customer_id (`customer_creation:always`) they are re-created for every new payment, so this isn't useful.
- we can verify the user using `payment_method_details.card.fingerprint` (https://docs.stripe.com/api/charges/object#charge_object-payment_method_details-card-fingerprint) for `card` payments and using `customer_details.email` for `link` payments. More info: https://docs.stripe.com/api/charges/object#charge_object-payment_method_details.
- Apple Pay, Google Pay, and direct credit cards all probably provide `card` information. Potentially way more ( see: https://docs.stripe.com/api/charges/object#charge_object-payment_method_details-card-wallet-type)

Post planned may 17, 11 am (saturday)

TODO:

- if payment is done from access token that has no user yet, create user with 0, and set column `verified_user_access_token`. balance should to to user with that `access_token` instead
- in `handleUserSession` when found user has `verified_user_access_token`, change `access_token` to there.

🎉 Now I can login from anywhere by logging in with stripe!!!

Question: Can I make stripeflare oauth 2.1 compatible, effectively allowing this as auth-layer for MCPs?
