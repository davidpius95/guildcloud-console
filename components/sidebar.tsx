"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";
import {
  IconBucket,
  IconCube,
  IconDatabase,
  IconDisk,
  IconFunction,
  IconHome,
  IconNetwork,
  IconProjects,
  IconPulse,
  IconServer,
  IconSettings,
  IconStore,
  IconSupport,
  IconTransfer,
  IconWallet,
} from "./icons";

type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.JSX.Element;
  badge?: string;
  disabled?: boolean;
};

const groups: Array<{ heading?: string; items: NavItem[] }> = [
  {
    items: [
      { href: "/console", label: "Dashboard", icon: IconHome },
      { href: "/console/projects", label: "Projects", icon: IconProjects },
    ],
  },
  {
    heading: "Compute (Active)",
    items: [
      { href: "/console/instances", label: "Guild Instances", icon: IconServer },
      { href: "/console/volumes", label: "Volumes", icon: IconDisk },
      { href: "/console/networking", label: "Networking & Mesh", icon: IconNetwork },
    ],
  },
  {
    heading: "Account & Access",
    items: [
      { href: "/console/billing", label: "Billing", icon: IconWallet },
      { href: "/console/settings", label: "Settings & Keys", icon: IconSettings },
      { href: "/console/support", label: "Support", icon: IconSupport },
    ],
  },
  {
    heading: "Future Services",
    items: [
      { href: "/console/databases", label: "PostgreSQL", icon: IconDatabase, badge: "Soon", disabled: true },
      { href: "/console/storage", label: "Object Storage", icon: IconBucket, badge: "Soon", disabled: true },
      { href: "/console/kubernetes", label: "Kubernetes", icon: IconCube, badge: "Soon", disabled: true },
      { href: "/console/functions", label: "Functions", icon: IconFunction, badge: "Soon", disabled: true },
      { href: "/console/marketplace", label: "Marketplace", icon: IconStore, badge: "Soon", disabled: true },
      { href: "/console/migration", label: "Migration", icon: IconTransfer, badge: "Soon", disabled: true },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-ink-950/96 backdrop-blur lg:flex">
      <Link
        href="/"
        className="flex items-center gap-2.5 px-5 py-5 text-white transition-opacity hover:opacity-80"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-lemon-400">
          <span className="h-3.5 w-3.5 rounded-[3px] bg-ink-950" />
        </span>
        <span className="text-sm font-semibold tracking-tight">
          Guild<span className="text-lemon-400">Cloud</span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-6">
        {groups.map((group, i) => (
          <div key={group.heading ?? i} className="mb-5">
            {group.heading ? (
              <p className="mb-1.5 px-3 text-[0.65rem] font-semibold uppercase tracking-widest text-ink-500">
                {group.heading}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/console"
                    ? pathname === "/console"
                    : pathname.startsWith(item.href);
                const Icon = item.icon;

                if (item.disabled) {
                  return (
                    <li key={item.label}>
                      <div
                        className="flex items-center justify-between rounded-lg px-3 py-1.5 text-xs text-ink-500 cursor-not-allowed opacity-60"
                        title="Coming Soon"
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon className="h-3.5 w-3.5 shrink-0 text-ink-600" />
                          <span>{item.label}</span>
                        </div>
                        {item.badge ? (
                          <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] font-medium tracking-wide uppercase text-ink-400">
                            {item.badge}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cx(
                        "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-all duration-200",
                        active
                          ? "bg-white/10 font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                          : "text-ink-300 hover:bg-ink-900 hover:text-white hover:translate-x-0.5",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon
                          className={cx(
                            "h-4 w-4 shrink-0",
                            active ? "text-lemon-400" : "text-ink-400",
                          )}
                        />
                        <span>{item.label}</span>
                      </div>
                      {item.badge ? (
                        <span className="rounded bg-lemon-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-lemon-400">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-900 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-ink-400">
            Environment
          </p>
        </div>
        <p className="mt-1 text-xs text-ink-300">
          Guild-A live &middot; Guild-B onboarding
        </p>
      </div>
    </aside>
  );
}
