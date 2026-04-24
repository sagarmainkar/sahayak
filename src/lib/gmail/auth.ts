import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "@/lib/paths";

/**
 * Google OAuth2 refresh-token flow for Gmail.
 *
 * Credentials live in `.config/gmail.json`:
 *   {
 *     "clientId":     "...apps.googleusercontent.com",
 *     "clientSecret": "...",
 *     "refreshToken": "..."
 *   }
 *
 * Generate the refresh token once with the (optional) Python helper
 * or any standard OAuth desktop-flow tool, using scope
 *   https://www.googleapis.com/auth/gmail.readonly
 *
 * Access tokens are exchanged lazily and cached in-memory on
 * globalThis so Next dev-server hot-reloads don't keep hitting
 * Google's token endpoint on every request.
 */

export const GMAIL_CREDS_FILE = path.join(CONFIG_DIR, "gmail.json");
const TOKEN_URI = "https://oauth2.googleapis.com/token";

type GmailCreds = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

type CachedToken = {
  accessToken: string;
  expiresAt: number; // epoch ms
};

// Swap file + token cache live on globalThis so dev HMR doesn't
// trigger fresh OAuth exchanges on every module reload.
const CACHE_KEY = "__sahayakGmailToken";
type Cache = { token: CachedToken | null };
function cache(): Cache {
  const g = globalThis as unknown as { [CACHE_KEY]?: Cache };
  if (!g[CACHE_KEY]) g[CACHE_KEY] = { token: null };
  return g[CACHE_KEY]!;
}

export class GmailNotConfiguredError extends Error {
  readonly kind = "gmail_not_configured";
  constructor() {
    super(
      `Gmail credentials not found at ${path.relative(process.cwd(), GMAIL_CREDS_FILE)}. ` +
        `Create it with {clientId, clientSecret, refreshToken}.`,
    );
    this.name = "GmailNotConfiguredError";
  }
}

async function readCreds(): Promise<GmailCreds> {
  if (!existsSync(GMAIL_CREDS_FILE)) {
    throw new GmailNotConfiguredError();
  }
  let raw: string;
  try {
    raw = await fs.readFile(GMAIL_CREDS_FILE, "utf8");
  } catch {
    throw new GmailNotConfiguredError();
  }
  let parsed: Partial<GmailCreds>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`gmail.json is not valid JSON`);
  }
  const { clientId, clientSecret, refreshToken } = parsed;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      `gmail.json missing required keys: clientId, clientSecret, refreshToken`,
    );
  }
  return { clientId, clientSecret, refreshToken };
}

async function refreshAccessToken(creds: GmailCreds): Promise<CachedToken> {
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  });
  const r = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`gmail token refresh ${r.status}: ${errText.slice(0, 200)}`);
  }
  const j = (await r.json()) as {
    access_token: string;
    expires_in: number;
    token_type?: string;
  };
  // Shave 60s off the TTL so a call that beats the wire by ~seconds
  // doesn't race with a mid-request expiry.
  return {
    accessToken: j.access_token,
    expiresAt: Date.now() + (j.expires_in - 60) * 1000,
  };
}

/** Get a valid access token, exchanging the refresh token if the
 *  cached one is missing/expired. Throws GmailNotConfiguredError if
 *  the credentials file isn't present — tool handlers surface that
 *  as a friendly "set up .config/gmail.json" message. */
export async function getAccessToken(): Promise<string> {
  const c = cache();
  const now = Date.now();
  if (c.token && c.token.expiresAt > now) {
    return c.token.accessToken;
  }
  const creds = await readCreds();
  c.token = await refreshAccessToken(creds);
  return c.token.accessToken;
}

/** Force a fresh token exchange. Call after a 401 from the API so
 *  transient upstream rejections don't serve a stale token next. */
export function invalidateToken(): void {
  cache().token = null;
}
