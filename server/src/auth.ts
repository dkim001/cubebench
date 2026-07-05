import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { sql } from "./db.ts";

/**
 * Accounts and sessions.
 *
 * Two ways in:
 *   - google:<email> — verified via a Google Identity Services ID token
 *   - email:<email>  — email + password (scrypt-hashed, per-user salt)
 *
 * Users and sessions live in Postgres (Supabase), so they survive restarts and
 * deploys. Billing state (Stripe customer + subscription status) lives on the
 * user row and is written by the webhook.
 */

export type SubStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "none";

export type UserProfile = {
  displayName?: string;
  /** rough 3x3 average bucket, e.g. "sub-15" */
  avg333?: string;
};

export type Provider = "google" | "email";

export type User = {
  id: string;
  /** unique provider-scoped identity, e.g. "email:a@b.com" */
  key: string;
  provider: Provider;
  email: string;
  name: string;
  /** scrypt hash "salt:hash" — email accounts only */
  passwordHash?: string;
  createdAt: string;
  profile: UserProfile;
  // ---- billing (written by the Stripe webhook) ----
  stripeCustomerId?: string;
  subStatus?: SubStatus;
  /** epoch ms the current paid period ends; access holds until then */
  currentPeriodEnd?: number;
};

/** A user is Pro while trialing/active, or until a canceled period expires. */
export function isPro(user: User | undefined | null): boolean {
  if (!user) return false;
  if (user.subStatus === "trialing" || user.subStatus === "active") return true;
  if (
    user.subStatus === "canceled" &&
    user.currentPeriodEnd &&
    user.currentPeriodEnd > Date.now()
  ) {
    return true; // canceled but paid through the period
  }
  return false;
}

/** The shape we send to clients — never leak the password hash. */
export function publicUser(user: User) {
  const { passwordHash: _drop, ...rest } = user;
  return { ...rest, pro: isPro(user) };
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export function googleAuthAvailable(): boolean {
  return googleClient !== null;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

// ---------- password hashing (scrypt, built-in) ----------

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const got = scryptSync(password, salt, 64);
  return expected.length === got.length && timingSafeEqual(expected, got);
}

// ---------- user store (Postgres) ----------

/** Map a database row (snake_case) to the User shape (camelCase). */
type UserRow = {
  id: string;
  key: string;
  provider: Provider;
  email: string;
  name: string;
  password_hash: string | null;
  created_at: Date | string;
  profile: UserProfile | null;
  stripe_customer_id: string | null;
  sub_status: SubStatus | null;
  current_period_end: string | number | null;
};

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    key: row.key,
    provider: row.provider,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash ?? undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    profile: row.profile ?? {},
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    subStatus: row.sub_status ?? undefined,
    // int8 comes back as a string from postgres.js; epoch ms fits in a Number.
    currentPeriodEnd:
      row.current_period_end != null ? Number(row.current_period_end) : undefined,
  };
}

async function findByKey(key: string): Promise<User | undefined> {
  const rows = await sql<UserRow[]>`select * from users where key = ${key} limit 1`;
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

async function insertUser(user: User): Promise<User> {
  await sql`
    insert into users (
      id, key, provider, email, name, password_hash, created_at, profile
    ) values (
      ${user.id}, ${user.key}, ${user.provider}, ${user.email}, ${user.name},
      ${user.passwordHash ?? null}, ${user.createdAt}, ${sql.json(user.profile)}
    )
  `;
  return user;
}

/** Merge a partial patch onto a user and persist. Used by profile + billing. */
export async function patchUser(
  userId: string,
  patch: Partial<User>,
): Promise<User | undefined> {
  const user = await getUser(userId);
  if (!user) return undefined;
  const updated: User = {
    ...user,
    ...patch,
    profile: { ...user.profile, ...(patch.profile ?? {}) },
  };
  // Only mutable columns; id/key/provider/email/createdAt are immutable.
  await sql`
    update users set
      name = ${updated.name},
      password_hash = ${updated.passwordHash ?? null},
      profile = ${sql.json(updated.profile)},
      stripe_customer_id = ${updated.stripeCustomerId ?? null},
      sub_status = ${updated.subStatus ?? null},
      current_period_end = ${updated.currentPeriodEnd ?? null}
    where id = ${userId}
  `;
  return updated;
}

export async function findByStripeCustomer(
  customerId: string,
): Promise<User | undefined> {
  const rows = await sql<UserRow[]>`
    select * from users where stripe_customer_id = ${customerId} limit 1
  `;
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

export async function updateProfile(
  userId: string,
  profile: UserProfile,
): Promise<User | undefined> {
  const patch: UserProfile = {};
  for (const k of Object.keys(profile) as (keyof UserProfile)[]) {
    if (profile[k] !== undefined) (patch as Record<string, unknown>)[k] = profile[k];
  }
  return patchUser(userId, { profile: patch });
}

export async function getUser(userId: string): Promise<User | undefined> {
  const rows = await sql<UserRow[]>`select * from users where id = ${userId} limit 1`;
  return rows[0] ? rowToUser(rows[0]) : undefined;
}

// ---------- sessions (Postgres, TTL'd) ----------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await sql`
    insert into sessions (token, user_id, expires_at)
    values (${token}, ${userId}, ${expiresAt})
  `;
  return token;
}

export async function userForToken(token: string): Promise<User | undefined> {
  if (!token) return undefined;
  const rows = await sql<{ user_id: string; expires_at: string }[]>`
    select user_id, expires_at from sessions where token = ${token} limit 1
  `;
  const session = rows[0];
  if (!session) return undefined;
  if (Number(session.expires_at) <= Date.now()) {
    await sql`delete from sessions where token = ${token}`;
    return undefined;
  }
  return getUser(session.user_id);
}

export async function destroySession(token: string): Promise<void> {
  if (!token) return;
  await sql`delete from sessions where token = ${token}`;
}

async function issue(user: User): Promise<{ user: User; token: string }> {
  return { user, token: await createSession(user.id) };
}

// ---------- Google ----------

export async function signInWithGoogle(
  credential: string,
): Promise<{ user: User; token: string }> {
  if (!googleClient) {
    throw new AuthError(
      "Google sign-in isn't configured on this server (GOOGLE_CLIENT_ID is not set).",
      503,
    );
  }
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AuthError("Google sign-in could not be verified.", 401);
  }
  if (!payload?.email) {
    throw new AuthError("Google account has no email we can use.", 401);
  }
  const email = payload.email.toLowerCase();
  const existing = await findByKey(`google:${email}`);
  if (existing) return issue(existing);
  const user = await insertUser({
    id: randomBytes(12).toString("hex"),
    key: `google:${email}`,
    provider: "google",
    email,
    name: payload.name ?? email.split("@")[0],
    createdAt: new Date().toISOString(),
    profile: {},
  });
  return issue(user);
}

// ---------- Email + password ----------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function signUpWithEmail(
  emailRaw: string,
  password: string,
  nameRaw: string,
): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(emailRaw);
  const name = nameRaw.trim();
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    throw new AuthError("Please enter a valid email address.", 400);
  }
  if (!name || name.length > 80) {
    throw new AuthError("Please enter a name (up to 80 characters).", 400);
  }
  if (password.length < 8 || password.length > 200) {
    throw new AuthError("Password must be at least 8 characters.", 400);
  }
  if (await findByKey(`email:${email}`)) {
    throw new AuthError("An account with that email already exists — sign in instead.", 409);
  }
  const user = await insertUser({
    id: randomBytes(12).toString("hex"),
    key: `email:${email}`,
    provider: "email",
    email,
    name,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    profile: {},
  });
  return issue(user);
}

export async function signInWithEmail(
  emailRaw: string,
  password: string,
): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(emailRaw);
  const user = await findByKey(`email:${email}`);
  // Same error whether the email is unknown or the password is wrong, so we
  // don't reveal which emails have accounts.
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    throw new AuthError("Wrong email or password.", 401);
  }
  return issue(user);
}
