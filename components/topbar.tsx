"use client";

import Link from "next/link";
import { useState } from "react";
import { alerts, currentUser, money, organization, projects } from "@/lib/mock-data";
import { Button, cx } from "./ui";
import { IconBell, IconChevron, IconGrid, IconPlus, IconWallet } from "./icons";

export function Topbar() {
  const [projectOpen, setProjectOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [activeProject, setActiveProject] = useState(projects[0]);
  const unread = alerts.filter((a) => !a.acknowledged).length;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-100 bg-white/90 px-4 backdrop-blur sm:px-6">
      <Link href="/console" className="flex items-center gap-2 lg:hidden">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-lemon-400">
          <span className="h-3 w-3 rounded-[2px] bg-ink-950" />
        </span>
      </Link>

      <div className="relative min-w-0">
        <button
          type="button"
          onClick={() => {
            setProjectOpen((v) => !v);
            setNotifOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-inset ring-ink-200 transition-colors hover:bg-ink-50"
        >
          <span className="hidden text-ink-400 sm:inline">Project</span>
          <span className="truncate font-medium text-ink-900">
            {activeProject.name}
          </span>
          <IconChevron className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        </button>
        {projectOpen ? (
          <div className="absolute left-0 top-11 w-64 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-lg">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActiveProject(p);
                  setProjectOpen(false);
                }}
                className={cx(
                  "flex w-full flex-col items-start px-3 py-2 text-left transition-colors hover:bg-ink-50",
                  p.id === activeProject.id && "bg-lemon-50",
                )}
              >
                <span className="text-sm font-medium text-ink-900">{p.name}</span>
                <span className="text-xs text-ink-400">
                  {p.resourceCount} resources · {money(p.monthlySpend)}/mo
                </span>
              </button>
            ))}
            <div className="mt-1 border-t border-ink-100 px-3 py-2">
              <Link
                href="/console/projects"
                className="text-xs font-medium text-lemon-700 hover:underline"
                onClick={() => setProjectOpen(false)}
              >
                Manage all projects
              </Link>
            </div>
          </div>
        ) : null}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
        <Link
          href="/console/billing"
          className="hidden items-center gap-2 rounded-lg bg-lemon-50 px-3 py-1.5 text-sm ring-1 ring-inset ring-lemon-200 transition-colors hover:bg-lemon-100 sm:flex"
        >
          <IconWallet className="h-4 w-4 text-lemon-700" />
          <span className="text-ink-500">Wallet</span>
          <span className="font-semibold tabular-nums text-ink-900">
            {money(organization.walletBalance)}
          </span>
        </Link>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setNotifOpen((v) => !v);
              setProjectOpen(false);
            }}
            aria-label="Notifications"
            className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            <IconBell className="h-4.5 w-4.5" />
            {unread > 0 ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
            ) : null}
          </button>
          {notifOpen ? (
            <div className="absolute right-0 top-11 w-80 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg">
              <div className="border-b border-ink-100 px-4 py-2.5 text-xs font-semibold text-ink-500">
                {unread} unacknowledged alert{unread === 1 ? "" : "s"}
              </div>
              {alerts.slice(0, 4).map((a) => (
                <div key={a.id} className="border-b border-ink-50 px-4 py-2.5 last:border-0">
                  <p className="text-sm font-medium text-ink-900">{a.title}</p>
                  <p className="mt-0.5 text-xs text-ink-400">
                    {a.resource} · {a.openedAt}
                  </p>
                </div>
              ))}
              <Link
                href="/console/monitoring"
                className="block px-4 py-2.5 text-xs font-medium text-lemon-700 hover:underline"
                onClick={() => setNotifOpen(false)}
              >
                View monitoring and alerts
              </Link>
            </div>
          ) : null}
        </div>

        <Link
          href="/console/marketplace"
          aria-label="Marketplace"
          className="hidden h-9 w-9 place-items-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800 sm:grid"
        >
          <IconGrid className="h-4.5 w-4.5" />
        </Link>

        <Button href="/console/instances/new" size="sm">
          <IconPlus className="h-3.5 w-3.5" />
          Create
        </Button>

        <Link
          href="/console/settings"
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-ink-50"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-900 text-xs font-semibold text-lemon-400">
            {currentUser.name
              .split(" ")
              .map((n) => n[0])
              .join("")}
          </span>
          <span className="hidden text-sm font-medium text-ink-800 xl:block">
            {currentUser.name}
          </span>
        </Link>
      </div>
    </header>
  );
}
