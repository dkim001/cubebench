import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";
import { getPerson, WCA_ID_RE, type WcaPerson } from "./wca.ts";
import { sendVerificationCode } from "./mailer.ts";

/**
 * Accounts and sessions for the MVP.
 *
 * Identity types (a user's `key` is provider-scoped and unique):
 *   - google:<email>  — verified via Google Identity Services ID token
 *   - email:<email>   — verified via a 6-digit code sent to the address
 *   - wca:<wcaId>     — either linked-by-ID (unverified ownership) or, once
 *                       WCA OAuth is configured, verified via the WCA account
 *
 * Users persist as JSONL (last line per id wins, so updates are appends).
 * Sessions are in-memory, TTL'd and bounded.
 */

export type UserProfile = {
  displayName?: string;
  /** rough 3x3 average bucket, e.g. "sub-15"; auto-set from PB when WCA-linked */
  avg333?: string;
  /** linked WCA ID (may be set on an email/google account too) */
  wcaId?: string;
  /** cached 3x3 PB average in centiseconds, from the WCA API */
  pb333AverageCs?: number;
};

export type Provider = "google" | "email" | "wca";

export type User = {
  id: string;
  /** unique provider-scoped identity, e.g. "email:a@b.com" | "wca:2016PARK03" */
  key: string;
  provider: Provider;
  email?: string;
  wcaId?: string;
  name: string;
  /** whether the identity is cryptographically proven (Google, email code,
   *  WCA OAuth) vs. merely claimed (WCA-ID linking) */
  verified: boolean;
  createdAt: string;
  profile: UserProfile;
};

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
        // backward-compat for rows written before the identity refactor
        if (!u.key) u.key = `${u.provider}:${u.email ?? u.id}`;
        if (u.verified === undefined) u.verified = u.provider === "google";
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

// Memoize the loading PROMISE (not just the result) so two concurrent cold
// requests can't each read the file and race the assignment.
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

/** Find-or-create by identity key. Persists BEFORE mutating the in-memory
 *  map, so a failed write can't leave a phantom account that vanishes on
 *  restart. */
async function upsertUser(fields: {
  key: string;
  provider: Provider;
  name: string;
  email?: string;
  wcaId?: string;
  verified: boolean;
  profile?: UserProfile;
}): Promise<User> {
  const users = await loadUsers();
  const existing = await findByKey(fields.key);
  if (existing) return existing;
  const user: User = {
    id: randomBytes(12).toString("hex"),
    key: fields.key,
    provider: fields.provider,
    email: fields.email,
    wcaId: fields.wcaId,
    name: fields.name,
    verified: fields.verified,
    createdAt: new Date().toISOString(),
    profile: fields.profile ?? {},
  };
  await persist(user);
  users.set(user.id, user);
  return user;
}

export async function updateProfile(
  userId: string,
  profile: UserProfile,
): Promise<User | undefined> {
  const users = await loadUsers();
  const user = users.get(userId);
  if (!user) return undefined;
  // only merge defined keys, so a partial update can't wipe a sibling field
  const patch: UserProfile = {};
  for (const k of Object.keys(profile) as (keyof UserProfile)[]) {
    if (profile[k] !== undefined) (patch as Record<string, unknown>)[k] = profile[k];
  }
  const updated: User = { ...user, profile: { ...user.profile, ...patch } };
  await persist(updated);
  users.set(userId, updated);
  return updated;
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
  const user = await upsertUser({
    key: `google:${email}`,
    provider: "google",
    email,
    name: payload.name ?? email.split("@")[0],
    verified: true,
  });
  return issue(user);
}

// ---------- Email verification codes ----------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_PENDING = 5_000;

type Pending = {
  name: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
};
const pending = new Map<string, Pending>(); // email -> pending verification

function hashCode(email: string, code: string): string {
  // salt with the email so codes aren't comparable across addresses
  return createHash("sha256").update(`${email}:${code}`).digest("hex");
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Begin email sign-in: validate, generate a 6-digit code, "send" it. Returns
 * whether it was really delivered and, in dev (no provider), the code itself
 * so the flow is testable.
 */
export async function startEmailVerification(
  emailRaw: string,
  nameRaw: string,
): Promise<{ delivered: boolean; devCode?: string }> {
  const email = normalizeEmail(emailRaw);
  const name = nameRaw.trim();
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    throw new AuthError("Please enter a valid email address.", 400);
  }
  if (!name || name.length > 80) {
    throw new AuthError("Please enter a name (up to 80 characters).", 400);
  }
  if (pending.size >= MAX_PENDING && !pending.has(email)) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  pending.set(email, {
    name,
    codeHash: hashCode(email, code),
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });
  const { delivered } = await sendVerificationCode(email, code);
  return delivered ? { delivered } : { delivered, devCode: code };
}

export async function verifyEmailCode(
  emailRaw: string,
  codeRaw: string,
): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(emailRaw);
  const code = codeRaw.trim();
  const entry = pending.get(email);
  if (!entry || entry.expiresAt <= Date.now()) {
    pending.delete(email);
    throw new AuthError("That code has expired — request a new one.", 400);
  }
  if (entry.attempts >= MAX_CODE_ATTEMPTS) {
    pending.delete(email);
    throw new AuthError("Too many attempts — request a new code.", 429);
  }
  entry.attempts += 1;
  const expected = Buffer.from(entry.codeHash, "hex");
  const got = Buffer.from(hashCode(email, code), "hex");
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) {
    throw new AuthError("That code isn't right. Try again.", 400);
  }
  pending.delete(email);
  const user = await upsertUser({
    key: `email:${email}`,
    provider: "email",
    email,
    name: entry.name,
    verified: true,
  });
  return issue(user);
}

// ---------- WCA: link by ID (unverified ownership) ----------

function levelFromAverageCs(cs: number | null): string | undefined {
  if (cs === null) return undefined;
  if (cs < 1500) return "sub-15";
  if (cs < 2500) return "15–25";
  if (cs < 4000) return "25–40";
  if (cs < 6000) return "40–60";
  return "60+";
}

function profileFromPerson(person: WcaPerson): UserProfile {
  return {
    wcaId: person.wcaId,
    displayName: person.name,
    avg333: levelFromAverageCs(person.pb333AverageCs),
    ...(person.pb333AverageCs != null
      ? { pb333AverageCs: person.pb333AverageCs }
      : {}),
  };
}

/**
 * Sign in with a WCA ID. Verifies the ID exists via the public API and pulls
 * the real name + 3x3 PB, but does NOT prove the person owns it (that's what
 * WCA OAuth is for) — so the account is marked unverified.
 */
export async function signInWithWcaId(
  wcaIdRaw: string,
): Promise<{ user: User; token: string; person: WcaPerson }> {
  const wcaId = wcaIdRaw.trim().toUpperCase();
  if (!WCA_ID_RE.test(wcaId)) {
    throw new AuthError("That doesn't look like a WCA ID (e.g. 2016PARK03).", 400);
  }
  const person = await getPerson(wcaId);
  if (!person) {
    throw new AuthError("No WCA competitor with that ID.", 404);
  }
  const user = await upsertUser({
    key: `wca:${person.wcaId}`,
    provider: "wca",
    wcaId: person.wcaId,
    name: person.name,
    verified: false,
    profile: profileFromPerson(person),
  });
  return { ...issue(user), person };
}

// ---------- WCA: real OAuth (config-gated) ----------

const WCA_CLIENT_ID = process.env.WCA_CLIENT_ID ?? "";
const WCA_CLIENT_SECRET = process.env.WCA_CLIENT_SECRET ?? "";
const WCA_REDIRECT_URI = process.env.WCA_REDIRECT_URI ?? "";
const WCA_BASE = "https://www.worldcubeassociation.org";

export function wcaOAuthAvailable(): boolean {
  return Boolean(WCA_CLIENT_ID && WCA_CLIENT_SECRET && WCA_REDIRECT_URI);
}

export function wcaAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: WCA_CLIENT_ID,
    redirect_uri: WCA_REDIRECT_URI,
    response_type: "code",
    scope: "public",
    state,
  });
  return `${WCA_BASE}/oauth/authorize?${p.toString()}`;
}

/** Exchange an OAuth code for a token, read /me, sign the user in (verified). */
export async function signInWithWcaOAuth(
  code: string,
): Promise<{ user: User; token: string }> {
  if (!wcaOAuthAvailable()) {
    throw new AuthError("WCA sign-in isn't configured on this server.", 503);
  }
  let accessToken: string;
  try {
    const res = await fetch(`${WCA_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: WCA_CLIENT_ID,
        client_secret: WCA_CLIENT_SECRET,
        redirect_uri: WCA_REDIRECT_URI,
        code,
      }),
    });
    if (!res.ok) throw new Error(`token ${res.status}`);
    accessToken = ((await res.json()) as { access_token?: string }).access_token ?? "";
  } catch {
    throw new AuthError("WCA sign-in could not be completed.", 401);
  }
  if (!accessToken) throw new AuthError("WCA sign-in returned no token.", 401);

  let me: { id?: number; wca_id?: string; name?: string };
  try {
    const res = await fetch(`${WCA_BASE}/api/v0/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`me ${res.status}`);
    me = ((await res.json()) as { me?: typeof me }).me ?? {};
  } catch {
    throw new AuthError("Couldn't read your WCA profile.", 401);
  }

  // A WCA account may have no WCA ID yet (never competed); fall back to the
  // numeric account id so they still get a stable, verified identity.
  const identity = me.wca_id ?? (me.id != null ? `user-${me.id}` : "");
  if (!identity) throw new AuthError("WCA profile is missing an identity.", 401);

  let profile: UserProfile = {};
  if (me.wca_id) {
    const person = await getPerson(me.wca_id).catch(() => null);
    if (person) profile = profileFromPerson(person);
  }
  const user = await upsertUser({
    key: `wca:${identity}`,
    provider: "wca",
    wcaId: me.wca_id,
    name: me.name ?? identity,
    verified: true,
    profile,
  });
  return issue(user);
}
