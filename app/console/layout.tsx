import { redirect } from "next/navigation";
import { MobileNav } from "@/components/mobile-nav";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserOrg } from "@/lib/supabase/queries";

export default async function ConsoleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/sign-in");

  const userOrg = await getCurrentUserOrg();
  if (!userOrg) redirect("/onboarding");

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="console-root flex min-w-0 flex-1 flex-col bg-ink-50">
        <Topbar />
        <MobileNav />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
