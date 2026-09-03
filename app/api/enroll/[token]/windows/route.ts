import { createClient } from "@supabase/supabase-js";
import { enrollmentScript } from "@/lib/enrollment-scripts";

// The Windows half of an enrollment link, redeeming the same token as the
// POSIX route beside it. It exists as a separate URL because PowerShell's
// `irm` and `curl` both send `Accept: */*` - there is no header to
// negotiate on, and guessing wrong would hand a Windows box a shell script
// it cannot run.
//
// Unlike its sibling this has no browser branch: nobody arrives here by
// pasting a link, they arrive because the console gave them the Windows
// command. A browser that does land here gets the script as plain text,
// which is why the console never advertises this URL on its own - the
// human-facing address is still /api/enroll/<token>.
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  const { data, error } = await supabase.rpc("redeem_instance_enrollment_token", { p_token: token });
  if (error || !data) {
    return new Response("This enrollment link is invalid, expired, or already used.\n", {
      status: 404,
      headers: { "Content-Type": "text/plain" },
    });
  }

  const { key } = JSON.parse(data) as { key: string };

  return new Response(enrollmentScript("windows", key), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
