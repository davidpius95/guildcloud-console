// Real invite emails. inviteMember (app/console/settings/actions.ts)
// generates the invite token and writes it to `memberships` itself (it
// already has RLS-permitted access to that table) - this function's only
// job is sending the email, via a Resend API key this app deliberately
// never holds directly (same reasoning as every other Vault-gated secret
// in this project: the Next.js app only ever holds the anon key).
// verify_jwt stays ON so this can't be used as an open mail relay by
// anyone who isn't an authenticated console user.
import { createClient } from "jsr:@supabase/supabase-js@2";

import { publishableApiKey, secretApiKey } from "../_shared/api-keys.ts";

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    secretApiKey(),
  );
}

async function getVaultSecret(supabase: ReturnType<typeof createClient>, name: string) {
  const { data, error } = await supabase.rpc("get_vault_secret", { secret_name: name });
  if (error || !data) throw new Error(`could not read vault secret ${name}: ${error?.message}`);
  return data as string;
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "not authenticated" }), { status: 401 });

    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, publishableApiKey(), {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user) return new Response(JSON.stringify({ error: "not authenticated" }), { status: 401 });

    const { to, organizationName, acceptUrl } = await req.json();
    if (!to || !organizationName || !acceptUrl) {
      return new Response(JSON.stringify({ error: "to, organizationName, acceptUrl are required" }), { status: 400 });
    }

    const supabase = serviceClient();
    const resendApiKey = await getVaultSecret(supabase, "resend_api_key");

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "GuildCloud <onboarding@resend.dev>",
        to: [to],
        subject: `You've been invited to ${organizationName} on GuildCloud`,
        html: `
          <p>You've been invited to join <strong>${organizationName}</strong> on GuildCloud.</p>
          <p><a href="${acceptUrl}">Accept invite</a></p>
          <p style="color:#888;font-size:12px">This link expires in 7 days. If you weren't expecting this, you can ignore this email.</p>
        `,
      }),
    });

    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `resend -> ${resp.status}: ${JSON.stringify(json)}` }), { status: resp.status });
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
