import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GuildCloud — private-by-default cloud",
  description:
    "Create and operate application infrastructure without needing to understand Proxmox, tunnels, or VLANs. Private by default, clear costs, tested recovery.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
