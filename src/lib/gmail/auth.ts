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
 * or any standard OAuth desktop-flow tool. Choose scopes based on needs:
 *
 *   Scope                          | Tools
 *   ------------------------------ | ---------------------------
 *   gmail.readonly                 | gmail_search, gmail_read
 *   gmail.modify                   | gmail_delete, gmail_label
 *   gmail.send  (or gmail.compose) | gmail_reply
 *
 *   Recommended (all-in-one):
 *     https://www.googleapis.com/auth/gmail.modify
 *   or for full control:
 *     https://www.googleapis.com/auth/gmail.modify
 *     https://www.googleapis.com/auth/gmail.send
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
const INFLIGHT_KEY = "__sahayakGmailTokenInflight";
type Cache = { token: CachedToken | null };
function cache(): Cache {
  const g = globalThis as unknown as { [CACHE_KEY]?: Cache };
  if (!g[CACHE_KEY]) g[CACHE_KEY] = { token: null };
  return g[CACHE_KEY]!;
}
function inflight(): { p: Promise<CachedToken> | null } {
  const g = globalThis as unknown as { [INFLIGHT_KEY]?: { p: Promise<CachedToken> | null } };
  if (!g[INFLIGHT_KEY]) g[INFLIGHT_KEY] = { p: null };
  return g[INFLIGHT_KEY]!;
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
  if (c.token && c.token.expiresAt > Date.now()) return c.token.accessToken;
  const inf = inflight();
  if (!inf.p) {
    inf.p = readCreds()
      .then(refreshAccessToken)
      .then((t) => { c.token = t; return t; })
      .finally(() => { inf.p = null; });
  }
  return (await inf.p).accessToken;
}

/** Force the next getAccessToken() to re-exchange the refresh token.
 *  Used after a 401 to recover from a revoked/expired token. */
export function invalidateToken(): void {
  cache().token = null;
}
