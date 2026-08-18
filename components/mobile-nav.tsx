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
  { href: "/console/migration", label: "Migration" },
  { href: "/console/billing", label: "Billing" },
  { href: "/console/settings", label: "Settings" },
  { href: "/console/support", label: "Support" },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav className="overflow-x-auto border-b border-ink-100/80 bg-white/90 backdrop-blur lg:hidden">
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
                  "block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-all duration-200",
                  active
                    ? "bg-[#171d36] font-medium text-white shadow-[0_8px_18px_rgba(23,29,54,0.16)]"
                    : "text-ink-500 hover:-translate-y-px hover:bg-ink-100",
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
