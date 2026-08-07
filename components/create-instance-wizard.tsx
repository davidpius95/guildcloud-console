"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  images,
  money,
  plans,
  projects,
  sites,
} from "@/lib/mock-data";
import type { ProtectionTier } from "@/lib/types";
import { Badge, Button, Card, CardHeader, Note, cx } from "./ui";
import { IconLock, IconShield } from "./icons";

const protectionOptions: Array<{
  id: ProtectionTier;
  name: string;
  detail: string;
  multiplier: number;
  limited?: boolean;
}> = [
  {
    id: "standard",
    name: "Standard",
    detail:
      "Daily encrypted off-site backup, seven-day retention, restore into a healthy site.",
    multiplier: 0,
  },
  {
    id: "protected",
    name: "Protected",
    detail:
      "More frequent recovery points, longer retention option, priority restore handling.",
    multiplier: 0.25,
  },
  {
    id: "warm-standby",
    name: "Warm Standby",
    detail:
      "Prepared secondary-site recovery workflow. Offered only where full-site drills have passed.",
    multiplier: 0.6,
    limited: true,
  },
];

function Section({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-lemon-400">
          {step}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-ink-400">{description}</p>
          ) : null}
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
    </Card>
  );
}

function Option({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "rounded-lg px-4 py-3 text-left ring-1 ring-inset transition-all",
        disabled
          ? "cursor-not-allowed bg-ink-50 text-ink-300 ring-ink-100"
          : selected
            ? "bg-lemon-50 ring-2 ring-lemon-500"
            : "bg-white ring-ink-200 hover:ring-ink-300",
      )}
    >
      {children}
    </button>
  );
}

export function CreateInstanceWizard() {
  const [siteId, setSiteId] = useState(sites[0].id);
  const [projectId, setProjectId] = useState(projects[0].id);
  const [imageId, setImageId] = useState("ubuntu-2404");
  const [planId, setPlanId] = useState("std-2");
  const [protection, setProtection] = useState<ProtectionTier>("standard");
  const [volumeGb, setVolumeGb] = useState(0);
  const [passwordSsh, setPasswordSsh] = useState(false);
  const [name, setName] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const site = sites.find((s) => s.id === siteId)!;
  const plan = plans.find((p) => p.id === planId)!;
  const image = images.find((i) => i.id === imageId)!;
  const tier = protectionOptions.find((p) => p.id === protection)!;

  const cost = useMemo(() => {
    const volumeMonthly = volumeGb * 0.1;
    const protectionMonthly = plan.monthlyMax * tier.multiplier;
    const monthly = plan.monthlyMax + volumeMonthly + protectionMonthly;
    return {
      hourly: monthly / 720,
      monthly,
      volumeMonthly,
      protectionMonthly,
    };
  }, [plan, tier, volumeGb]);

  const imageAvailable = image.availableSites.includes(siteId);
  const canCreate = site.acceptingNewWork && imageAvailable && name.trim().length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Section
          step={1}
          title="Site and project"
          description="A site accepts new work only when compute, storage, private networking, backups, and monitoring are healthy."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {sites.map((s) => (
              <Option
                key={s.id}
                selected={s.id === siteId}
                disabled={!s.acceptingNewWork}
                onClick={() => setSiteId(s.id)}
              >
                <p className="text-sm font-medium">{s.name}</p>
                <p className="mt-0.5 text-xs opacity-70">{s.location}</p>
                <p className="mt-2 text-xs">
                  {s.acceptingNewWork ? (
                    <span className="text-lemon-700">Accepting new work</span>
                  ) : (
                    <span className="text-amber-600">Admission paused</span>
                  )}
                </p>
              </Option>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Project
            </span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </Section>

        <Section
          step={2}
          title="Image"
          description="Only images with a tested template at the selected site are shown."
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Operating systems
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {images
              .filter((i) => i.family === "os")
              .map((i) => {
                const available = i.availableSites.includes(siteId);
                return (
                  <Option
                    key={i.id}
                    selected={i.id === imageId}
                    disabled={!available}
                    onClick={() => setImageId(i.id)}
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{i.name}</p>
                      {i.recommended ? <Badge tone="lemon">Recommended</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-xs opacity-70">{i.version}</p>
                    {!available ? (
                      <p className="mt-1 text-xs text-ink-400">
                        No tested template at {site.name}
                      </p>
                    ) : null}
                  </Option>
                );
              })}
          </div>

          <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-ink-400">
            Curated solutions
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {images
              .filter((i) => i.family === "solution")
              .map((i) => {
                const available = i.availableSites.includes(siteId);
                return (
                  <Option
                    key={i.id}
                    selected={i.id === imageId}
                    disabled={!available}
                    onClick={() => setImageId(i.id)}
                  >
                    <p className="text-sm font-medium">{i.name}</p>
                    <p className="mt-0.5 text-xs opacity-70">{i.version}</p>
                  </Option>
                );
              })}
          </div>
        </Section>

        <Section
          step={3}
          title="Plan"
          description="Plans are derived from measured real capacity, not advertised hardware classes."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {plans.map((p) => (
              <Option
                key={p.id}
                selected={p.id === planId}
                onClick={() => setPlanId(p.id)}
              >
                <p className="text-sm font-medium">{p.name}</p>
                <p className="mt-1 text-xs opacity-70">
                  {p.vcpu} vCPU · {p.memoryGb} GB RAM
                </p>
                <p className="text-xs opacity-70">{p.diskGb} GB disk</p>
                <p className="mt-2 text-sm font-semibold tabular-nums">
                  {money(p.monthlyMax)}
                  <span className="text-xs font-normal opacity-60">/mo max</span>
                </p>
                {p.note ? (
                  <p className="mt-1 text-xs text-amber-600">{p.note}</p>
                ) : null}
              </Option>
            ))}
          </div>

          <label className="mt-5 block">
            <span className="mb-1.5 flex items-baseline justify-between text-xs font-medium text-ink-500">
              <span>Additional block storage</span>
              <span className="tabular-nums text-ink-700">
                {volumeGb} GB · {money(volumeGb * 0.1)}/mo
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1000}
              step={50}
              value={volumeGb}
              onChange={(e) => setVolumeGb(Number(e.target.value))}
              className="w-full accent-lemon-500"
            />
            <span className="mt-1 block text-xs text-ink-400">
              Volumes expand later without downtime. Shrinking is not offered.
            </span>
          </label>
        </Section>

        <Section
          step={4}
          title="Protection tier"
          description="Every tier below describes a recovery workflow that has passed a drill."
        >
          <div className="space-y-3">
            {protectionOptions.map((p) => (
              <Option
                key={p.id}
                selected={p.id === protection}
                onClick={() => setProtection(p.id)}
              >
                <div className="flex items-start gap-3">
                  <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-lemon-600" />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{p.name}</p>
                      {p.limited ? <Badge tone="amber">Limited capacity</Badge> : null}
                      <span className="ml-auto text-sm font-semibold tabular-nums">
                        {p.multiplier === 0
                          ? "Included"
                          : `+${money(plan.monthlyMax * p.multiplier)}/mo`}
                      </span>
                    </div>
                    <p className="mt-1 text-xs opacity-70">{p.detail}</p>
                  </div>
                </div>
              </Option>
            ))}
          </div>
        </Section>

        <Section
          step={5}
          title="Access and identity"
          description="You receive a named administrator account with sudo. Root password SSH is not the default model."
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Instance name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="api-prod-3"
              className="w-full rounded-lg bg-white px-3 py-2 font-mono text-sm text-ink-800 ring-1 ring-inset ring-ink-200 placeholder:text-ink-300 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            />
            {name ? (
              <span className="mt-1.5 block font-mono text-xs text-ink-400">
                {name.trim()}.
                {projects.find((p) => p.id === projectId)!.name
                  .toLowerCase()
                  .replace(/\s+/g, "-")}
                .guild.internal
              </span>
            ) : (
              <span className="mt-1.5 block text-xs text-ink-400">
                A private hostname is derived from the name and project.
              </span>
            )}
          </label>

          <div className="mt-4 rounded-lg bg-ink-50 px-4 py-3 ring-1 ring-inset ring-ink-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-ink-900">SSH keys</p>
                <p className="text-xs text-ink-400">
                  Enabled by default and used for the private route.
                </p>
              </div>
              <Badge tone="lemon">Always on</Badge>
            </div>
          </div>

          <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-white px-4 py-3 ring-1 ring-inset ring-ink-200">
            <input
              type="checkbox"
              checked={passwordSsh}
              onChange={(e) => setPasswordSsh(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-lemon-500"
            />
            <span>
              <span className="block text-sm font-medium text-ink-900">
                Also allow password SSH over the private route
              </span>
              <span className="mt-0.5 block text-xs text-ink-400">
                Opt-in. The password is never stored by GuildCloud, attempts are
                rate-limited, and access is audited without recording secrets.
              </span>
            </span>
          </label>
        </Section>
      </div>

      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader title="Summary" subtitle="Nothing is created until you confirm." />
          <div className="divide-y divide-ink-100 text-sm">
            {[
              ["Site", site.name],
              ["Project", projects.find((p) => p.id === projectId)!.name],
              ["Image", `${image.name} ${image.version}`],
              ["Plan", `${plan.name} · ${plan.vcpu} vCPU · ${plan.memoryGb} GB`],
              ["Disk", `${plan.diskGb} GB${volumeGb ? ` + ${volumeGb} GB volume` : ""}`],
              ["Protection", tier.name],
              ["Access", passwordSsh ? "SSH keys + password" : "SSH keys only"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-5 py-2.5">
                <span className="text-ink-500">{k}</span>
                <span className="text-right font-medium text-ink-900">{v}</span>
              </div>
            ))}
          </div>

          <div className="border-t border-ink-100 bg-lemon-50 px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-ink-600">Hourly price</span>
              <span className="text-lg font-semibold tabular-nums text-ink-900">
                ${cost.hourly.toFixed(3)}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-sm text-ink-600">Monthly maximum</span>
              <span className="text-2xl font-semibold tabular-nums text-lemon-800">
                {money(cost.monthly)}
              </span>
            </div>
            <p className="mt-2 text-xs text-ink-500">
              Billed hourly for actual use. The monthly maximum is the ceiling if
              the instance runs the whole month.
            </p>
          </div>

          <div className="space-y-3 px-5 py-4">
            {!site.acceptingNewWork ? (
              <Note tone="warning">
                {site.name} has paused admission because free capacity approached
                the 30% reserve. Choose another site.
              </Note>
            ) : null}
            {!imageAvailable ? (
              <Note tone="warning">
                {image.name} {image.version} has no tested template at {site.name}.
              </Note>
            ) : null}

            {submitted ? (
              <Note>
                This is a mock console — no operation was created. In the real
                control plane this would open a durable, retry-safe operation and
                stream its stages.
              </Note>
            ) : null}

            <Button
              className="w-full"
              type="button"
              variant="primary"
              disabled={!canCreate}
              onClick={() => setSubmitted(true)}
            >
              Create instance
            </Button>

            <div className="flex items-start gap-2 text-xs text-ink-400">
              <IconLock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                This instance gets no public IP. Access requires an enrolled
                device and project permission.
              </span>
            </div>

            <Link
              href="/console/instances"
              className="block text-center text-xs font-medium text-ink-500 hover:text-ink-800 hover:underline"
            >
              Cancel
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
