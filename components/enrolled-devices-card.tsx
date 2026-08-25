"use client";

import { Badge, Card, CardHeader, Table, Td, Th } from "./ui";
import { ConnectDeviceButton } from "./connect-device-button";
import type { Membership } from "@/lib/types";

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
  return (
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
                  <ConnectDeviceButton>Connect this device</ConnectDeviceButton>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
