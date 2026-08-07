import { MobileNav } from "@/components/mobile-nav";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-ink-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <MobileNav />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
