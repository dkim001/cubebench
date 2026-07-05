-- Cube Bench database schema (Supabase / Postgres).
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: every statement is IF NOT EXISTS.

-- Accounts. Replaces the old server/data/users.jsonl file.
create table if not exists users (
  id                 text primary key,
  key                text unique not null,   -- provider-scoped identity, e.g. "email:a@b.com"
  provider           text not null,          -- "google" | "email"
  email              text not null,
  name               text not null,
  password_hash      text,                   -- scrypt "salt:hash", email accounts only
  created_at         timestamptz not null default now(),
  profile            jsonb not null default '{}'::jsonb,
  stripe_customer_id text,
  sub_status         text,                   -- trialing | active | past_due | canceled | incomplete | none
  current_period_end bigint                  -- epoch ms the paid period ends
);
create index if not exists users_stripe_customer_idx on users (stripe_customer_id);

-- Login sessions. Replaces the old in-memory session map, so logins survive
-- restarts and deploys.
create table if not exists sessions (
  token      text primary key,
  user_id    text not null references users (id) on delete cascade,
  expires_at bigint not null                 -- epoch ms
);
create index if not exists sessions_expires_idx on sessions (expires_at);

-- Pre-launch email capture. Replaces server/data/early-access.jsonl.
create table if not exists early_access (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- Row Level Security. Our server connects with the full Postgres role, which
-- BYPASSES RLS, so these queries are unaffected. But Supabase auto-exposes a
-- public REST API (anon key) for public-schema tables; enabling RLS with NO
-- policies denies that API all access, so no one can read these tables —
-- including password hashes — through it. Do not add policies.
alter table users        enable row level security;
alter table sessions     enable row level security;
alter table early_access enable row level security;
