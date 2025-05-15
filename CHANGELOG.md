# April 17, 2025

Made an initial POC that uses the stripe-webhook in a Cloudflare worker (now at https://github.com/janwilmake/stripe-webhook-template)

# May 13

Revamped this into a middleware that keeps user balance in a "dorm" (with user-based tiny dbs + aggregate) and tied to a browser cookie.

# May 15

Changed logic to only create user after payment. Will still create empty DOs (to check) and it will run migrations there and submit that it did that, so still need to find a way to clean this up nicely, possibly at the `remote-sql-cursor` level?

https://x.com/janwilmake/status/1922903746658341049

Found that payment links normally set `customer_creation` to `if_required` which will only create customers for subscriptions. When set to `always` we can track customers across payments, allowing to connect them to their previous account after payment.
