import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Card, Note } from "@/components/ui";
import { ConnectInstructions } from "@/components/connect-instructions";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { enrollmentCommand, type Platform } from "@/lib/enrollment-scripts";

// The browser half of an enrollment link. /api/enroll/<token> serves the
// install script to a shell and redirects here when the same URL is pasted
// into an address bar - which people do, because it looks like a link.
//
// This page never redeems the token. It reads only the link's public
// description (VM name, expiry) and hands back the same commands the
// console shows, so the credential stays where it belongs: in the shell
// that the person deliberately ran it in.

// Best-effort, and only ever a default - the switcher decides what is
// actually shown. Worth doing anyway: most people open the link on the
// machine they mean to connect, and handing them the wrong shell's command
// is how the Windows case failed before there was a Windows command at all.
function detectPlatform(userAgent: string | null): Platform {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("windows")) return "windows";
  if (ua.includes("mac os") || ua.includes("macintosh") || ua.includes("iphone") || ua.includes("ipad")) {
    return "macos";
  }
  return "linux";
}

export default async function ConnectDevicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: link } = await supabase
    .rpc("describe_instance_enrollment_link", { p_token: token })
    .maybeSingle();

  // Renders not-found.tsx in this segment, which carries a real 404 rather
  // than the 200-with-an-error-card this used to return.
  if (!link) notFound();

  const baseUrl = await getSiteUrl();
  const commands = {
    macos: enrollmentCommand("macos", baseUrl, token),
    linux: enrollmentCommand("linux", baseUrl, token),
    windows: enrollmentCommand("windows", baseUrl, token),
  };
  const detected = detectPlatform((await headers()).get("user-agent"));

  const expires = new Date(link.expires_at).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink-900">Connect this device</h1>
      <p className="mt-1 text-sm text-ink-500">
        This link grants private access to <strong>{link.instance_name}</strong>{" "}
        only. It does not grant access to any other machine.
      </p>

      {!link.instance_ready ? (
        <div className="mt-4">
          <Note tone="warning">
            {link.instance_name} isn&rsquo;t ready yet, so the command below
            will be refused. Wait until the VM reaches Ready, then run it.
          </Note>
        </div>
      ) : null}

      <div className="mt-5 space-y-4">
        {/* A browser cannot join a device to the private network on its own -
            connecting installs software and reconfigures the network, which
            only the device's own shell can do. So the honest job of this page
            is to hand over the right command for the right machine and say
            plainly where to run it, rather than implying a click would be
            enough. */}
        <ConnectInstructions detected={detected} commands={commands} />
        <Note>Valid until {expires}, and reusable on your own devices.</Note>
      </div>

      <Link
        href="/console"
        className="mt-6 inline-block text-sm font-medium text-ink-700 underline"
      >
        Go to the console
      </Link>
    </Card>
  );
}
