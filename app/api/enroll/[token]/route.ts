import { createClient } from "@supabase/supabase-js";
import { enrollmentScript } from "@/lib/enrollment-scripts";

// Public, token-gated route - hit by a bare `curl` from a customer's own
// terminal, not a browser, so there's no session to authenticate with. The
// token is bound in the database to exactly one membership and one Ready VM
// (redeem_instance_enrollment_token). This route never holds a service-role
// key and never decides what a customer device may reach.
//
// The same URL is also pasteable into a browser address bar, because that
// is what people do with a link regardless of what it was meant for. A
// browser asks for text/html; curl asks for */*. On text/html this hands
// the visitor off to /connect/<token>, a real page that explains the step
// and hands back the command - it deliberately does NOT redeem the token.
// Rendering the script in a tab would put a live credential into browser
// history, the disk cache, and every extension that can read the page,
// and on most browsers it would just download an unexplained file.
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (req.headers.get("accept")?.includes("text/html")) {
    return Response.redirect(new URL(`/connect/${encodeURIComponent(token)}`, req.url), 302);
  }

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

  // POSIX shell. Windows is served from /windows on this same token,
  // because `irm` and `curl` send an identical Accept header and there is
  // nothing to negotiate on.
  return new Response(enrollmentScript("linux", key), {
    headers: { "Content-Type": "text/x-shellscript" },
  });
}
