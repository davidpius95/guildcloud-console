"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

const items = [
  { href: "/console", label: "Dashboard" },
  { href: "/console/projects", label: "Projects" },
  { href: "/console/instances", label: "Instances" },
  { href: "/console/kubernetes", label: "Kubernetes" },
  { href: "/console/databases", label: "PostgreSQL" },
  { href: "/console/storage", label: "Storage" },
  { href: "/console/volumes", label: "Volumes" },
  { href: "/console/functions", label: "Functions" },
  { href: "/console/networking", label: "Networking" },
  { href: "/console/monitoring", label: "Monitoring" },
  { href: "/console/marketplace", label: "Marketplace" },
  { href: "/console/billing", label: "Billing" },
  { href: "/console/settings", label: "Settings" },
  { href: "/console/support", label: "Support" },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="overflow-x-auto border-b border-ink-100 bg-white lg:hidden">
      <ul className="flex min-w-max gap-1 px-4 py-2">
        {items.map((item) => {
          const active =
            item.href === "/console"
              ? pathname === "/console"
              : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cx(
                  "block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-ink-900 font-medium text-white"
                    : "text-ink-500 hover:bg-ink-100",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
