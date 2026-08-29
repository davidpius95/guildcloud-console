// Which API key an Edge Function should authenticate with.
//
// The legacy `anon` and `service_role` keys are JWTs signed by the project's
// legacy JWT secret. That secret was exposed on 2026-08-29 and is being retired,
// and revoking it invalidates both keys at the same instant, with no partial
// failure -- so a function still reading SUPABASE_SERVICE_ROLE_KEY would stop
// working the moment it is revoked. For these two functions that means org
// invitations and device enrollment, both customer-facing.
//
// Supabase injects the replacements as JSON dictionaries keyed by API key name:
//   SUPABASE_SECRET_KEYS       {"default": "sb_secret_..."}
//   SUPABASE_PUBLISHABLE_KEYS  {"default": "sb_publishable_..."}
//
// Prefer those, fall back to the legacy variable. The fallback is what makes
// this deployable BEFORE the legacy secret is revoked rather than only after --
// deploying a change that requires the revocation, and revoking to make the
// deployment work, is a deadlock with a customer-facing outage in the middle.

function fromDictionary(variable: string): string | null {
  const raw = Deno.env.get(variable);
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A malformed dictionary must not take the function down while a working
    // legacy key is still available.
    console.error(`${variable} is not valid JSON; falling back to the legacy key`);
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const keys = parsed as Record<string, unknown>;

  // "default" is the name Supabase gives the first key, but a key can be
  // replaced under a different name -- and this project must replace its secret
  // key, which was exposed. Falling back to whatever key is present keeps the
  // function working through that swap instead of failing on a missing "default".
  const candidate = keys.default ?? Object.values(keys)[0];
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

/** Bypasses RLS. Never expose to a browser. */
export function secretApiKey(): string {
  const key = fromDictionary("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("no secret API key: set SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY");
  return key;
}

/** Safe alongside RLS; used only to verify a caller's own JWT. */
export function publishableApiKey(): string {
  const key = fromDictionary("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("no publishable API key: set SUPABASE_PUBLISHABLE_KEYS or SUPABASE_ANON_KEY");
  return key;
}
