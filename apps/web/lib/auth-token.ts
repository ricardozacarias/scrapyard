// Edge-safe (no node: imports, no "server-only") so both the middleware and the
// login server action can use it. The auth cookie holds a SHA-256 of APP_PASSWORD
// rather than the password itself — APP_PASSWORD never leaves the server, so the
// token can't be forged, and the raw password isn't sitting in the cookie jar.

export const AUTH_COOKIE = "sy_auth";

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`scrapyard::${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
