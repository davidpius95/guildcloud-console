import Link from "next/link";
import { Card, Note } from "@/components/ui";
import { CopyField } from "@/components/copy-field";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";

// The browser half of an enrollment link. /api/enroll/<token> serves the
// install script to a shell and redirects here when the same URL is pasted
// into an address bar - which people do, because it looks like a link.
//
// This page never redeems the token. It reads only the link's public
// description (VM name, expiry) and hands back the same command the
// console shows, so the credential stays where it belongs: in the shell
// that the person deliberately ran it in.
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

  if (!link) {
    return (
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-ink-900">Link no longer valid</h1>
        <p className="mt-2 text-sm text-ink-500">
          This connection link is invalid or has expired. Open the VM in the
          console and use its Connect card to generate a new one.
        </p>
        <Link
          href="/console"
          className="mt-4 inline-block text-sm font-medium text-ink-700 underline"
        >
          Go to the console
        </Link>
      </Card>
    );
  }

  const command = `curl -fsSL ${await getSiteUrl()}/api/enroll/${token} | sh`;
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
            connecting is a change to the operating system, which only the
            device's own shell can make. So the honest job of this page is to
            hand over the command and say plainly where to run it, rather
            than implying a click here would be enough. */}
        <p className="text-sm text-ink-700">
          Copy this command and run it in a terminal on the device you want to
          connect (macOS or Linux). It installs the private-network client if
          it isn&rsquo;t already there, then authenticates this device.
        </p>
        <CopyField label="Command" value={command} />
        <Note>
          Valid until {expires}, and reusable on your own devices. Windows
          isn&rsquo;t supported by this command yet.
        </Note>
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
