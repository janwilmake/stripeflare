# Stripeflare - Virtual Wallet System

[![janwilmake/stripeflare context](https://badge.forgithub.com/janwilmake/stripeflare)](https://uithub.com/janwilmake/stripeflare) [![](https://badge.xymake.com/janwilmake/status/1924404433317675347)](https://xymake.com/janwilmake/status/1924404433317675347) [![](https://b.lmpify.com/Quickstart)](https://letmeprompt.com?q=https://uithub.com/janwilmake/stripeflare/tree/main/README.md)

Stripeflare is middleware that adds Stripe Payments to a Cloudflare Worker and have users keep track of a balance in your own database, without requiring third-party authentication (Just Stripe Payment)! Let me know your thoughts in [this thread](https://x.com/janwilmake/status/1924404433317675347) and check [the demo](https://x.com/janwilmake/status/1924766605143142683)

**⚡️ Lightning Fast** | **🔑 ACID Compliant** | **☁️ Cloudflare Optimised** | **🍬 Minimal Setup**

Stripeflare is meant to make it easy to create Agent-friendly SaaS products.

| Aspect             | Traditional SaaS                  | Agent-Friendly SaaS                    |
| ------------------ | --------------------------------- | -------------------------------------- |
| **Authentication** | Username/password, OAuth, SSO     | Payment-based authentication, API keys |
| **User Journey**   | Sign up → Trial → Subscribe → Use | Pay per use → Immediate access         |
| **Billing Model**  | Monthly/annual subscriptions      | Pay-per-request, usage-based           |
| **User Interface** | UI-First                          | 1:1 JSON API, Markdown API & UI        |

# Automatic Installation.

```sh
npx create-stripeflare
```

See [create-stripeflare](https://github.com/janwilmake/create-stripeflare) for more detailed instructions.

# Manual Installation

First install the package (which also installs [DORM](https://github.com/janwilmake/dorm))

```sh
npm i stripeflare
```

The easiest way to install stripeflare **for existing projects**, is to use `withStripeflare` which wraps your entire `ExportedHandler`:

## `main.ts`

```ts
import { withStripeflare, StripeUser, DORM } from "stripeflare";
export { DORM };

type Env = {};

export default {
  // StripeUser can be extended
  fetch: withStripeflare<Env, StripeUser>(
    async (request, env, ctx) => {
      // ctx.user, ctx.client are now available
      const { user, registered } = ctx;

      if (request.url.endsWith("/charge")) {
        if (user.balance < 1) {
          return new Response("Payment Required", { status: 402 });
        }
        return new Response(JSON.stringify(result), {
          headers: {
            // Charges one cent
            "X-Price": "1",
          },
        });
      }

      return new Response(`Hello ${user.name || "Anonymous"}`);
    },
    {
      // customMigrations: optional way to overwrite default user table with an extension to your database
      // version: "1" // resets data
    },
  ),
} satisfies ExportedHandler<Env>;
```

`wrangler.json|toml`

The following adds DORM durable object to your Cloudflare Bindings, which stripeflare uses to allow for lightning-fast user balance charges.

```json
{
  "name": "stripeflare-example",
  "compatibility_date": "2025-06-06",
  "main": "main.ts",
  "durable_objects": {
    "bindings": [{ "name": "DORM_NAMESPACE", "class_name": "DORM" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["DORM"] }]
}
```

For TOML:

```toml

name = "stripeflare-example"
main = "main.ts"
compatibility_date = "2025-06-06"

[[durable_objects.bindings]]
name = "DORM_NAMESPACE"
class_name = "DORM"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["DORM"]
```

`.dev.vars`

```env
# Create a Stripe account, navigate to https://dashboard.stripe.com/apikeys and collect `STRIPE_SECRET` and `STRIPE_PUBLISHABLE_KEY`
STRIPE_SECRET=
STRIPE_PUBLISHABLE_KEY=
# Create a webhook at https://dashboard.stripe.com/webhooks/create. Endpoint URL: https://yourdomain.com/stripe-webhook and sollect `STRIPE_WEBHOOK_SIGNING_SECRET`
STRIPE_WEBHOOK_SIGNING_SECRET=
# Create a payment link at https://dashboard.stripe.com/payment-links and set this as `STRIPE_PAYMENT_LINK`
STRIPE_PAYMENT_LINK=
# Put a 32 character+ secret here to sign your secrets
DB_SECRET=
```

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/janwilmake/stripeflare) <!-- for easy deployment, ensure to add this into the readme of the created project -->

## Usage

`withStripeflare` passes the follwoing to your `fetch` handler:

- `ctx.charge(amount, allowNegativeBalance)` charges the user
- `ctx.user` has a user object with or without details
- `ctx.client` contains your db client

In other handlers (schedules, queue, etc) you can use the `chargeUser` utility function to easily charge a user given their access_token:

```ts
const chargeUser = async (
  env: Env,
  ctx: ExecutionContext,
  user_access_token: string,
  migrations: any | undefined,
  version: string | undefined,
  amountCent: number,
  allowNegativeBalance: boolean,
) => Promise<{ charged: boolean; message: string }>;
```

In your static files you can also access these:

- `GET /me` returns `{paymentLink,client_reference_id, balance, name, email, card_fingerprint, verified_email }` which can be useful to show these details fast. Requires cookie!
- `POST /rotate-token` (to rotate the token, instable, may be removed in future version)
- `/db/*` (to perform direct queries to your databases) - for DORM integration with outerbase, see DORM Docs

Besides that, stripeflare standardises and uses the following response headers:

- You can pass `X-Price` to charge users automatically (amount in cents)
- Stripeflare passes `X-PaymentLink` with the paymentlink for the user
- Stripeflare passes `X-Balance` with the balance of the current user in cents

# About

## Features

- **Performant**: Creates a DB for each user while also mirroring it into an aggregate db (powered by [Durable Objects](https://developers.cloudflare.com/durable-objects/) and [DORM](https://getdorm.com)), resulting in lightning-fast worker requests with user-balance.
- **Flexible**: Leverages [`?client_reference_id`](https://docs.stripe.com/api/checkout/sessions/object#checkout_session_object-client_reference_id) ensure connection to the user session whilst using any [Stripe Payment Link](https://docs.stripe.com/payment-links).
- **Extensible**: Hooks into your own DO-based database so you can extend it however you like.
- **Login by Payment**: Users can access their previous balance from any device as long as they use the same Stripe Payment method (only supports payment methods `card` and `link`, see [ADR](ADR.md))

## When can you use this?

1. You want to use Cloudflare Workers for your app, with [DORM](https://github.com/janwilmake/dorm) as your database with segmentation on the user-level with one aggregate-db
2. You are VERY concerned with the performance of charging users. A user should be able to be charged within ±20ms.
3. You can use the source code as a starting point, giving you a virtual wallet system for your DORM-database. You don't need to use it as a dependency if you need additional logic and enhanced security.

## Good to know

- When you care a lot about multiple layers of security, don't use this. Currently, access_tokens are stored in the database as-is without encryption, which could expose them if other layers of security are compromised.
- When you want more production-ready things, don't use this. May still get breaking changes. This is still a research-project with limitations. See [ADR](ADR.md) for details.
- https://github.com/janwilmake/dorm is a dependency. When you want to interact with the same database to charge a user, ensure to use the returned `userClient` from the middleware (if available) or create a client yourself. The DB name access_token, the mirrorName should be "aggregate"
- we have some well-thoguht-out logic in the stripe webhook, allowing login-by-payment; read more here: https://www.lmpify.com/httpsrawgithubus-20o3gj0
- learn how to explore the data with outerbase here: https://www.lmpify.com/how-does-stripeflare-iqt4li0
- It is a massive improvement upon [Cloudflare Sponsorware](https://github.com/janwilmake/cloudflare-sponsorware) which I made before as it dramatically reduces complexity while improving upon UX and DX.

# Advanced Usage

## Extending the Schema with Custom Migrations

Stripeflare uses [DORM](https://github.com/janwilmake/dorm) for database management and supports custom migrations to extend the user schema beyond the default fields.

### Required User Table Structure

The `users` table must contain these **required columns** (all should be indexed for performance):

```sql
CREATE TABLE users (
  access_token TEXT PRIMARY KEY,           -- Required: User's session token
  balance INTEGER DEFAULT 0,               -- Required: User's balance in cents
  name TEXT,                              -- Required: User's display name
  email TEXT,                             -- Required: User's email address
  verified_email TEXT,                    -- Required: Verified email for login-by-payment
  verified_user_access_token TEXT,        -- Required: Links to verified user sessions
  card_fingerprint TEXT,                  -- Required: Stripe card fingerprint for user matching
  client_reference_id TEXT                -- Required: Encrypted reference for Stripe integration
);
```

### Default Migrations

Stripeflare includes these default migrations:

```typescript
const defaultMigrations = {
  1: [
    `CREATE TABLE users (
      access_token TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      name TEXT,
      email TEXT,
      verified_email TEXT,
      verified_user_access_token TEXT,
      card_fingerprint TEXT,
      client_reference_id TEXT
    )`,
    `CREATE INDEX idx_users_balance ON users(balance)`,
    `CREATE INDEX idx_users_name ON users(name)`,
    `CREATE INDEX idx_users_email ON users(email)`,
    `CREATE INDEX idx_users_verified_email ON users(verified_email)`,
    `CREATE INDEX idx_users_card_fingerprint ON users(card_fingerprint)`,
    `CREATE INDEX idx_users_client_reference_id ON users(client_reference_id)`,
  ],
};
```

### Extending with Custom Migrations

You can extend the schema by providing custom migrations that include additional columns:

```typescript
import { withStripeflare, StripeUser } from "stripeflare";

// Extend the StripeUser interface
interface ExtendedUser extends StripeUser {
  subscription_tier: string;
  created_at: string;
  last_login: string;
  preferences: string; // JSON string
}

// Define custom migrations that include all required fields PLUS your extensions
const customMigrations = {
  1: [
    // Base users table with ALL required fields + your custom fields
    `CREATE TABLE users (
      access_token TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      name TEXT,
      email TEXT,
      verified_email TEXT,
      verified_user_access_token TEXT,
      card_fingerprint TEXT,
      client_reference_id TEXT,
      -- Your custom fields below
      subscription_tier TEXT DEFAULT 'free',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT,
      preferences TEXT DEFAULT '{}'
    )`,

    // Required indexes (don't remove these)
    `CREATE INDEX idx_users_balance ON users(balance)`,
    `CREATE INDEX idx_users_name ON users(name)`,
    `CREATE INDEX idx_users_email ON users(email)`,
    `CREATE INDEX idx_users_verified_email ON users(verified_email)`,
    `CREATE INDEX idx_users_card_fingerprint ON users(card_fingerprint)`,
    `CREATE INDEX idx_users_client_reference_id ON users(client_reference_id)`,

    // Your custom indexes
    `CREATE INDEX idx_users_subscription_tier ON users(subscription_tier)`,
    `CREATE INDEX idx_users_created_at ON users(created_at)`,
  ],

  // Future migrations for schema changes
  2: [
    `ALTER TABLE users ADD COLUMN api_key TEXT`,
    `CREATE INDEX idx_users_api_key ON users(api_key)`,
  ],
};

type Env = {};

export default {
  fetch: withStripeflare<Env, ExtendedUser>(
    async (request, env, ctx) => {
      const { user, client } = ctx;

      // Access your custom fields
      console.log(`User tier: ${user.subscription_tier}`);

      // Update custom fields
      if (client) {
        await client
          .exec(
            "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE access_token = ?",
            user.access_token,
          )
          .toArray();
      }

      return new Response(`Hello ${user.name}!`);
    },
    {
      customMigrations,
      version: "1", // Increment to reset/migrate data
    },
  ),
};
```

### Migration Best Practices

1. **Always include required fields**: Never remove the required columns from your migrations
2. **Keep required indexes**: The default indexes are essential for performance

### Accessing Extended Data

```typescript
// Type-safe access to extended fields
const { user, client } = ctx;

// Read extended data
const preferences = JSON.parse(user.preferences || "{}");

// Update extended data
if (client) {
  await client
    .exec(
      "UPDATE users SET subscription_tier = ?, preferences = ? WHERE access_token = ?",
      "premium",
      JSON.stringify({ theme: "dark", notifications: true }),
      user.access_token,
    )
    .toArray();
}
```

### Database Architecture

Stripeflare creates:

- **Individual user databases**: One Durable Object per user (fast charging)
- **Aggregate database**: Mirrors all user data for admin queries
- **Automatic mirroring**: Changes sync between user DB and aggregate DB

This architecture ensures lightning-fast user operations while maintaining queryable aggregate data.

### Schema Limitations

- **Required fields**: Cannot be removed or renamed
- **Primary key**: `access_token` must remain the primary key
- **Balance type**: Must remain `INTEGER` (cents)
- **Token rotation**: Custom fields are preserved during token rotation
