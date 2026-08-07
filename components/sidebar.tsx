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
  IconWallet,
} from "./icons";

type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.JSX.Element;
};

const groups: Array<{ heading?: string; items: NavItem[] }> = [
  {
    items: [
      { href: "/console", label: "Dashboard", icon: IconHome },
      { href: "/console/projects", label: "Projects", icon: IconProjects },
    ],
  },
  {
    heading: "Compute",
    items: [
      { href: "/console/instances", label: "Guild Instances", icon: IconServer },
      { href: "/console/kubernetes", label: "Kubernetes", icon: IconCube },
      { href: "/console/functions", label: "Functions", icon: IconFunction },
    ],
  },
  {
    heading: "Data & storage",
    items: [
      { href: "/console/databases", label: "PostgreSQL", icon: IconDatabase },
      { href: "/console/storage", label: "Object Storage", icon: IconBucket },
      { href: "/console/volumes", label: "Volumes", icon: IconDisk },
    ],
  },
  {
    heading: "Platform",
    items: [
      { href: "/console/networking", label: "Networking", icon: IconNetwork },
      { href: "/console/monitoring", label: "Monitoring", icon: IconPulse },
      { href: "/console/marketplace", label: "Marketplace", icon: IconStore },
    ],
  },
  {
    heading: "Account",
    items: [
      { href: "/console/billing", label: "Billing", icon: IconWallet },
      { href: "/console/settings", label: "Settings", icon: IconSettings },
      { href: "/console/support", label: "Support", icon: IconSupport },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-60 shrink-0 flex-col bg-ink-950 lg:flex">
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
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cx(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                        active
                          ? "bg-ink-800 font-medium text-white"
                          : "text-ink-300 hover:bg-ink-900 hover:text-white",
                      )}
                    >
                      <Icon
                        className={cx(
                          "h-4 w-4 shrink-0",
                          active ? "text-lemon-400" : "text-ink-400",
                        )}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-ink-900 px-5 py-4">
        <p className="text-[0.65rem] font-semibold uppercase tracking-widest text-ink-500">
          Environment
        </p>
        <p className="mt-1 text-xs text-ink-300">
          Mock data — no live infrastructure is attached.
        </p>
      </div>
    </aside>
  );
}
