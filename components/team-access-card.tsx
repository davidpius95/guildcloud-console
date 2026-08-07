"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Badge, Button, Card, CardHeader, Table, Td, Th, cx } from "./ui";
import { IconPlus } from "./icons";
import type { TeamMember } from "@/lib/types";

type Role = TeamMember["role"];
const roles: Role[] = ["Admin", "Developer", "Billing", "Read-only"];

type LocalMember = TeamMember & { pending?: boolean };

export function TeamAccessCard({ initialTeam }: { initialTeam: TeamMember[] }) {
  const [members, setMembers] = useState<LocalMember[]>(initialTeam);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<LocalMember | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Developer");

  function sendInvite() {
    if (!email.trim()) return;
    const newMember: LocalMember = {
      id: `pending_${Date.now()}`,
      name: email.split("@")[0],
      email: email.trim(),
      role,
      deviceEnrolled: false,
      lastActive: "Never",
      pending: true,
    };
    setMembers((prev) => [...prev, newMember]);
    setEmail("");
    setRole("Developer");
    setInviteOpen(false);
  }

  function confirmRemove() {
    if (!removeTarget) return;
    setMembers((prev) => prev.filter((m) => m.id !== removeTarget.id));
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
              <Th>Device</Th>
              <Th>Last active</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <Td>
                  <span className="font-medium text-ink-900">{m.name}</span>
                  <p className="text-xs text-ink-400">{m.email}</p>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Badge tone={m.role === "Owner" ? "lemon" : "neutral"}>
                      {m.role}
                    </Badge>
                    {m.pending ? <Badge tone="amber">Invited</Badge> : null}
                  </div>
                </Td>
                <Td>
                  <Badge tone={m.deviceEnrolled ? "lemon" : "amber"}>
                    {m.pending
                      ? "Awaiting acceptance"
                      : m.deviceEnrolled
                        ? "Enrolled"
                        : "Not enrolled"}
                  </Badge>
                </Td>
                <Td className="whitespace-nowrap text-xs text-ink-500">
                  {m.lastActive}
                </Td>
                <Td className="text-right">
                  {m.role === "Owner" ? null : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoveTarget(m)}
                    >
                      Remove
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite a teammate"
        description="They'll receive an email invite. Access stays pending until they accept and enroll a device."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={sendInvite} disabled={!email.trim()}>
              Send invite
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Email address
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            />
          </label>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Role
            </span>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cx(
                    "rounded-lg px-3 py-2 text-left text-sm ring-1 ring-inset transition-all",
                    r === role
                      ? "bg-lemon-50 text-[#171d36] ring-2 ring-lemon-500"
                      : "bg-white text-ink-700 ring-ink-200 hover:ring-ink-300",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title={`Remove ${removeTarget?.name ?? "teammate"}?`}
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
          This revokes <strong>{removeTarget?.name}</strong>&rsquo;s console
          access, private network permission, and instance login all at once —
          not one at a time.
        </p>
      </Modal>
    </>
  );
}
