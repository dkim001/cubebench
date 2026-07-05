import postgres from "postgres";

/**
 * Postgres connection (Supabase). Replaces the old file-backed user store and
 * in-memory sessions so accounts, sessions, and early-access emails survive
 * restarts and deploys.
 *
 * DATABASE_URL must be the Supabase *transaction pooler* string (port 6543).
 * That pooler doesn't support prepared statements, hence `prepare: false`.
 */
const url = process.env.DATABASE_URL ?? "";

if (!url) {
  // Fail loud at boot rather than on the first sign-in — a missing database
  // URL is an operator misconfiguration, not a runtime condition to paper over.
  throw new Error(
    "DATABASE_URL is not set. Point it at your Supabase transaction-pooler " +
      "connection string (port 6543).",
  );
}

export const sql = postgres(url, {
  prepare: false, // required for Supabase's transaction pooler (pgbouncer)
  max: 5, // bounded pool — small instance, avoid exhausting Postgres
  idle_timeout: 20,
  connect_timeout: 10,
});
