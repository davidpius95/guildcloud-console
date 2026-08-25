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
const MEMBER_TAG_PREFIX = "tag:guildcloud-member-";

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

// A device gets a tag unique to its membership. It intentionally receives no
// broad grant here: the site worker derives member->instance grants from the
// access_grants table. This means joining the tailnet alone never grants a
// route to other customer VMs, management devices, or unrelated services.
async function ensureMemberTag(token: string, membershipId: string) {
  const memberTag = `${MEMBER_TAG_PREFIX}${membershipId.slice(0, 8)}`;
  const policy = await ts(token, "GET", `tailnet/${TAILSCALE_TAILNET}/acl`);
  policy.tagOwners = policy.tagOwners ?? {};
  if (policy.tagOwners[memberTag]) return memberTag;
  policy.tagOwners[memberTag] = [TAILSCALE_TAG_OWNER];
  await ts(token, "POST", `tailnet/${TAILSCALE_TAILNET}/acl`, policy);
  return memberTag;
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
      .select("id, organization_id, role")
      .eq("user_id", userData.user.id)
      .maybeSingle();
    if (membershipError || !membership) {
      return new Response(JSON.stringify({ error: "no membership found for this user" }), { status: 404 });
    }

    const consoleUrl =
      safeConsoleUrl(body.consoleUrl) ??
      Deno.env.get("CONSOLE_URL") ??
      "https://guildcloud-console.vercel.app";

    const instanceId = typeof body.instanceId === "string" ? body.instanceId : "";
    if (!instanceId) return new Response(JSON.stringify({ error: "instanceId required" }), { status: 400 });

    const { data: instance } = await supabase
      .from("instances")
      .select("id, organization_id, project_id, state, private_hostname")
      .eq("id", instanceId)
      .eq("organization_id", membership.organization_id)
      .maybeSingle();
    if (!instance || instance.state !== "ready" || !instance.private_hostname) {
      return new Response(JSON.stringify({ error: "This instance is not ready for private access yet." }), { status: 409 });
    }

    // Owners/Admins may create a connection for a VM in their organization,
    // but that decision is materialized as one exact instance grant. Everyone
    // else must already have that exact grant; a project-wide or role-only
    // entitlement never turns into a tailnet route.
    const { data: exactGrant } = await supabase
      .from("access_grants")
      .select("id")
      .eq("membership_id", membership.id)
      .eq("project_id", instance.project_id)
      .eq("resource_type", "instance")
      .eq("resource_id", instance.id)
      .maybeSingle();
    if (!exactGrant && membership.role !== "Owner" && membership.role !== "Admin") {
      return new Response(JSON.stringify({ error: "You have not been granted access to this instance." }), { status: 403 });
    }
    if (!exactGrant) {
      const { error: grantError } = await supabase.from("access_grants").insert({
        organization_id: membership.organization_id,
        project_id: instance.project_id,
        membership_id: membership.id,
        resource_type: "instance",
        resource_id: instance.id,
        created_by: userData.user.id,
      });
      if (grantError && grantError.code !== "23505") throw new Error(`could not grant instance access: ${grantError.message}`);
    }

    const { data: existingLink } = await supabase
      .from("instance_enrollment_links")
      .select("token, expires_at")
      .eq("membership_id", membership.id)
      .eq("instance_id", instance.id)
      .maybeSingle();
    const existingToken = existingLink?.token ?? null;
    const existingExpiry = existingLink?.expires_at ?? null;
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
    const memberTag = await ensureMemberTag(token, membership.id as string);

    // The key is reusable only for this membership's devices. Its sole
    // network/SSH reachability is the exact VM grant above, not the tailnet
    // or a whole project. Do not force a shared hostname: a member can use
    // the same VM connection URL on more than one personal device.
    const key = await ts(token, "POST", `tailnet/${TAILSCALE_TAILNET}/keys`, {
      capabilities: {
        devices: { create: { reusable: true, ephemeral: false, preauthorized: true, tags: [memberTag] } },
      },
      expirySeconds: 7776000,
    });

    const enrollmentToken = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7776000 * 1000).toISOString();
    await supabase.rpc("set_vault_secret", {
      p_secret_name: `instance_enrollment_key_${enrollmentToken}`,
      p_secret_value: JSON.stringify({ key: key.key }),
    });
    const { error: linkError } = await supabase.from("instance_enrollment_links").upsert({
      membership_id: membership.id,
      instance_id: instance.id,
      token: enrollmentToken,
      expires_at: expiresAt,
      created_by: userData.user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: "membership_id,instance_id" });
    if (linkError) throw new Error(`could not save instance enrollment link: ${linkError.message}`);

    return new Response(
      JSON.stringify({ command: `curl -fsSL ${consoleUrl}/api/enroll/${enrollmentToken} | sh`, reused: false }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
