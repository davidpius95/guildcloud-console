import { createClient } from "@supabase/supabase-js";

// Public, token-gated route - hit by a bare `curl` from a customer's own
// terminal, not a browser, so there's no session to authenticate with.
// The token in the URL is the credential (see redeem_enrollment_token, a
// narrow SECURITY DEFINER RPC - this route never touches the service-role
// key, which this app deliberately never holds). Reusable per user
// decision 2026-08-25: the same link resolves repeatedly until it expires
// (90 days) or the member regenerates it from the console, which
// overwrites the underlying token and makes the old link 404.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.rpc("redeem_enrollment_token", { p_token: token });
  if (error || !data) {
    return new Response("This enrollment link is invalid, expired, or already used.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const { key, hostname } = JSON.parse(data) as { key: string; hostname: string };

  // The word "Tailscale" never appears anywhere in the console UI itself
  // (per the master plan's binding constraint) - it's fine here, inside
  // the script the user explicitly chose to run.
  const script = `#!/bin/sh
set -e
if ! command -v tailscale >/dev/null 2>&1; then
  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi
echo "Connecting this device..."
sudo tailscale up --reset --authkey ${key} --hostname ${hostname} --accept-dns=true
echo "Connected."
`;

  return new Response(script, {
    headers: { "Content-Type": "text/x-shellscript" },
  });
}
