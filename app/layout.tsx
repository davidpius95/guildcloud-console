import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "GuildCloud — private-by-default cloud",
  description:
    "Create and operate application infrastructure without needing to understand Proxmox, tunnels, or VLANs. Private by default, clear costs, tested recovery.",
};

const THEME_BOOTSTRAP = `
(function () {
  try {
    var stored = localStorage.getItem("guildcloud-theme");
    var theme = stored || "light";
    if (theme === "dark") document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {THEME_BOOTSTRAP}
        </Script>
        {children}
      </body>
    </html>
  );
}
