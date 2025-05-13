Context:

- https://raw.githubusercontent.com/janwilmake/dorm/refs/heads/main/template.ts
- https://raw.githubusercontent.com/janwilmake/stripe-webhook-template/refs/heads/main/main.ts

Please, make me a backend using dorm and the principles from the stripe example where:

- create a user table with `{ access_token (primary key), balance (index), email (index), client_reference_id (index) }` in `dorm`. Simply use migrations, not the json schema. keep this migrations objects in the global scope
- use dorm middleware for giving access to the `aggregate` db. use `env.DB_SECRET` as secret (required)
- we check for cookies if they exists and find belonging user based on `access_token` cookie. if not, randomly generate a new `access_token` and `client_reference_id` and create user for it with email `null` and balance `0`.
- return html file for the current route (support only `/` for now leading to index, but put them in a route object. import html files via import filename from "./filename.html";).
- it checks the stripe `checkout.session.completed` webhook event, and if there's a `client_reference_id` there, look it up in `aggregate` to find the `access_token`. then create a client for that `access_token` with mirrorName `aggregate`. add to `balance` using `amount_total` and set `email`.
- do not check for the payment link; checking on the client_reference_id is enough.

Needed state:

- secure http-only cookie `access_token`
- window.data get set to `{balance,email,client_reference_id}`

How to use cookies:

```ts
// can be enabled in localhost
const skipLogin = env.SKIP_LOGIN === "true";
const securePart = skipLogin ? "" : " Secure;";
const domainPart = skipLogin ? "" : ` Domain=${url.hostname};`;
const cookieSuffix = `;${domainPart} HttpOnly; Path=/;${securePart} Max-Age=34560000; SameSite=Lax`;

// Set secure HTTP-only cookie for access_token
headers.append(
  "Set-Cookie",
  `access_token=${user.access_token}${cookieSuffix}`,
);
```
