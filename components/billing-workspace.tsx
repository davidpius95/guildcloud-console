"use client";

import { useState } from "react";
import { Modal } from "./modal";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Meter,
  Note,
  Stat,
  Table,
  Td,
  Th,
  cx,
} from "./ui";
import { IconPlus, IconWallet } from "./icons";
import { money } from "@/lib/mock-data";
import type {
  Invoice,
  LedgerEntry,
  PaymentMethod,
  PaymentProvider,
} from "@/lib/types";

const kindTone = {
  "top-up": "lemon",
  usage: "neutral",
  adjustment: "sky",
  refund: "sky",
} as const;

export function BillingWorkspace({
  initialWalletBalance,
  monthToDateSpend,
  monthlyForecast,
  budget,
  initialLedger,
  initialPaymentMethods,
  invoices,
  initialAutoReload,
}: {
  initialWalletBalance: number;
  monthToDateSpend: number;
  monthlyForecast: number;
  budget: number;
  initialLedger: LedgerEntry[];
  initialPaymentMethods: PaymentMethod[];
  invoices: Invoice[];
  initialAutoReload: { enabled: boolean; amount: number; threshold: number; maxPerMonth: number };
}) {
  const [walletBalance, setWalletBalance] = useState(initialWalletBalance);
  const [ledger, setLedger] = useState(initialLedger);
  const [methods, setMethods] = useState(initialPaymentMethods);
  const [autoReload, setAutoReload] = useState(initialAutoReload);

  const [topUpOpen, setTopUpOpen] = useState(false);
  const [addMethodOpen, setAddMethodOpen] = useState(false);
  const [editReloadOpen, setEditReloadOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<PaymentMethod | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const budgetUsed = (monthToDateSpend / budget) * 100;
  const defaultMethod = methods.find((m) => m.isDefault) ?? methods[0];

  function addFunds(amount: number) {
    setWalletBalance((b) => b + amount);
    setLedger((l) => [
      {
        id: `le_topup_${l.length + 1}`,
        date: "2026-08-07",
        description: `Wallet top-up — ${defaultMethod?.provider ?? "Paystack"}`,
        kind: "top-up",
        amount,
        reference: `ps_ref_${Math.abs(amount).toFixed(0)}_${l.length}`,
      },
      ...l,
    ]);
    setTopUpOpen(false);
    setNotice(
      `Top-up of ${money(amount)} verified via ${defaultMethod?.provider ?? "your default method"}. Ledger updated — this is a mock console, no real charge occurred.`,
    );
  }

  function addMethod(provider: PaymentProvider) {
    const newMethod: PaymentMethod = {
      id: `pm_${methods.length + 1}`,
      provider,
      label:
        provider === "Paystack" ? "Card ending 7731" : "Bank transfer — added account",
      detail: "Verified 2026-08-07",
      isDefault: methods.length === 0,
      addedAt: "2026-08-07",
    };
    setMethods((m) => [...m, newMethod]);
    setAddMethodOpen(false);
    setNotice(
      `${provider} method added after a verified signed provider result. This is a mock console — you were not actually redirected to ${provider}.`,
    );
  }

  function setDefault(id: string) {
    setMethods((m) => m.map((pm) => ({ ...pm, isDefault: pm.id === id })));
  }

  function confirmRemove() {
    if (!removeTarget) return;
    setMethods((m) => m.filter((pm) => pm.id !== removeTarget.id));
    setRemoveTarget(null);
  }

  return (
    <>
      <section className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <Stat
            label="Wallet balance"
            value={money(walletBalance)}
            hint={
              autoReload.enabled
                ? `Auto-reload ${money(autoReload.amount)} at ${money(autoReload.threshold)}`
                : "Auto-reload off"
            }
            tone="lemon"
          />
          <div className="px-5 pb-4">
            <Button size="sm" onClick={() => setTopUpOpen(true)}>
              <IconWallet className="h-3.5 w-3.5" />
              Add funds
            </Button>
          </div>
        </Card>
        <Card>
          <Stat
            label="Month to date"
            value={money(monthToDateSpend)}
            hint="Metered hourly across all projects"
          />
        </Card>
        <Card>
          <Stat
            label="Monthly forecast"
            value={money(monthlyForecast)}
            hint="Based on current running resources"
          />
        </Card>
        <Card>
          <div className="px-5 py-4">
            <p className="text-xs font-medium text-ink-400">Budget</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
              {money(budget)}
            </p>
            <div className="mt-2">
              <Meter value={budgetUsed} caption={`${budgetUsed.toFixed(0)}% used`} label="This month" />
            </div>
          </div>
        </Card>
      </section>

      {notice ? (
        <div className="mb-5">
          <Note>{notice}</Note>
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader
          title="Payment methods"
          subtitle="Credit is applied only after an independently verified signed provider result."
          action={
            <Button variant="secondary" size="sm" onClick={() => setAddMethodOpen(true)}>
              <IconPlus className="h-3.5 w-3.5" />
              Add method
            </Button>
          }
        />
        <div className="divide-y divide-ink-100">
          {methods.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink-900">{m.label}</p>
                  <Badge tone="sky">{m.provider}</Badge>
                  {m.isDefault ? <Badge tone="lemon">Default</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-ink-400">{m.detail}</p>
              </div>
              <div className="flex gap-2">
                {!m.isDefault ? (
                  <Button variant="ghost" size="sm" onClick={() => setDefault(m.id)}>
                    Set default
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(m)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          {methods.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-400">
              No payment method on file. Add one before your wallet runs out.
            </p>
          ) : null}
        </div>

        <div className="border-t border-ink-100 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink-900">Auto-reload</p>
              <p className="text-xs text-ink-400">
                {autoReload.enabled
                  ? `${money(autoReload.amount)} when balance drops below ${money(autoReload.threshold)}, up to ${autoReload.maxPerMonth}× per month`
                  : "Off"}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setEditReloadOpen(true)}>
              Edit
            </Button>
          </div>
        </div>

        <div className="border-t border-ink-100 px-5 py-3">
          <p className="text-xs text-ink-400">
            Paystack and Flutterwave are both supported. Available methods
            depend on your country and currency.
          </p>
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Invoices"
          subtitle="One per billing period. Downloading is a mock action in this console."
        />
        <div className="divide-y divide-ink-100">
          {invoices.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-4 px-5 py-3">
              <div>
                <p className="text-sm font-medium text-ink-900">{inv.period}</p>
                <p className="text-xs text-ink-400">Issued {inv.issuedAt}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={inv.status === "paid" ? "lemon" : "amber"}>
                  {inv.status === "paid" ? "Paid" : "Open"}
                </Badge>
                <span className="tabular-nums text-sm font-medium text-ink-800">
                  {money(inv.amount)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setNotice(
                      `This is a mock console — a real PDF for ${inv.period} would download here.`,
                    )
                  }
                >
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Ledger"
          subtitle="Append-only. Every entry carries a unique provider or operation reference."
        />
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Description</Th>
              <Th>Kind</Th>
              <Th>Reference</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-ink-500">{e.date}</Td>
                <Td className="text-ink-900">{e.description}</Td>
                <Td>
                  <Badge tone={kindTone[e.kind]}>{e.kind}</Badge>
                </Td>
                <Td className="font-mono text-xs text-ink-400">{e.reference}</Td>
                <Td
                  className={cx(
                    "text-right tabular-nums font-medium",
                    e.amount > 0 ? "text-lemon-700" : "text-ink-800",
                  )}
                >
                  {e.amount > 0 ? "+" : ""}
                  {money(Math.abs(e.amount))}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* --- Modals --- */}
      <TopUpModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        defaultMethod={defaultMethod}
        onConfirm={addFunds}
      />
      <AddMethodModal
        open={addMethodOpen}
        onClose={() => setAddMethodOpen(false)}
        onConfirm={addMethod}
      />
      <EditAutoReloadModal
        open={editReloadOpen}
        onClose={() => setEditReloadOpen(false)}
        value={autoReload}
        onSave={(next) => {
          setAutoReload(next);
          setEditReloadOpen(false);
        }}
      />
      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title={`Remove ${removeTarget?.label ?? "payment method"}?`}
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
          {removeTarget?.isDefault
            ? "This is your default method. Auto-reload will pause until you set a new default."
            : "You can add it back at any time."}
        </p>
      </Modal>
    </>
  );
}

function TopUpModal({
  open,
  onClose,
  defaultMethod,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  defaultMethod: PaymentMethod | undefined;
  onConfirm: (amount: number) => void;
}) {
  const [amount, setAmount] = useState(100);
  const presets = [50, 100, 250, 500];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add funds"
      description="Credit is applied only after a verified provider result."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={amount <= 0 || !defaultMethod}
            onClick={() => onConfirm(amount)}
          >
            Add {money(amount)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(p)}
              className={cx(
                "rounded-lg px-2 py-2 text-sm font-medium ring-1 ring-inset transition-all",
                amount === p
                  ? "bg-lemon-50 text-[#171d36] ring-2 ring-lemon-500"
                  : "bg-white text-ink-700 ring-ink-200 hover:ring-ink-300",
              )}
            >
              ${p}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">
            Custom amount (USD)
          </span>
          <input
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          />
        </label>
        {defaultMethod ? (
          <div className="rounded-lg bg-ink-50 px-4 py-3 text-sm">
            <span className="text-ink-500">Charged to </span>
            <span className="font-medium text-ink-900">{defaultMethod.label}</span>
            <span className="text-ink-500"> via {defaultMethod.provider}</span>
          </div>
        ) : (
          <Note tone="warning">Add a payment method first.</Note>
        )}
      </div>
    </Modal>
  );
}

function AddMethodModal({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (provider: PaymentProvider) => void;
}) {
  const [provider, setProvider] = useState<PaymentProvider>("Paystack");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a payment method"
      description="GuildCloud never stores your card details directly — you're redirected to the provider's hosted checkout, and a method is added here only after they return a verified, signed result."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onConfirm(provider)}>
            Continue to {provider}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        {(["Paystack", "Flutterwave"] as PaymentProvider[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setProvider(p)}
            className={cx(
              "block w-full rounded-lg px-4 py-3 text-left ring-1 ring-inset transition-all",
              provider === p
                ? "bg-lemon-50 ring-2 ring-lemon-500"
                : "bg-white ring-ink-200 hover:ring-ink-300",
            )}
          >
            <span className="block text-sm font-medium text-ink-900">{p}</span>
            <span className="block text-xs text-ink-500">
              Cards and locally eligible methods for your country and currency.
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-400">
        This is a mock console — clicking continue simulates a successful
        verification instead of opening {provider}.
      </p>
    </Modal>
  );
}

function EditAutoReloadModal({
  open,
  onClose,
  value,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  value: { enabled: boolean; amount: number; threshold: number; maxPerMonth: number };
  onSave: (v: { enabled: boolean; amount: number; threshold: number; maxPerMonth: number }) => void;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Auto-reload settings"
      description="Top up automatically when your balance drops below a threshold you set."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => onSave(draft)}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center justify-between rounded-lg bg-ink-50 px-4 py-3">
          <span className="text-sm font-medium text-ink-900">Enable auto-reload</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="h-4 w-4 accent-lemon-500"
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Reload amount (USD)
            </span>
            <input
              type="number"
              min={1}
              disabled={!draft.enabled}
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: Number(e.target.value) })}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 disabled:opacity-50 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Trigger below (USD)
            </span>
            <input
              type="number"
              min={0}
              disabled={!draft.enabled}
              value={draft.threshold}
              onChange={(e) => setDraft({ ...draft, threshold: Number(e.target.value) })}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 disabled:opacity-50 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">
            Maximum reloads per month
          </span>
          <input
            type="number"
            min={1}
            max={30}
            disabled={!draft.enabled}
            value={draft.maxPerMonth}
            onChange={(e) => setDraft({ ...draft, maxPerMonth: Number(e.target.value) })}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 disabled:opacity-50 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          />
        </label>
        <p className="text-xs text-ink-400">
          A cap on frequency limits exposure if usage spikes unexpectedly.
        </p>
      </div>
    </Modal>
  );
}
