"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, cx } from "./ui";
import {
  IconBell,
  IconChevron,
  IconCloud,
  IconGrid,
  IconNetwork,
  IconPlus,
  IconProjects,
  IconServer,
  IconSettings,
  IconWallet,
} from "./icons";
import { ThemeToggle } from "./theme-toggle";

export type TopbarProject = { id: string; name: string };

// Quick launch only lists surfaces that actually exist and work. It used to
// link to Kubernetes/PostgreSQL/Object Storage/Functions/Marketplace, none of
// which are built - a shortcut into an unbuilt page is a dead end, not a
// feature.
const quickLaunch = [
  { href: "/console/instances", label: "Guild Instances", icon: IconServer },
  { href: "/console/projects", label: "Projects", icon: IconProjects },
  { href: "/console/networking", label: "Networking", icon: IconNetwork },
  { href: "/console/settings", label: "Settings & Keys", icon: IconSettings },
  { href: "/console/how-it-works", label: "How GuildCloud works", icon: IconCloud },
];

function initialsFor(email: string) {
  const handle = email.split("@")[0] ?? "";
  const parts = handle.split(/[.\-_+]/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : handle.slice(0, 2);
  return (letters || "?").toUpperCase();
}

// Every value here used to come from lib/mock-data - a real signed-in user
// saw a stranger's name ("Saurabh Rapatwar"), a fabricated wallet balance,
// and a project switcher listing projects that were not theirs, on every
// single console page. All of it is now the caller's real organization,
// passed down from the console layout which already loads it.
export function Topbar({
  userEmail,
  organizationName,
  walletBalanceCents,
  projects,
}: {
  userEmail: string;
  organizationName: string;
  walletBalanceCents: number;
  projects: TopbarProject[];
}) {
  const [projectOpen, setProjectOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  const [activeProject, setActiveProject] = useState<TopbarProject | null>(
    projects[0] ?? null,
  );
  // There is no real alerts/monitoring backend yet, so there is nothing
  // genuine to badge. Showing a fabricated unread count trained users to
  // ignore the bell before it ever meant anything.
  const unread = 0;
  const walletLabel = `$${(walletBalanceCents / 100).toFixed(2)}`;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-100/80 bg-white/85 px-4 backdrop-blur-md sm:px-6 dark:border-white/5 dark:bg-[#171d36]/80">
      <Link href="/console" className="flex items-center gap-2 lg:hidden">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-lemon-400">
          <span className="h-3 w-3 rounded-[2px] bg-[#0e1226]" />
        </span>
      </Link>

      <div className="relative min-w-0">
        <button
          type="button"
          onClick={() => {
            setProjectOpen((v) => !v);
            setNotifOpen(false);
            setLaunchOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ring-1 ring-inset ring-ink-200 transition-all duration-200 hover:-translate-y-px hover:bg-ink-50"
        >
          <span className="hidden text-ink-500 sm:inline">Project</span>
          <span className="truncate font-medium text-ink-900">
            {activeProject?.name ?? "No project"}
          </span>
          <IconChevron className={cx("h-3.5 w-3.5 shrink-0 text-ink-500 transition-transform duration-200", projectOpen && "rotate-180")} />
        </button>
        {projectOpen ? (
          <div className="absolute left-0 top-11 w-64 overflow-hidden rounded-xl border border-ink-100 bg-white py-1 shadow-lg animate-fade-up">
            {projects.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-500">
                No projects yet.
              </p>
            ) : null}
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActiveProject(p);
                  setProjectOpen(false);
                }}
                className={cx(
                  "flex w-full items-start px-3 py-2 text-left transition-colors hover:bg-ink-50",
                  p.id === activeProject?.id && "bg-ink-100",
                )}
              >
                <span className="text-sm font-medium text-ink-900">{p.name}</span>
              </button>
            ))}
            <div className="mt-1 border-t border-ink-100 px-3 py-2">
              <Link
                href="/console/projects"
                className="text-xs font-medium text-lemon-700 dark:text-lemon-400 hover:underline"
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
            className="hidden items-center gap-2 rounded-lg bg-lemon-50 px-3 py-1.5 text-sm ring-1 ring-inset ring-lemon-200 transition-all duration-200 hover:-translate-y-px hover:bg-lemon-100 sm:flex"
        >
          <IconWallet className="h-4 w-4 text-lemon-700 dark:text-lemon-400" />
          <span className="text-lemon-800">Wallet</span>
          <span className="font-semibold tabular-nums text-lemon-900">
            {walletLabel}
          </span>
        </Link>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setNotifOpen((v) => !v);
              setProjectOpen(false);
              setLaunchOpen(false);
            }}
            aria-label="Notifications"
            className="relative grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition-all duration-200 hover:-translate-y-px hover:bg-ink-100 hover:text-ink-800"
          >
            <IconBell className="h-4.5 w-4.5" />
            {unread > 0 ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
            ) : null}
          </button>
          {notifOpen ? (
            <div className="absolute right-0 top-11 w-80 overflow-hidden rounded-xl border border-ink-100 bg-white shadow-lg animate-fade-up">
              <div className="border-b border-ink-100 px-4 py-2.5 text-xs font-semibold text-ink-500">
                Notifications
              </div>
              <p className="px-4 py-4 text-xs leading-relaxed text-ink-500">
                No alerts. Instance health and capacity alerting arrive with
                monitoring — you&rsquo;ll see real events here once that ships.
              </p>
            </div>
          ) : null}
        </div>

        <ThemeToggle />

        <div className="relative hidden sm:block">
          <button
            type="button"
            onClick={() => {
              setLaunchOpen((v) => !v);
              setProjectOpen(false);
              setNotifOpen(false);
            }}
            aria-label="Quick launch"
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition-all duration-200 hover:-translate-y-px hover:bg-ink-100 hover:text-ink-800"
          >
            <IconGrid className="h-4.5 w-4.5" />
          </button>
          {launchOpen ? (
            <div className="absolute right-0 top-11 grid w-72 grid-cols-2 gap-1 overflow-hidden rounded-xl border border-ink-100 bg-white p-2 shadow-lg animate-fade-up">
              {quickLaunch.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setLaunchOpen(false)}
                    className="flex flex-col items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-ink-50"
                  >
                    <Icon className="h-4 w-4 text-lemon-700 dark:text-lemon-400" />
                    <span className="text-xs font-medium text-ink-800">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          ) : null}
        </div>

        <Button href="/console/instances/new" size="sm">
          <IconPlus className="h-3.5 w-3.5" />
          Create
        </Button>

        <Link
          href="/console/settings"
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-all duration-200 hover:-translate-y-px hover:bg-ink-50"
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#171d36] text-xs font-semibold text-lemon-400">
            {initialsFor(userEmail)}
          </span>
          <span className="hidden max-w-[14rem] truncate text-sm font-medium text-ink-800 xl:block">
            {userEmail}
          </span>
          <span className="sr-only">Signed in to {organizationName}</span>
        </Link>
      </div>
    </header>
  );
}
