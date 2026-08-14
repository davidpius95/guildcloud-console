"use client";

import { useState, useTransition } from "react";
import { Modal } from "./modal";
import { Badge, Button, Card, CardHeader, Note, Table, Td, Th } from "./ui";
import { CopyField } from "./copy-field";
import type { Membership } from "@/lib/types";
import { requestDeviceEnrollment } from "@/app/console/networking/actions";

// Real device self-enrollment - replaces the old 100% mock table (fictional
// names like "Dan Whitfield", none of it backed by real data). Rows are
// real Membership[]; only the signed-in user's own row gets a "Connect
// this device" action, since enroll-device identifies the caller via
// their own session and enrolls their own device, not someone else's.
export function EnrolledDevicesCard({
  members,
  currentUserId,
}: {
  members: Membership[];
  currentUserId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function connect() {
    setError(null);
    startTransition(async () => {
      const result = await requestDeviceEnrollment();
      if (result.error) setError(result.error);
      else setCommand(result.command);
    });
  }

  function close() {
    setOpen(false);
    setCommand(null);
    setError(null);
  }

  return (
    <>
      <Card className="min-w-0">
        <CardHeader
          title="Enrolled devices"
          subtitle="Removing a teammate revokes network permission and server login together."
        />
        <Table minWidth="24rem">
          <thead>
            <tr>
              <Th>Member</Th>
              <Th>Role</Th>
              <Th>Device</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <Td>
                  <span className="font-medium text-ink-900">
                    {m.email ?? m.invitedEmail ?? "—"}
                  </span>
                </Td>
                <Td className="text-ink-500">{m.role}</Td>
                <Td>
                  <Badge tone={m.deviceEnrolled ? "lemon" : "neutral"}>
                    {m.deviceEnrolled ? "Enrolled" : "Not enrolled"}
                  </Badge>
                </Td>
                <Td className="text-right">
                  {!m.deviceEnrolled && m.userId === currentUserId ? (
                    <Button variant="ghost" size="sm" onClick={() => { setOpen(true); connect(); }}>
                      Connect this device
                    </Button>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Modal
        open={open}
        onClose={close}
        title="Connect this device"
        description="Run this in a terminal on the device you want to use — it only works once."
        footer={
          <Button size="sm" onClick={close}>
            Done
          </Button>
        }
      >
        {command ? (
          <div className="space-y-3">
            <CopyField label="Command" value={command} />
            <Note>
              This link works once. If you need to connect another device
              later, come back here and click "Connect this device" again.
            </Note>
          </div>
        ) : error ? (
          <Note tone="warning">{error}</Note>
        ) : (
          <p className="text-sm text-ink-500">{isPending ? "Preparing…" : "…"}</p>
        )}
      </Modal>
    </>
  );
}
