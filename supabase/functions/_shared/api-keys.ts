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

// Which variable each key actually came from. Reported at boot, never the value.
//
// This exists because the legacy fallback below hides the thing we most need to
// know. A function that works today tells you nothing about whether it survives
// revoking the legacy JWT secret: if SUPABASE_SECRET_KEYS is absent it silently
// keeps using SUPABASE_SERVICE_ROLE_KEY and works perfectly -- right up to the
// moment that key is revoked, and then org invitations and device enrollment
// fail together. Boot-time logging is what makes that distinction observable
// before the irreversible step rather than after it.
const keySources: Record<string, string> = {};

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
  const fromKeys = fromDictionary("SUPABASE_SECRET_KEYS");
  const key = fromKeys ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("no secret API key: set SUPABASE_SECRET_KEYS or SUPABASE_SERVICE_ROLE_KEY");
  keySources.secret = fromKeys ? "SUPABASE_SECRET_KEYS" : "SUPABASE_SERVICE_ROLE_KEY (legacy)";
  return key;
}

/** Safe alongside RLS; used only to verify a caller's own JWT. */
export function publishableApiKey(): string {
  const fromKeys = fromDictionary("SUPABASE_PUBLISHABLE_KEYS");
  const key = fromKeys ?? Deno.env.get("SUPABASE_ANON_KEY");
  if (!key) throw new Error("no publishable API key: set SUPABASE_PUBLISHABLE_KEYS or SUPABASE_ANON_KEY");
  keySources.publishable = fromKeys ? "SUPABASE_PUBLISHABLE_KEYS" : "SUPABASE_ANON_KEY (legacy)";
  return key;
}

// Runs at module load, which happens on every cold boot -- including a boot
// caused by an unauthenticated request that verify_jwt rejects before the
// handler runs. That is deliberate: it makes the answer observable without a
// user session, and without invoking any customer-facing side effect.
//
// Names only. A value must never reach a log line.
try {
  secretApiKey();
  publishableApiKey();
  console.log(JSON.stringify({ where: "api_keys_boot", ...keySources }));
} catch (e) {
  console.error(JSON.stringify({ where: "api_keys_boot", error: String(e) }));
}
