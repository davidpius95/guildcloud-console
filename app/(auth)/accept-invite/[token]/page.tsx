import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { AcceptInviteForm } from "@/components/accept-invite-form";
import { createClient } from "@/lib/supabase/server";

export default async function AcceptInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data: invite } = await supabase
    .rpc("get_invite_by_token", { p_token: token })
    .maybeSingle();

  if (!invite) {
    return (
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-ink-900">Invite not found</h1>
        <p className="mt-2 text-sm text-ink-500">
          This invite link is invalid, expired, or has already been used.
          Ask whoever invited you to send a new one.
        </p>
      </Card>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already signed in - link_pending_invites (the auto-link trigger) only
  // fires for a brand-new signup, so an existing account needs this real
  // RPC path instead, or it would silently never link.
  if (user) {
    if (user.email?.toLowerCase() === invite.email?.toLowerCase()) {
      const { error } = await supabase.rpc("accept_invite", { p_token: token });
      if (!error) redirect("/console");
      return (
        <Card className="p-6">
          <h1 className="text-lg font-semibold text-ink-900">Couldn&rsquo;t accept invite</h1>
          <p className="mt-2 text-sm text-ink-500">{error.message}</p>
        </Card>
      );
    }
    return (
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-ink-900">Wrong account</h1>
        <p className="mt-2 text-sm text-ink-500">
          This invite was sent to <strong>{invite.email}</strong>, but you&rsquo;re
          signed in as <strong>{user.email}</strong>. Sign out and use the
          invited email instead.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink-900">
        You&rsquo;re invited to {invite.organization_name}
      </h1>
      <p className="mt-1 text-sm text-ink-500">
        Create your account with <strong>{invite.email}</strong> to accept.
      </p>
      <AcceptInviteForm email={invite.email ?? ""} />
    </Card>
  );
}
