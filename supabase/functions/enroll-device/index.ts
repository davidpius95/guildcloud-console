// Real device self-enrollment (Phase 3 of the team-access plan). Unlike
// site-worker-guild-a (cron-triggered, no user session), this function is
// invoked directly by an authenticated console user - verify_jwt stays ON
// so we know exactly who's asking, not a static/anon caller.
//
// It does NOT run `tailscale up` itself - there is no trusted execution
// surface on a customer's own personal laptop the way there is on a VM
// this platform already controls via the Proxmox guest agent. Instead it
// mints a real reusable Tailscale auth key (90-day max expiry - Tailscale's
// own ceiling, not a product choice), stashes it behind a random token on
// the membership row, and returns a command pointing at a public (but
// token-gated) Next.js route that serves the actual install script - the
// word "Tailscale" never has to appear anywhere in the console UI itself,
// only inside the script the user chooses to run.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TAILSCALE_TAILNET = "tail345216.ts.net";
const TAILSCALE_TAG_OWNER = "davidpius95@gmail.com";
const MEMBER_TAG = "tag:guildcloud-member";

// The CONSOLE_URL secret never actually took effect across several real
// dashboard + CLI attempts (see PROJECT_STATUS.md, 2026-08-25) - this
// function silently kept falling back to localhost regardless. The caller
// now passes its own known-good origin in the request body instead (see
// requestDeviceEnrollment in app/console/networking/actions.ts); CONSOLE_URL
// stays as a legacy fallback in case that's ever unset for some other
// caller, and the hardcoded fallback below points at the one confirmed-real
// production deployment rather than localhost.
function safeConsoleUrl(candidate: unknown): string | null {
  if (typeof candidate !== "string") return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === "https:" || parsed.hostname === "localhost") return candidate;
  } catch {
    // fall through
  }
  return null;
}

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getVaultSecret(supabase: ReturnType<typeof createClient>, name: string) {
  const { data, error } = await supabase.rpc("get_vault_secret", { secret_name: name });
  if (error || !data) throw new Error(`could not read vault secret ${name}: ${error?.message}`);
  return data as string;
}

async function tailscaleAccessToken(supabase: ReturnType<typeof createClient>) {
  const clientId = await getVaultSecret(supabase, "tailscale_guildcloud_worker_oauth_client_id");
  const clientSecret = await getVaultSecret(supabase, "tailscale_guildcloud_worker_oauth_client_secret");
  const resp = await fetch("https://api.tailscale.com/api/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(`tailscale oauth token exchange -> ${resp.status}: ${JSON.stringify(json)}`);
  return json.access_token as string;
}

async function ts(token: string, method: string, path: string, body?: unknown) {
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { ...init.headers, "Content-Type": "application/json" };
  }
  const resp = await fetch(`https://api.tailscale.com/api/v2/${path}`, init);
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Tailscale ${method} ${path} -> ${resp.status}: ${JSON.stringify(json)}`);
  return json;
}

// Ensures tag:guildcloud-member can reach every applied project's tenant
// tag in this org. There's no per-project membership concept in this
// schema yet (memberships are org-wide) so this grants reachability to
// every project in the org, same scope access_grants records today
// without yet enforcing. Same GitOps-exception precedent as
// applyPendingProjectAcls in site-worker-guild-a - per-tag grants can't
// wait on a human merging a PR.
async function ensureMemberGrants(supabase: ReturnType<typeof createClient>, token: string, organizationId: string) {
  const { data: projects } = await supabase
    .from("projects")
    .select("slug")
    .eq("organization_id", organizationId)
    .eq("tailscale_acl_state", "applied");
  if (!projects || projects.length === 0) return;

  const policy = await ts(token, "GET", `tailnet/${TAILSCALE_TAILNET}/acl`);
  policy.tagOwners = policy.tagOwners ?? {};
  policy.tagOwners[MEMBER_TAG] = policy.tagOwners[MEMBER_TAG] ?? [TAILSCALE_TAG_OWNER];
  policy.grants = policy.grants ?? [];

  let changed = false;
  for (const project of projects as { slug: string }[]) {
    const tenantTag = `tag:guildcloud-tenant-${project.slug}`;
    const exists = (policy.grants as Array<{ src?: string[]; dst?: string[] }>).some(
      (g) => g.src?.includes(MEMBER_TAG) && g.dst?.includes(tenantTag),
    );
    if (!exists) {
      policy.grants.push({ src: [MEMBER_TAG], dst: [tenantTag], ip: ["*"] });
      changed = true;
    }
  }
  if (changed) await ts(token, "POST", `tailnet/${TAILSCALE_TAILNET}/acl`, policy);
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "not authenticated" }), { status: 401 });

    // Identify the real caller via their own session (anon key + forwarded
    // auth header) - separate from the service-role client used below for
    // privileged writes, so we always know exactly who's asking.
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return new Response(JSON.stringify({ error: "not authenticated" }), { status: 401 });

    const supabase = serviceClient();
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);

    // Revocation path: an Owner/Admin removing a teammate needs that
    // teammate's device deauthorized too (the UI already promises this:
    // "network permission and server login revoked together") - but the
    // console app can't call the Tailscale API itself (no Vault access),
    // so removeMember routes through here instead. Best-effort, matching
    // processPendingInstanceDeletions's own "a leftover device is a
    // hygiene gap, not a live credential leak" trade-off - a failure here
    // must never block the membership row from being removed.
    if (req.method === "DELETE") {
      const targetMembershipId = body.membershipId as string | undefined;
      if (!targetMembershipId) return new Response(JSON.stringify({ error: "membershipId required" }), { status: 400 });

      const { data: caller } = await supabase
        .from("memberships")
        .select("id, organization_id, role")
        .eq("user_id", userData.user.id)
        .maybeSingle();
      if (!caller || (caller.role !== "Owner" && caller.role !== "Admin")) {
        return new Response(JSON.stringify({ error: "not authorized" }), { status: 403 });
      }

      const { data: target } = await supabase
        .from("memberships")
        .select("id, organization_id, tailscale_device_id")
        .eq("id", targetMembershipId)
        .maybeSingle();
      if (!target || target.organization_id !== caller.organization_id) {
        return new Response(JSON.stringify({ error: "membership not found in your organization" }), { status: 404 });
      }

      if (target.tailscale_device_id) {
        const revokeToken = await tailscaleAccessToken(supabase);
        try {
          await ts(revokeToken, "DELETE", `device/${target.tailscale_device_id}`);
        } catch (e) {
          console.log(JSON.stringify({ ok: false, where: "revoke_device", membership_id: targetMembershipId, error: String(e) }));
        }
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }

    const { data: membership, error: membershipError } = await supabase
      .from("memberships")
      .select("id, organization_id, device_enrolled, enrollment_token, enrollment_token_expires_at")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (membershipError || !membership) {
      return new Response(JSON.stringify({ error: "no membership found for this user" }), { status: 404 });
    }

    const consoleUrl =
      safeConsoleUrl(body.consoleUrl) ??
      Deno.env.get("CONSOLE_URL") ??
      "https://guildcloud-console.vercel.app";

    // Fast path. The link this returns is deliberately reusable for 90 days,
    // yet every click used to mint a brand new Tailscale auth key, rewrite the
    // vault secret, and overwrite the membership token - roughly ten sequential
    // network round trips (two vault reads, an OAuth exchange, an ACL read, a
    // key create, two writes), which measured ~3s before the command appeared.
    // Worse, it silently retired the previous link, so a link the member had
    // already saved or shared stopped working every time they looked at it
    // again, and each rotation orphaned another vault secret.
    //
    // If a valid, unexpired token already exists, hand back the same command.
    // Rotation is now explicit: pass regenerate: true.
    const existingToken = membership.enrollment_token as string | null;
    const existingExpiry = membership.enrollment_token_expires_at as string | null;
    const stillValid =
      existingToken && existingExpiry && new Date(existingExpiry).getTime() > Date.now();
    if (stillValid && body.regenerate !== true) {
      return new Response(
        JSON.stringify({
          command: `curl -fsSL ${consoleUrl}/api/enroll/${existingToken} | sh`,
          reused: true,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    const token = await tailscaleAccessToken(supabase);
    await ensureMemberGrants(supabase, token, membership.organization_id as string);

    const hostname = `member-${(membership.id as string).slice(0, 8)}`;
    // Reusable, per user decision 2026-08-25 (see the reusable_enrollment_link
    // migration): the same key can authenticate multiple `tailscale up`
    // invocations, so this one link can be re-run on more than one device or
    // re-run again later without coming back to regenerate it. 7776000s
    // (90 days) is Tailscale's own max expirySeconds for an authkey - there
    // is no "never expires" option at the API level, so 90 days is the
    // longest a single link can stay valid; clicking "Connect this device"
    // again mints a fresh key/link and the old one stops resolving (its
    // membership row's enrollment_token gets overwritten), which is the
    // actual revocation path today, not an expiry-driven one.
    const key = await ts(token, "POST", `tailnet/${TAILSCALE_TAILNET}/keys`, {
      capabilities: {
        devices: { create: { reusable: true, ephemeral: false, preauthorized: true, tags: [MEMBER_TAG] } },
      },
      expirySeconds: 7776000,
    });

    const enrollmentToken = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7776000 * 1000).toISOString();
    await supabase
      .from("memberships")
      .update({ enrollment_token: enrollmentToken, enrollment_token_expires_at: expiresAt })
      .eq("id", membership.id);

    // Stash the real key behind the token rather than returning it directly
    // - the enroll route (app/api/enroll/[token]) is what actually holds and
    // redeems it. No longer reveal-once (see redeem_enrollment_token) - the
    // same token can be redeemed repeatedly until it's regenerated.
    await supabase.rpc("set_vault_secret", {
      p_secret_name: `enrollment_key_${enrollmentToken}`,
      p_secret_value: JSON.stringify({ key: key.key, hostname }),
    });

    return new Response(
      JSON.stringify({ command: `curl -fsSL ${consoleUrl}/api/enroll/${enrollmentToken} | sh`, reused: false }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
