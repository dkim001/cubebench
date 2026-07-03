import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { OAuth2Client } from "google-auth-library";

/**
 * Accounts and sessions for the MVP.
 *
 * - Google sign-in is REAL: the client sends the Google Identity Services
 *   ID token and we verify its signature + audience with google-auth-library.
 *   Requires GOOGLE_CLIENT_ID in the environment; without it the endpoint
 *   reports itself unavailable rather than pretending.
 * - Email accounts are passwordless on purpose (name + email only). This is
 *   an MVP convenience, not hidden: there is no password theater to imply
 *   security that doesn't exist. Real credentials arrive with real auth.
 * - Users persist as JSONL (last line per id wins, so profile updates are
 *   appends). Sessions are in-memory: a server restart signs everyone out,
 *   which is acceptable for this stage and keeps no token material on disk.
 */

export type UserProfile = {
  displayName?: string;
  /** rough self-reported 3x3 average bucket, e.g. "sub-15", "30-60" */
  avg333?: string;
};

export type User = {
  id: string;
  email: string;
  name: string;
  provider: "google" | "email";
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

// ---------- user store ----------

let usersById: Map<string, User> | null = null;

async function loadUsers(): Promise<Map<string, User>> {
  if (usersById) return usersById;
  const map = new Map<string, User>();
  try {
    const raw = await readFile(USERS_FILE, "utf8");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const u = JSON.parse(line) as User;
        if (u.id) map.set(u.id, u); // later lines overwrite: append = update
      } catch {
        // skip a malformed line rather than failing every sign-in
      }
    }
  } catch {
    // no users yet
  }
  usersById = map;
  return map;
}

async function persist(user: User): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(USERS_FILE, JSON.stringify(user) + "\n", "utf8");
}

async function findByEmail(email: string): Promise<User | undefined> {
  const users = await loadUsers();
  for (const u of users.values()) {
    if (u.email === email) return u;
  }
  return undefined;
}

async function upsertUser(
  email: string,
  name: string,
  provider: User["provider"],
): Promise<User> {
  const users = await loadUsers();
  const existing = await findByEmail(email);
  if (existing) return existing;
  const user: User = {
    id: randomBytes(12).toString("hex"),
    email,
    name,
    provider,
    createdAt: new Date().toISOString(),
    profile: {},
  };
  users.set(user.id, user);
  await persist(user);
  return user;
}

export async function updateProfile(
  userId: string,
  profile: UserProfile,
): Promise<User | undefined> {
  const users = await loadUsers();
  const user = users.get(userId);
  if (!user) return undefined;
  const updated: User = { ...user, profile: { ...user.profile, ...profile } };
  users.set(userId, updated);
  await persist(updated);
  return updated;
}

// ---------- sessions (in-memory) ----------

const sessions = new Map<string, string>(); // token -> userId

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, userId);
  return token;
}

export async function userForToken(token: string): Promise<User | undefined> {
  const userId = sessions.get(token);
  if (!userId) return undefined;
  return (await loadUsers()).get(userId);
}

export function destroySession(token: string): void {
  sessions.delete(token);
}

// ---------- sign-in flows ----------

/**
 * Verify a Google Identity Services ID token (signature, expiry, audience)
 * and sign the user in. Throws with a clear message on any failure.
 */
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
  const user = await upsertUser(
    payload.email.toLowerCase(),
    payload.name ?? payload.email.split("@")[0],
    "google",
  );
  return { user, token: createSession(user.id) };
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function signInWithEmail(
  emailRaw: string,
  nameRaw: string,
): Promise<{ user: User; token: string }> {
  const email = emailRaw.trim().toLowerCase();
  const name = nameRaw.trim();
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    throw new AuthError("Please enter a valid email address.", 400);
  }
  if (!name || name.length > 80) {
    throw new AuthError("Please enter a name (up to 80 characters).", 400);
  }
  const user = await upsertUser(email, name, "email");
  return { user, token: createSession(user.id) };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}
