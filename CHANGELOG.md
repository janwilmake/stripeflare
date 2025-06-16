# April 17, 2025

Made an initial POC that uses the stripe-webhook in a Cloudflare worker (now at https://github.com/janwilmake/stripe-webhook-template)

# May 13

Revamped this into a middleware that keeps user balance in a "dorm" (with user-based tiny dbs + aggregate) and tied to a browser cookie.

# May 15

Changed logic to only create user after payment. Will still create empty DOs (to check) and it will run migrations there and submit that it did that, so still need to find a way to clean this up nicely, possibly at the `remote-sql-cursor` level?

https://x.com/janwilmake/status/1922903746658341049

Also, found a way use stripeflare to login by payment. A unauthenticated user can login into their account by making a small payment. See ADR

# May 22nd

- Added payment_link to environment variables to make it easier to manage
- Added deploy to cloudflare button to make it easier to try and template from

# June 6th - v0.0.24

- Lots of bug fixes and usability improvements
- added initial implementation of `withStripeflare`
- improved README by a lot!

# June 16th, 2025 - v0.0.32

- ✅ `access_token`s shouldn't be in the DO names. Let this be `client_reference_id`s. Full reset.
- ✅ Fixed type bugs
- ✅ Add `.gitignore` to stripeflare template and use `X-Price`
- ✅ Update everything to v0.0.32
- ✅ Post: https://x.com/janwilmake/status/1934600015348994498
