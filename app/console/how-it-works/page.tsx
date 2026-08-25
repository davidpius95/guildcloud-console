import Link from "next/link";
import {
  IconArrowRight,
  IconCloud,
  IconLock,
  IconNetwork,
  IconPulse,
  IconServer,
  IconShield,
  IconWallet,
} from "@/components/icons";
import { Badge, Button, cx } from "@/components/ui";

type Tone = "lemon" | "sky" | "amber" | "ink";
type Icon = (props: { className?: string }) => React.JSX.Element;

const steps: Array<{
  eyebrow: string;
  title: string;
  plain: string;
  detail: string;
  icon: Icon;
  tone: Tone;
}> = [
  {
    eyebrow: "1 · You choose",
    title: "Describe the server you need",
    plain: "Pick a project, an operating system, and a size. Think of it like choosing the shape of a new computer.",
    detail: "Your project keeps its servers, access rules, and people together. The selected size reserves CPU, memory, and disk for that server.",
    icon: IconServer,
    tone: "lemon",
  },
  {
    eyebrow: "2 · GuildCloud checks",
    title: "Find a healthy place to run it",
    plain: "Before anything is created, GuildCloud checks which site has room and can run your chosen image.",
    detail: "The placement controller considers available capacity, the requested operating system, and each site's current admission status. It only sends work to an eligible site.",
    icon: IconCloud,
    tone: "sky",
  },
  {
    eyebrow: "3 · A site worker builds",
    title: "Prepare a real virtual server",
    plain: "A worker at the selected site copies the approved starting image onto local hardware and gives it your requested resources.",
    detail: "The worker asks Proxmox — the software that manages the physical servers — to create, configure, and start your virtual machine. The console reports each stage as it completes.",
    icon: IconPulse,
    tone: "amber",
  },
  {
    eyebrow: "4 · You connect",
    title: "Give it a private door, not a public hole",
    plain: "Your server receives a private address and private hostname. Your approved devices connect outward through an encrypted mesh.",
    detail: "There is no need to open a public port or manage a router rule. Project access policy determines which approved people and workloads can reach the server.",
    icon: IconNetwork,
    tone: "ink",
  },
];

const toneStyles: Record<Tone, string> = {
  lemon: "border-lemon-200 bg-lemon-50 text-lemon-800",
  sky: "border-sky-200 bg-sky-50 text-sky-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  ink: "border-ink-200 bg-ink-50 text-ink-700",
};

function FlowNode({
  label,
  sublabel,
  icon: Icon,
  tone = "lemon",
  active = false,
}: {
  label: string;
  sublabel: string;
  icon: Icon;
  tone?: Tone;
  active?: boolean;
}) {
  return (
    <div className="relative z-10 min-w-36 flex-1 rounded-2xl border border-white/10 bg-white/[0.07] p-4 backdrop-blur-sm">
      <div className={cx("grid h-9 w-9 place-items-center rounded-xl", tone === "lemon" && "bg-lemon-400 text-ink-950", tone === "sky" && "bg-sky-300 text-sky-950", tone === "amber" && "bg-amber-300 text-amber-950", tone === "ink" && "bg-white text-ink-900")}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <p className="mt-4 text-sm font-semibold text-white">{label}</p>
      <p className="mt-1 text-xs leading-5 text-ink-300">{sublabel}</p>
      {active ? <span className="absolute right-3 top-3 flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lemon-300 opacity-75" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-lemon-300" /></span> : null}
    </div>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-6xl pb-8">
      <section className="relative overflow-hidden rounded-3xl bg-ink-950 px-6 py-8 shadow-[0_24px_70px_rgba(14,18,38,0.2)] sm:px-9 sm:py-10">
        <div className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-lemon-400/15 blur-3xl" />
        <div className="absolute -bottom-40 left-1/3 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
        <div className="relative max-w-3xl animate-fade-up">
          <Badge tone="lemon">GuildCloud field guide</Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">A clear path from idea to a server you can reach.</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-ink-300">GuildCloud turns a few simple choices into a private, working virtual server. This guide shows what happens, who is responsible for each part, and what you will see along the way.</p>
        </div>
        <div className="relative mt-8 grid gap-3 md:grid-cols-4">
          <div className="pointer-events-none absolute left-[9%] right-[9%] top-[29px] hidden h-px overflow-hidden bg-white/15 md:block"><div className="animate-operation-flow h-full w-1/3 bg-gradient-to-r from-transparent via-lemon-300 to-transparent" /></div>
          <FlowNode label="Your request" sublabel="Choose the basics" icon={IconServer} />
          <FlowNode label="Placement" sublabel="Find an eligible site" icon={IconCloud} tone="sky" active />
          <FlowNode label="Site worker" sublabel="Build and configure" icon={IconPulse} tone="amber" />
          <FlowNode label="Private access" sublabel="Connect approved devices" icon={IconLock} tone="ink" />
        </div>
      </section>

      <nav aria-label="Guide sections" className="mt-5 flex gap-2 overflow-x-auto pb-1">
        {[ ["#provisioning", "Create a server"], ["#access", "Private access"], ["#care", "Care & visibility"], ["#costs", "Costs & control"], ["#questions", "Questions"] ].map(([href, label]) => <a key={href} href={href} className="shrink-0 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-600 transition hover:-translate-y-px hover:border-lemon-300 hover:text-ink-900">{label}</a>)}
      </nav>

      <section id="provisioning" className="scroll-mt-20 pt-12">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lemon-700">Creating a server</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">Four checks between your click and a running machine.</h2>
          <p className="mt-3 text-sm leading-6 text-ink-500">The progress screen is not a loading animation. It follows the real work in order, so you can see where your request is and what it is waiting for.</p>
        </div>
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {steps.map((step, index) => {
            const Icon = step.icon;
            return <article key={step.title} className="group relative overflow-hidden rounded-2xl border border-ink-100 bg-white p-5 shadow-[0_1px_2px_rgba(23,29,54,0.04)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_45px_rgba(23,29,54,0.1)]">
              <span className="absolute right-4 top-3 text-6xl font-semibold leading-none text-ink-50">0{index + 1}</span>
              <div className={cx("relative grid h-10 w-10 place-items-center rounded-xl border", toneStyles[step.tone])}><Icon className="h-5 w-5" /></div>
              <p className="relative mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-400">{step.eyebrow}</p>
              <h3 className="relative mt-1 text-lg font-semibold tracking-tight text-ink-900">{step.title}</h3>
              <p className="relative mt-2 text-sm leading-6 text-ink-600">{step.plain}</p>
              <details className="relative mt-4 border-t border-ink-100 pt-3"><summary className="cursor-pointer text-sm font-medium text-ink-700 marker:text-lemon-600 hover:text-ink-950">What is happening behind the scenes?</summary><p className="mt-2 text-sm leading-6 text-ink-500">{step.detail}</p></details>
            </article>;
          })}
        </div>
      </section>

      <section id="access" className="scroll-mt-20 pt-14">
        <div className="grid overflow-hidden rounded-3xl border border-ink-100 bg-white lg:grid-cols-[1.05fr_.95fr]">
          <div className="p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Private access</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">Your server stays off the public internet by default.</h2>
            <p className="mt-3 text-sm leading-6 text-ink-500">Instead of exposing a password prompt to everyone on the internet, you approve the people and devices that should reach your project.</p>
            <div className="mt-6 space-y-3">
              {[ ["1", "Invite or approve", "Choose the people and devices that belong in your project."], ["2", "Connect privately", "Their device makes an encrypted outbound connection — no port forwarding."], ["3", "Use the private name", "Connect to the server using its private address or friendly private hostname."] ].map(([number, title, description]) => <div key={number} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">{number}</span><div><p className="text-sm font-semibold text-ink-800">{title}</p><p className="mt-0.5 text-sm leading-5 text-ink-500">{description}</p></div></div>)}
            </div>
            <Button href="/console/networking" variant="secondary" className="mt-7">Manage private access <IconArrowRight className="h-4 w-4" /></Button>
          </div>
          <div className="relative min-h-80 overflow-hidden bg-ink-950 p-6 sm:p-8">
            <div className="absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(255,255,255,.35)_1px,transparent_1px)] [background-size:22px_22px]" />
            <div className="relative mx-auto mt-2 max-w-sm">
              <div className="rounded-2xl border border-sky-300/30 bg-sky-300/10 p-4 text-center"><IconShield className="mx-auto h-6 w-6 text-sky-200" /><p className="mt-2 text-sm font-semibold text-white">Your approved device</p><p className="mt-1 text-xs text-ink-300">Encrypted outbound connection</p></div>
              <div className="mx-auto h-12 w-px bg-gradient-to-b from-sky-300 to-lemon-300" /><div className="mx-auto w-fit rounded-full border border-lemon-300/30 bg-lemon-400/10 px-3 py-1 text-xs font-medium text-lemon-200">Private mesh</div><div className="mx-auto h-12 w-px bg-gradient-to-b from-lemon-300 to-white" />
              <div className="rounded-2xl border border-white/15 bg-white/[0.08] p-4 text-center backdrop-blur"><IconServer className="mx-auto h-6 w-6 text-white" /><p className="mt-2 text-sm font-semibold text-white">Your Guild Instance</p><p className="mt-1 text-xs text-ink-300">Private address and hostname</p></div>
              <p className="mt-5 text-center text-xs leading-5 text-ink-400">No public IP or inbound port needs to be opened for private access.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="care" className="scroll-mt-20 pt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lemon-700">Care and visibility</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink-900">You stay informed; the infrastructure does the repetitive work.</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[ [IconPulse, "Progress you can follow", "During provisioning, every important stage is shown with a status, elapsed time, and clear next step."], [IconShield, "Guardrails before work starts", "Capacity and image checks happen before a site begins a build, reducing avoidable failures and surprises."], [IconLock, "Clear ownership", "Projects define who can reach servers and who can make changes. You can review access from the console."] ].map(([Icon, title, detail]) => { const ItemIcon = Icon as Icon; return <article key={title as string} className="rounded-2xl border border-ink-100 bg-white p-5"><ItemIcon className="h-5 w-5 text-lemon-600" /><h3 className="mt-4 font-semibold text-ink-900">{title as string}</h3><p className="mt-2 text-sm leading-6 text-ink-500">{detail as string}</p></article>; })}
        </div>
      </section>

      <section className="pt-14">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl bg-ink-950 p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-lemon-300">GuildCloud takes care of</p>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-ink-200">
              <li className="flex gap-3"><span className="text-lemon-300">✓</span><span>Checking that an eligible site can run the request.</span></li>
              <li className="flex gap-3"><span className="text-lemon-300">✓</span><span>Creating the virtual machine on the selected site and reporting its progress.</span></li>
              <li className="flex gap-3"><span className="text-lemon-300">✓</span><span>Giving the instance a private address and connecting approved devices securely.</span></li>
              <li className="flex gap-3"><span className="text-lemon-300">✓</span><span>Keeping project access rules as the source of truth for private reachability.</span></li>
            </ul>
          </div>
          <div className="rounded-3xl border border-ink-100 bg-white p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">You remain in charge of</p>
            <ul className="mt-5 space-y-3 text-sm leading-6 text-ink-600">
              <li className="flex gap-3"><span className="text-ink-400">•</span><span>What you install, publish, and store on your server.</span></li>
              <li className="flex gap-3"><span className="text-ink-400">•</span><span>Operating-system accounts, application passwords, and application-level permissions.</span></li>
              <li className="flex gap-3"><span className="text-ink-400">•</span><span>Who belongs in your project and should be granted access.</span></li>
              <li className="flex gap-3"><span className="text-ink-400">•</span><span>Choosing an appropriate server size and keeping sufficient wallet balance.</span></li>
            </ul>
          </div>
        </div>
      </section>

      <section id="costs" className="scroll-mt-20 pt-14">
        <div className="rounded-3xl border border-lemon-200 bg-lemon-50 p-6 sm:p-8"><div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div className="max-w-2xl"><div className="grid h-10 w-10 place-items-center rounded-xl bg-lemon-400 text-ink-950"><IconWallet className="h-5 w-5" /></div><h2 className="mt-4 text-2xl font-semibold tracking-tight text-ink-900">Your wallet is the control point for spend.</h2><p className="mt-2 text-sm leading-6 text-ink-700">Use the billing page to see your available balance and account activity. A server's selected size makes its resource choice visible before you request it.</p></div><Button href="/console/billing">Open billing <IconArrowRight className="h-4 w-4" /></Button></div></div>
      </section>

      <section id="questions" className="scroll-mt-20 pt-14">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-500">Questions people usually ask</p>
        <div className="mt-4 divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white">
          {[ ["Do I need to understand Proxmox or networking?", "No. Choose the server you need and the people who should reach it. GuildCloud handles the placement and private connection details."], ["Why might a request take a little time?", "A server is built on real equipment. GuildCloud checks capacity, prepares the machine, starts it, and confirms private access before calling it ready."], ["Can GuildCloud choose between sites for me?", "Yes. The placement controller selects an eligible site for the image and size you requested. The provisioning timeline shows where the request is in that process."], ["What should I do if a stage needs attention?", "Open the instance detail page. It keeps the completed steps, identifies the step that needs attention, and shows the reason so you do not have to guess."] ].map(([question, answer]) => <details key={question} className="group px-5 py-4"><summary className="cursor-pointer list-none pr-7 text-sm font-semibold text-ink-800 transition hover:text-lemon-700">{question}<span className="float-right text-lg font-normal text-lemon-600 transition-transform group-open:rotate-45">+</span></summary><p className="mt-3 max-w-3xl text-sm leading-6 text-ink-500">{answer}</p></details>)}
        </div>
        <div className="mt-6 flex flex-wrap gap-3"><Button href="/console/instances/new">Create a Guild Instance <IconArrowRight className="h-4 w-4" /></Button><Link href="/console/networking" className="inline-flex items-center text-sm font-medium text-ink-600 underline decoration-ink-300 underline-offset-4 transition hover:text-ink-950">Review private access</Link></div>
      </section>
    </div>
  );
}
