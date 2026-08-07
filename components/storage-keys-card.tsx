"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Button, Card, CardHeader, Note, Table, Td, Th } from "./ui";
import { CopyField } from "./copy-field";
import { IconPlus } from "./icons";
import type { StorageAccessKey } from "@/lib/types";

function randomKeyId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "GC";
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function randomSecret() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 40; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function StorageKeysCard({ initialKeys }: { initialKeys: StorageAccessKey[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<StorageAccessKey | null>(null);
  const [justCreated, setJustCreated] = useState<{ accessKeyId: string; secret: string } | null>(null);
  const [label, setLabel] = useState("");

  function createKey() {
    const accessKeyId = randomKeyId();
    const secret = randomSecret();
    setKeys((k) => [
      {
        id: `sak_${k.length + 1}`,
        label: label.trim() || "Untitled key",
        accessKeyId,
        createdAt: "2026-08-07",
        lastUsedAt: null,
      },
      ...k,
    ]);
    setJustCreated({ accessKeyId, secret });
    setCreateOpen(false);
    setLabel("");
  }

  function confirmRevoke() {
    if (!revokeTarget) return;
    setKeys((k) => k.filter((x) => x.id !== revokeTarget.id));
    setRevokeTarget(null);
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Access keys"
          subtitle="S3-compatible key pairs. Required to read or write any bucket — the console never proxies object data itself."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <IconPlus className="h-3.5 w-3.5" />
              Create key
            </Button>
          }
        />
        {keys.length ? (
          <Table minWidth="30rem">
            <thead>
              <tr>
                <Th>Label</Th>
                <Th>Access key ID</Th>
                <Th>Created</Th>
                <Th>Last used</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <Td className="font-medium text-ink-900">{k.label}</Td>
                  <Td className="font-mono text-xs text-ink-600">{k.accessKeyId}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">{k.createdAt}</Td>
                  <Td className="whitespace-nowrap text-xs text-ink-500">
                    {k.lastUsedAt ?? "Never used"}
                  </Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(k)}>
                      Revoke
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-400">
            No access keys yet. Create one to read or write buckets from outside the console.
          </p>
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create access key"
        description="The secret is shown once. Store it in your own secret manager — GuildCloud cannot show it again."
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={createKey}>
              Create key
            </Button>
          </>
        }
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">
            Label
          </span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. ci-pipeline"
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          />
        </label>
      </Modal>

      <Modal
        open={!!justCreated}
        onClose={() => setJustCreated(null)}
        title="Access key created"
        width="max-w-lg"
        footer={
          <Button size="sm" onClick={() => setJustCreated(null)}>
            I've saved the secret
          </Button>
        }
      >
        <div className="space-y-4">
          <Note tone="warning">
            This is the only time the secret key is shown. Closing this dialog
            without copying it means creating a new key.
          </Note>
          <CopyField label="Access key ID" value={justCreated?.accessKeyId ?? ""} />
          <CopyField label="Secret access key" value={justCreated?.secret ?? ""} />
        </div>
      </Modal>

      <Modal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title={`Revoke “${revokeTarget?.label}”?`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmRevoke}>
              Revoke
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-700">
          Anything using this key loses access immediately. This cannot be undone.
        </p>
      </Modal>
    </>
  );
}
