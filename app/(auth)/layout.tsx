import Link from "next/link";
import { IconCloud } from "@/components/icons";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-80 w-80 -translate-x-1/2 rounded-full bg-lemon-200/50 blur-3xl animate-float-soft"
      />
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="hidden lg:block">
          <Link href="/" className="mb-8 inline-flex items-center gap-2 text-ink-900">
            <IconCloud className="h-6 w-6 text-lemon-500" />
            <span className="text-lg font-semibold">GuildCloud</span>
          </Link>

          <div className="max-w-xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-lemon-700">
              Private cloud access
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-ink-900">
              Clear sign-in, private-by-default infrastructure, and no surprise UI.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-ink-500">
              GuildCloud keeps the entry path simple: sign in, enroll a device, and
              move into a dashboard that tells the truth about access, cost, and
              recovery.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                ["Private access", "No public SSH or public VPS route on MVP instances."],
                ["Operational clarity", "Costs, backup state, and alerts are visible up front."],
                ["Recovery-first", "Backups are treated as valid only after a drill."],
                ["Low friction", "Google, GitHub, or email sign-in with a calm layout."],
              ].map(([title, detail]) => (
                <div key={title} className="rounded-xl border border-ink-100 bg-white/80 p-4 shadow-[0_1px_2px_rgba(23,29,54,0.04)]">
                  <p className="text-sm font-semibold text-ink-900">{title}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-500">{detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto w-full max-w-sm lg:ml-auto">
          <div className="mb-8 flex justify-center lg:hidden">
            <Link href="/" className="flex items-center gap-2 text-ink-900">
              <IconCloud className="h-6 w-6 text-lemon-500" />
              <span className="text-lg font-semibold">GuildCloud</span>
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
