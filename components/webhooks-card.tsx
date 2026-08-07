"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Badge, Button, Card, CardHeader, Note, Table, Td, Th, cx } from "./ui";
import { IconPlus } from "./icons";
import type { WebhookDelivery, WebhookEndpoint, WebhookEvent } from "@/lib/types";

const eventLabel: Record<WebhookEvent, string> = {
  "payment.succeeded": "Payment succeeded",
  "payment.failed": "Payment failed",
  "wallet.low": "Wallet low",
  "budget.warning": "Budget warning",
  "invoice.issued": "Invoice issued",
};

const allEvents = Object.keys(eventLabel) as WebhookEvent[];

const deliveryTone = {
  delivered: "lemon",
  failed: "rose",
  retrying: "amber",
} as const;

export function WebhooksCard({
  initialEndpoints,
  deliveries,
}: {
  initialEndpoints: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
}) {
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<WebhookEndpoint | null>(null);

  function addEndpoint(url: string, events: WebhookEvent[]) {
    setEndpoints((e) => [
      { id: `wh_${e.length + 1}`, url, events, status: "active", createdAt: "2026-08-07" },
      ...e,
    ]);
    setAddOpen(false);
  }

  function toggleStatus(id: string) {
    setEndpoints((e) =>
      e.map((ep) =>
        ep.id === id ? { ...ep, status: ep.status === "active" ? "disabled" : "active" } : ep,
      ),
    );
  }

  function confirmRemove() {
    if (!removeTarget) return;
    setEndpoints((e) => e.filter((ep) => ep.id !== removeTarget.id));
    setRemoveTarget(null);
  }

  return (
    <>
      <Card className="mb-4">
        <CardHeader
          title="Webhooks"
          subtitle="Notify your own systems on payment, wallet, and budget events."
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <IconPlus className="h-3.5 w-3.5" />
              Add endpoint
            </Button>
          }
        />

        {endpoints.length ? (
          <div className="divide-y divide-ink-100">
            {endpoints.map((ep) => (
              <div key={ep.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm text-ink-900">{ep.url}</span>
                  <div className="flex gap-2">
                    <Badge tone={ep.status === "active" ? "lemon" : "neutral"}>
                      {ep.status === "active" ? "Active" : "Disabled"}
                    </Badge>
                    <Button variant="ghost" size="sm" onClick={() => toggleStatus(ep.id)}>
                      {ep.status === "active" ? "Disable" : "Enable"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(ep)}>
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ep.events.map((ev) => (
                    <Badge key={ev} tone="sky">
                      {eventLabel[ev]}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-400">
            No webhook endpoints registered.
          </p>
        )}

        <div className="border-t border-ink-100 px-5 py-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Recent deliveries
          </p>
          {deliveries.length ? (
            <Table minWidth="30rem">
              <thead>
                <tr>
                  <Th>Event</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Attempt</Th>
                  <Th className="text-right">Response</Th>
                  <Th className="text-right">Occurred</Th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <Td className="text-ink-700">{eventLabel[d.event]}</Td>
                    <Td>
                      <Badge tone={deliveryTone[d.status]}>{d.status}</Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{d.attempt}</Td>
                    <Td
                      className={cx(
                        "text-right tabular-nums",
                        d.statusCode !== null && d.statusCode >= 400 && "text-rose-600",
                      )}
                    >
                      {d.statusCode ?? "—"}
                    </Td>
                    <Td className="whitespace-nowrap text-right text-xs text-ink-500">
                      {d.occurredAt}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p className="text-sm text-ink-400">No deliveries yet.</p>
          )}
        </div>

        <div className="border-t border-ink-100 px-5 py-3">
          <Note>
            Failed deliveries retry with backoff. A repeatedly failing endpoint
            is disabled automatically rather than dropped silently.
          </Note>
        </div>
      </Card>

      <AddEndpointModal open={addOpen} onClose={() => setAddOpen(false)} onConfirm={addEndpoint} />

      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove this endpoint?"
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
          <span className="font-mono">{removeTarget?.url}</span> will stop
          receiving events immediately.
        </p>
      </Modal>
    </>
  );
}

function AddEndpointModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (url: string, events: WebhookEvent[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(["payment.succeeded", "payment.failed"]);

  function toggleEvent(ev: WebhookEvent) {
    setEvents((e) => (e.includes(ev) ? e.filter((x) => x !== ev) : [...e, ev]));
  }

  const valid = url.trim().startsWith("https://") && events.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add webhook endpoint"
      description="HTTPS only. Each delivery is signed so you can verify it came from GuildCloud."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => {
              onConfirm(url.trim(), events);
              setUrl("");
            }}
          >
            Add endpoint
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Endpoint URL</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-app.example.com/webhooks/guildcloud"
            className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          />
          {url.trim() && !url.trim().startsWith("https://") ? (
            <span className="mt-1 block text-xs text-rose-600">Must start with https://</span>
          ) : null}
        </label>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Events</span>
          <div className="space-y-1.5">
            {allEvents.map((ev) => (
              <label
                key={ev}
                className="flex cursor-pointer items-center justify-between rounded-lg bg-ink-50 px-3 py-2"
              >
                <span className="text-sm text-ink-800">{eventLabel[ev]}</span>
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={() => toggleEvent(ev)}
                  className="h-4 w-4 accent-lemon-500"
                />
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
