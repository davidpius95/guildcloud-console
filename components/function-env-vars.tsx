"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { Button, Card, CardHeader, Note } from "./ui";
import { IconPlus } from "./icons";
import type { FunctionEnvVar } from "@/lib/types";

export function FunctionEnvVars({ initialVars }: { initialVars: FunctionEnvVar[] }) {
  const [vars, setVars] = useState(initialVars);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);
  const [removeKey, setRemoveKey] = useState<string | null>(null);

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(false);

  function toggleReveal(k: string) {
    setRevealed((r) => {
      const next = new Set(r);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function addVar() {
    if (!key.trim()) return;
    setVars((v) => [
      ...v.filter((x) => x.key !== key.trim()),
      { key: key.trim(), value, secret },
    ]);
    setKey("");
    setValue("");
    setSecret(false);
    setAddOpen(false);
  }

  function confirmRemove() {
    if (!removeKey) return;
    setVars((v) => v.filter((x) => x.key !== removeKey));
    setRemoveKey(null);
  }

  return (
    <>
      <Card>
        <CardHeader
          title="Environment variables"
          subtitle="Applied on the next invocation. Secret values are masked by default."
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <IconPlus className="h-3.5 w-3.5" />
              Add variable
            </Button>
          }
        />
        {vars.length ? (
          <div className="divide-y divide-ink-100">
            {vars.map((v) => (
              <div key={v.key} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-medium text-ink-900">{v.key}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-ink-500">
                    {v.secret && !revealed.has(v.key) ? "••••••••••••••••" : v.value}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {v.secret ? (
                    <Button variant="ghost" size="sm" onClick={() => toggleReveal(v.key)}>
                      {revealed.has(v.key) ? "Hide" : "Reveal"}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => setRemoveKey(v.key)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-500">No environment variables set.</p>
        )}
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add environment variable"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!key.trim()} onClick={addVar}>
              Add variable
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">Key</span>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
              placeholder="API_TOKEN"
              className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">Value</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            />
          </label>
          <label className="flex cursor-pointer items-center justify-between rounded-lg bg-ink-50 px-4 py-3">
            <span className="text-sm font-medium text-ink-900">Mark as secret</span>
            <input
              type="checkbox"
              checked={secret}
              onChange={(e) => setSecret(e.target.checked)}
              className="h-4 w-4 accent-lemon-500"
            />
          </label>
          <Note>
            Secret values are masked in the console after saving and are never
            included in logs.
          </Note>
        </div>
      </Modal>

      <Modal
        open={!!removeKey}
        onClose={() => setRemoveKey(null)}
        title={`Remove ${removeKey}?`}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRemoveKey(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmRemove}>
              Remove
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-700">
          Takes effect on the next invocation of this function.
        </p>
      </Modal>
    </>
  );
}
