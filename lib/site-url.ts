import "server-only";
import { headers } from "next/headers";

// The origin the current request actually came in on - e.g.
// http://192.168.8.179:3100 when a device on the LAN reaches this dev
// server via its network IP rather than localhost. Getting this wrong
// breaks OAuth and email-link redirects for exactly that case: Supabase
// redirects the browser back to whatever origin was passed at sign-in
// time, and a hardcoded "http://localhost:3100" resolves to the
// requesting device's OWN localhost, not this machine's - the browser
// then reports "the site can't be reached" because nothing is listening
// there.
//
// The Origin header is sent on the POST these Server Actions are invoked
// with (a same-origin form submission), so it reflects the browser's own
// address bar, not this server's. Falls back to x-forwarded-host (behind
// a reverse proxy that doesn't forward Origin) and finally to
// NEXT_PUBLIC_SITE_URL for a real deployment where that's set explicitly.
export async function getSiteUrl(): Promise<string> {
  const h = await headers();

  const origin = h.get("origin");
  if (origin) return origin;

  const forwardedHost = h.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = h.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }

  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
}
