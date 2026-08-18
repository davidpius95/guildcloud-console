import Link from "next/link";
import {
  IconArrowRight,
  IconBucket,
  IconCube,
  IconDatabase,
  IconDisk,
  IconFunction,
  IconLock,
  IconServer,
  IconShield,
} from "@/components/icons";

const services = [
  {
    icon: IconServer,
    name: "Guild Instances",
    promise:
      "Private virtual servers with supported OS images, safe resize, volumes, backup, monitoring, and SSH keys.",
    boundary: "No public VPS IP or public SSH in the MVP.",
  },
  {
    icon: IconCube,
    name: "Guild Kubernetes",
    promise: "One project-isolated shared managed cluster per site.",
    boundary: "Dedicated clusters are a future premium module.",
  },
  {
    icon: IconDatabase,
    name: "Managed PostgreSQL",
    promise: "Private managed PostgreSQL with backup, recovery, and monitoring.",
    boundary: "MySQL is future work.",
  },
  {
    icon: IconBucket,
    name: "Object Storage",
    promise: "S3-compatible application and file storage with versioning.",
    boundary: "Storage classes expand later.",
  },
  {
    icon: IconDisk,
    name: "Guild Volumes",
    promise: "Expandable block storage for instances and persistent workloads.",
    boundary: "Disk shrinking is not offered in the MVP.",
  },
  {
    icon: IconFunction,
    name: "Guild Functions",
    promise:
      "Node.js and Python functions for HTTP, schedules, storage events, and PostgreSQL events.",
    boundary: "Container runtime is advanced/future.",
  },
];

const tiers = [
  {
    name: "Standard",
    price: "Included",
    promise:
      "Daily encrypted off-site backup, seven-day retention, and restore into a healthy site.",
    treatment: "Included baseline on every resource.",
    featured: false,
  },
  {
    name: "Protected",
    price: "Paid add-on",
    promise:
      "More frequent recovery points, a longer retention option, and priority restore handling.",
    treatment: "For workloads where a day of loss is too much.",
    featured: true,
  },
  {
    name: "Warm Standby",
    price: "Premium",
    promise:
      "A prepared secondary-site recovery workflow, offered only after real full-site drills pass.",
    treatment: "Limited capacity. No active-active promise.",
    featured: false,
  },
];

export default function LandingPage() {
  return (
    <div className="bg-white">
      <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-lemon-400">
              <span className="h-3.5 w-3.5 rounded-[3px] bg-ink-950" />
            </span>
            <span className="text-base font-semibold tracking-tight text-ink-900">
              GuildCloud
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-7 text-sm text-ink-600 md:flex">
            <a href="#services" className="hover:text-ink-900">
              Services
            </a>
            <a href="#private" className="hover:text-ink-900">
              Private access
            </a>
            <a href="#recovery" className="hover:text-ink-900">
              Recovery
            </a>
            <a href="#pricing" className="hover:text-ink-900">
              Pricing
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <Link
              href="/sign-in"
              className="rounded-lg px-3 py-2 text-sm text-ink-600 transition-colors hover:bg-ink-50 hover:text-ink-900"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-lemon-400 px-3.5 py-2 text-sm font-semibold text-ink-900 ring-1 ring-inset ring-lemon-500/40 transition-colors hover:bg-lemon-300"
            >
              Start building
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-ink-100">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-40 h-[32rem] w-[32rem] rounded-full bg-lemon-200/50 blur-3xl animate-float-soft"
        />
        <div className="relative mx-auto max-w-6xl px-5 py-20 sm:py-28">
          <span className="inline-flex items-center gap-2 rounded-full bg-lemon-50 px-3 py-1 text-xs font-medium text-lemon-800 ring-1 ring-inset ring-lemon-200">
            <IconLock className="h-3.5 w-3.5" />
            Private by default — no public SSH route on MVP instances
          </span>

          <h1 className="animate-fade-up mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink-900 sm:text-6xl">
            Cloud infrastructure without the{" "}
            <span className="relative whitespace-nowrap">
              <span className="absolute inset-x-0 bottom-1.5 h-3 bg-lemon-300" />
              <span className="relative">exposed surface</span>
            </span>
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-500">
            Create and operate application infrastructure without needing to
            understand Proxmox, tunnels, or VLANs. Your servers get a private
            hostname and a stable project IP — reachable from your enrolled
            devices, and nowhere else.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-lg bg-lemon-400 px-5 py-3 text-sm font-semibold text-ink-900 ring-1 ring-inset ring-lemon-500/40 transition-colors hover:bg-lemon-300"
            >
              Start building
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#talk"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-ink-800 ring-1 ring-inset ring-ink-200 transition-colors hover:bg-ink-50"
            >
              Talk to GuildCloud
            </a>
          </div>

          <p className="mt-5 max-w-xl text-xs text-ink-400">
            GuildCloud is not an AWS replacement at launch. It is a focused,
            trustworthy private cloud first — and every claim on this page is
            written to match what has actually been tested.
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              ["Private access", "No public SSH route on MVP instances"],
              ["Clear recovery", "Restores are tested before they are promised"],
              ["Wallet-first", "Costs stay visible before anything is created"],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-xl border border-ink-100 bg-white/85 p-4 shadow-[0_1px_2px_rgba(23,29,54,0.04)] backdrop-blur">
                <p className="text-sm font-semibold text-ink-900">{title}</p>
                <p className="mt-1 text-xs leading-5 text-ink-500">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-ink-100 bg-ink-950">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            A calm, dense operational console
          </h2>
          <p className="mt-2 max-w-2xl text-sm text-ink-300">
            DigitalOcean-style guided clarity with Hetzner-style compact
            operational detail. Slow work is never hidden — provisioning streams
            its stages, and failures tell you which stage failed.
          </p>

            <div className="mt-8 overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-white/10 animate-fade-up">
            <div className="flex items-center gap-2 border-b border-ink-100 bg-ink-50 px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              <span className="h-2.5 w-2.5 rounded-full bg-lemon-400" />
              <span className="ml-3 font-mono text-xs text-ink-400">
                console.guildcloud.io/instances/api-prod-1
              </span>
            </div>
            <div className="grid gap-6 p-6 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-ink-400">Private hostname</p>
                <p className="mt-1 break-all font-mono text-sm text-ink-800">
                  api-prod-1.core.guild.internal
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-400">Hourly price</p>
                <p className="mt-1 font-mono text-sm text-ink-800">$0.062</p>
              </div>
              <div>
                <p className="text-xs font-medium text-ink-400">Monthly maximum</p>
                <p className="mt-1 font-mono text-sm text-ink-800">$44.64</p>
              </div>
              <div className="sm:col-span-3">
                <div className="rounded-lg bg-ink-50 px-4 py-3 font-mono text-xs text-ink-700 ring-1 ring-inset ring-ink-100">
                  ssh saurabh@api-prod-1.core.guild.internal
                </div>
              </div>
              <div className="flex flex-wrap gap-2 sm:col-span-3">
                {["Preparing", "Creating", "Configuring private access", "Testing connection", "Ready"].map(
                  (stage, i) => (
                    <span
                      key={stage}
                      className={
                        i < 4
                          ? "rounded-full bg-lemon-100 px-3 py-1 text-xs font-medium text-lemon-800"
                          : "rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-400"
                      }
                    >
                      {stage}
                    </span>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="mt-6">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 text-sm font-medium text-lemon-400 hover:text-lemon-300"
            >
              Explore the console
              <IconArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <section id="services" className="border-b border-ink-100">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
            What GuildCloud promises
          </h2>
          <p className="mt-3 max-w-2xl text-ink-500">
            Each service ships with an explicit boundary. If something is not
            offered yet, it says so here rather than in a support ticket later.
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.name}
                  className="rounded-xl border border-ink-100 p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-lemon-100 text-lemon-800">
                    <Icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-ink-900">
                    {s.name}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">
                    {s.promise}
                  </p>
                  <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-400">
                    <span className="font-medium text-ink-500">Boundary:</span>{" "}
                    {s.boundary}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="private" className="border-b border-ink-100 bg-ink-50">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
              Private access, without the homework
            </h2>
            <p className="mt-4 text-ink-500">
              Public-IP server access creates exposure and setup work you did not
              ask for. GuildCloud instances have no public IP at all. Your laptop
              and your servers each establish outbound encrypted connectivity, and
              your project policy decides who can reach what.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                "A stable private project IP and a friendly private hostname per instance",
                "Individual named administrator accounts with sudo — not shared root",
                "SSH keys on by default; password SSH is opt-in, private-route only, and never stored by GuildCloud",
                "Removing a teammate revokes network permission and server login together",
                "A browser recovery console for exceptional recovery, not ordinary use",
              ].map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm text-ink-700">
                  <span className="mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full bg-lemon-400 text-[0.6rem] font-bold text-ink-900">
                    ✓
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-ink-100 bg-white p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-ink-400">
              Network zones
            </p>
            <div className="mt-4 space-y-3">
              {[
                ["Management", "Never customer reachable", "neutral"],
                ["Tenant", "Your project users and workloads only", "lemon"],
                ["Backup", "Never customer reachable", "neutral"],
                ["Edge", "Future — only for explicitly published apps", "amber"],
              ].map(([zone, reach, tone]) => (
                <div
                  key={zone}
                  className="flex items-center justify-between gap-3 rounded-lg bg-ink-50 px-4 py-3"
                >
                  <span className="text-sm font-medium text-ink-900">{zone}</span>
                  <span
                    className={
                      tone === "lemon"
                        ? "text-right text-xs font-medium text-lemon-700"
                        : tone === "amber"
                          ? "text-right text-xs font-medium text-amber-600"
                          : "text-right text-xs text-ink-400"
                    }
                  >
                    {reach}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-5 text-xs text-ink-400">
              You never talk to Proxmox directly. GuildCloud owns the control
              plane; Proxmox is the execution plane behind it.
            </p>
          </div>
        </div>
      </section>

      <section id="recovery" className="border-b border-ink-100">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
            Recovery you can actually check
          </h2>
          <p className="mt-3 max-w-2xl text-ink-500">
            A backup is not considered valid until a restore drill proves it can be
            used. These tiers describe workflows that have been run, not
            aspirations.
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {tiers.map((t) => (
              <div
                key={t.name}
                className={
                  t.featured
                    ? "rounded-xl border-2 border-lemon-400 bg-lemon-50/40 p-6"
                    : "rounded-xl border border-ink-100 p-6"
                }
              >
                <div className="flex items-center gap-2">
                  <IconShield className="h-4 w-4 text-lemon-600" />
                  <h3 className="text-base font-semibold text-ink-900">{t.name}</h3>
                </div>
                <p className="mt-3 text-sm font-medium text-lemon-800">{t.price}</p>
                <p className="mt-3 text-sm leading-relaxed text-ink-600">
                  {t.promise}
                </p>
                <p className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-400">
                  {t.treatment}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 rounded-xl bg-ink-50 px-6 py-5 text-sm text-ink-600 ring-1 ring-inset ring-ink-100">
            No untested SLA and no active-active promise. Multi-site application
            placement applies only to compatible stateless Kubernetes and function
            workloads — it is not ordinary VM protection.
          </div>
        </div>
      </section>

      <section id="pricing" className="border-b border-ink-100 bg-ink-50">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <h2 className="text-3xl font-semibold tracking-tight text-ink-900">
            Costs you can see before you commit
          </h2>
          <p className="mt-3 max-w-2xl text-ink-500">
            GuildCloud is wallet-first. Every metered event becomes an explainable
            ledger entry, and the hourly price and monthly maximum appear before
            anything is created.
          </p>

          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {[
              ["Before creation", "Hourly price, monthly maximum, protection, storage, and add-on costs."],
              ["One wallet", "Per organization, with optional auto-reload you configure."],
              ["Local payment rails", "Paystack and Flutterwave, with methods suited to your country and currency."],
              ["No silent deletion", "Payment failures get retries, notice, and a documented grace period."],
            ].map(([title, detail]) => (
              <div key={title} className="rounded-xl border border-ink-100 bg-white p-6">
                <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
                <p className="mt-2 text-sm text-ink-500">{detail}</p>
              </div>
            ))}
          </div>

          <p className="mt-8 max-w-2xl text-xs text-ink-400">
            Plan sizes and prices are derived from measured site capacity. Nothing
            is advertised that cannot be consistently delivered.
          </p>
        </div>
      </section>

      <section id="talk" className="border-b border-ink-100">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="rounded-2xl bg-ink-950 px-8 py-14 text-center sm:px-14">
            <h2 className="text-3xl font-semibold tracking-tight text-white">
              Start building, or talk it through first
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-ink-300">
              Anyone can sign up and explore. Email and payment verification are
              required before paid resources are created — and larger limits or
              custom recovery go through a conversation.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link
                href="/sign-up"
                className="inline-flex items-center gap-2 rounded-lg bg-lemon-400 px-5 py-3 text-sm font-semibold text-ink-900 transition-colors hover:bg-lemon-300"
              >
                Start building
                <IconArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="mailto:hello@guildcloud.io"
                className="inline-flex items-center gap-2 rounded-lg bg-ink-800 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-ink-700"
              >
                Talk to GuildCloud
              </a>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-5 py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-lemon-400">
              <span className="h-3 w-3 rounded-[2px] bg-ink-950" />
            </span>
            <span className="text-sm font-semibold text-ink-900">GuildCloud</span>
          </div>
          <p className="text-xs text-ink-400">
            Private by default, measured capacity, clear bills, tested recovery,
            documented operations.
          </p>
        </div>
      </footer>
    </div>
  );
}
