import Link from "next/link";
import { IconCloud } from "@/components/icons";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Link href="/" className="flex items-center gap-2 text-ink-900">
            <IconCloud className="h-6 w-6 text-lemon-500" />
            <span className="text-lg font-semibold">GuildCloud</span>
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
