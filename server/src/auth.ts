import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

/**
 * Accounts and sessions.
 *
 * Two ways in:
 *   - google:<email> — verified via a Google Identity Services ID token
 *   - email:<email>  — email + password (scrypt-hashed, per-user salt)
 *
 * Users persist as JSONL (last line per id wins, so updates are appends).
 * Sessions are in-memory, TTL'd and bounded. Billing state (Stripe customer +
 * subscription status) lives on the user and is written by the webhook.
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

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const USERS_FILE = join(DATA_DIR, "users.jsonl");

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

// ---------- user store ----------

let usersLoading: Promise<Map<string, User>> | null = null;

async function readUsers(): Promise<Map<string, User>> {
  const map = new Map<string, User>();
  try {
    const raw = await readFile(USERS_FILE, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const u = JSON.parse(line) as User;
        if (!u.key) u.key = `${u.provider}:${u.email}`;
        if (u.id) map.set(u.id, u); // later lines overwrite: append = update
      } catch {
        // skip a malformed line rather than failing every sign-in
      }
    }
  } catch {
    // no users yet
  }
  return map;
}

// Memoize the loading PROMISE so two cold requests can't race the assignment.
function loadUsers(): Promise<Map<string, User>> {
  if (!usersLoading) usersLoading = readUsers();
  return usersLoading;
}

async function persist(user: User): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(USERS_FILE, JSON.stringify(user) + "\n", "utf8");
}

async function findByKey(key: string): Promise<User | undefined> {
  const users = await loadUsers();
  for (const u of users.values()) if (u.key === key) return u;
  return undefined;
}

/** Persist BEFORE mutating the in-memory map, so a failed write can't leave a
 *  phantom account that vanishes on restart. */
async function insertUser(user: User): Promise<User> {
  const users = await loadUsers();
  await persist(user);
  users.set(user.id, user);
  return user;
}

/** Merge a partial patch onto a user and persist. Used by profile + billing. */
export async function patchUser(
  userId: string,
  patch: Partial<User>,
): Promise<User | undefined> {
  const users = await loadUsers();
  const user = users.get(userId);
  if (!user) return undefined;
  const updated: User = {
    ...user,
    ...patch,
    profile: { ...user.profile, ...(patch.profile ?? {}) },
  };
  await persist(updated);
  users.set(userId, updated);
  return updated;
}

export async function findByStripeCustomer(
  customerId: string,
): Promise<User | undefined> {
  const users = await loadUsers();
  for (const u of users.values()) {
    if (u.stripeCustomerId === customerId) return u;
  }
  return undefined;
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
  return (await loadUsers()).get(userId);
}

// ---------- sessions (in-memory, TTL'd and bounded) ----------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_SESSIONS = 10_000;

type Session = { userId: string; expiresAt: number };
const sessions = new Map<string, Session>();

export function createSession(userId: string): string {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest !== undefined) sessions.delete(oldest);
  }
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export async function userForToken(token: string): Promise<User | undefined> {
  const session = sessions.get(token);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return undefined;
  }
  return (await loadUsers()).get(session.userId);
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

function issue(user: User): { user: User; token: string } {
  return { user, token: createSession(user.id) };
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
