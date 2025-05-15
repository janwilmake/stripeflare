Learnings

- we can verify the user using `payment_method_details.card.fingerprint` (https://docs.stripe.com/api/charges/object#charge_object-payment_method_details-card-fingerprint) for `card` payments and using `customer_details.email` for `link` payments. More info: https://docs.stripe.com/api/charges/object#charge_object-payment_method_details.
- Apple Pay, Google Pay, and direct credit cards all probably provide `card` information. Potentially way more ( see: https://docs.stripe.com/api/charges/object#charge_object-payment_method_details-card-wallet-type)
