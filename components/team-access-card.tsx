"use client";

import { useActionState, useState, useTransition } from "react";
import { Modal } from "./modal";
import { Badge, Button, Card, CardHeader, Table, Td, Th, cx } from "./ui";
import { IconPlus } from "./icons";
import { formatDate } from "@/lib/format";
import type { Membership, MemberRole } from "@/lib/types";
import {
  inviteMember,
  updateMemberRole,
  removeMember,
  type SettingsActionState,
} from "@/app/console/settings/actions";

const roles: MemberRole[] = ["Admin", "Developer", "Billing", "Read-only"];
const initialState: SettingsActionState = { error: null };
const INVITE_FORM_ID = "invite-teammate-form";

export function TeamAccessCard({ members }: { members: Membership[] }) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Membership | null>(null);
  const [inviteState, inviteAction] = useActionState(inviteMember, initialState);
  const [isPending, startTransition] = useTransition();

  function confirmRemove() {
    if (!removeTarget) return;
    startTransition(() => removeMember(removeTarget.id));
    setRemoveTarget(null);
  }

  return (
    <>
      <Card className="min-w-0 lg:col-span-2">
        <CardHeader
          title="Team access"
          subtitle="Roles control the console. Private network permission and server login are revoked together on removal."
          action={
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <IconPlus className="h-3.5 w-3.5" />
              Invite
            </Button>
          }
        />
        <Table>
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const pending = !m.userId;
              return (
                <tr key={m.id}>
                  <Td>
                    <span className="font-medium text-ink-900">
                      {m.email ?? m.invitedEmail ?? "—"}
                    </span>
                  </Td>
                  <Td>
                    {m.role === "Owner" ? (
                      <Badge tone="lemon">{m.role}</Badge>
                    ) : (
                      <select
                        defaultValue={m.role}
                        disabled={isPending}
                        onChange={(e) =>
                          startTransition(() =>
                            updateMemberRole(m.id, e.target.value as MemberRole),
                          )
                        }
                        className="rounded-md border border-ink-200 bg-white px-2 py-1 text-xs text-ink-700"
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    )}
                  </Td>
                  <Td>
                    <Badge tone={pending ? "amber" : "lemon"}>
                      {pending ? "Invited" : "Active"}
                    </Badge>
                  </Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {m.joinedAt ? formatDate(m.joinedAt) : "—"}
                  </Td>
                  <Td className="text-right">
                    {m.role === "Owner" ? null : (
                      <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(m)}>
                        Remove
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a teammate"
        description="They'll get access once they sign up with this email. Access stays pending until then."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" form={INVITE_FORM_ID}>
              Send invite
            </Button>
          </>
        }
      >
        <form
          id={INVITE_FORM_ID}
          action={(formData) => {
            startTransition(async () => {
              await inviteAction(formData);
              setInviteOpen(false);
            });
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Email address
            </span>
            <input
              name="email"
              type="email"
              required
              placeholder="teammate@company.com"
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-500">Role</span>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((r, i) => (
                <label
                  key={r}
                  className={cx(
                    "flex cursor-pointer items-center rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset transition-all",
                    "has-[:checked]:bg-lemon-50 has-[:checked]:text-[#171d36] has-[:checked]:ring-2 has-[:checked]:ring-lemon-500",
                    "bg-white text-ink-700 ring-ink-200 hover:ring-ink-300",
                  )}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    defaultChecked={i === 1}
                    className="sr-only"
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>

          {inviteState.error ? (
            <p className="text-xs text-rose-600">{inviteState.error}</p>
          ) : null}
        </form>
      </Modal>

      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title={`Remove ${removeTarget?.email ?? removeTarget?.invitedEmail ?? "teammate"}?`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmRemove}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-700">
          This revokes <strong>{removeTarget?.email ?? removeTarget?.invitedEmail}</strong>
          &rsquo;s console access, private network permission, and instance login all at
          once — not one at a time.
        </p>
      </Modal>
    </>
  );
}
