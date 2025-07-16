import { DurableObject } from "cloudflare:workers";
import { withStripeflare, StripeUser } from "./middleware";
import { Migratable } from "migratable-object";
import { Queryable } from "queryable-object";

// Extend the StripeUser interface
interface ExtendedUser extends StripeUser {
  subscription_tier: string;
  created_at: string;
  last_login: string;
  preferences: string; // JSON string
}

type Env = {};

// Define custom migrations that include all required fields PLUS your extensions
@Migratable({
  migrations: {
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
    ],

    // Future migrations for schema changes
    2: [
      `ALTER TABLE users ADD COLUMN api_key TEXT`,
      `CREATE INDEX idx_users_api_key ON users(api_key)`,
      // Your custom indexes
      `CREATE INDEX idx_users_subscription_tier ON users(subscription_tier)`,
      `CREATE INDEX idx_users_created_at ON users(created_at)`,
    ],
  },
})
@Queryable()
export class DORM extends DurableObject {
  sql: SqlStorage;
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    this.env = env;
  }
}

export default {
  fetch: withStripeflare<Env, ExtendedUser>(
    async (request, env, ctx) => {
      const { user, client } = ctx;

      // Access your custom fields
      console.log(`User tier: ${user.subscription_tier}`);

      // Update custom fields
      if (client) {
        await client.exec(
          "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE access_token = ?",
          user.access_token
        );
      }

      return new Response(`Hello ${user.name}!`);
    },
    // Increment to reset/migrate data
    { version: "1" }
  ),
};
