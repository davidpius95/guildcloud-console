import Link from "next/link";
import type { ResourceState } from "@/lib/types";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "rounded-xl border border-ink-100 bg-white shadow-[0_1px_2px_rgba(23,29,54,0.04)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(23,29,54,0.08)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-ink-400">{subtitle}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-ink-400">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

const stateStyles: Record<ResourceState, string> = {
  ready: "bg-lemon-100 text-lemon-800 ring-lemon-300",
  provisioning: "bg-sky-50 text-sky-700 ring-sky-200",
  degraded: "bg-amber-50 text-amber-700 ring-amber-200",
  stopped: "bg-ink-100 text-ink-500 ring-ink-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  deleting: "bg-ink-100 text-ink-500 ring-ink-200",
};

const stateLabels: Record<ResourceState, string> = {
  ready: "Ready",
  provisioning: "Provisioning",
  degraded: "Degraded",
  stopped: "Stopped",
  failed: "Failed",
  deleting: "Deleting",
};

export function StatePill({ state }: { state: ResourceState }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        stateStyles[state],
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          state === "ready" && "bg-lemon-500",
          state === "provisioning" && "animate-pulse bg-sky-500",
          state === "degraded" && "bg-amber-500",
          state === "failed" && "bg-rose-500",
          (state === "stopped" || state === "deleting") && "bg-ink-300",
        )}
      />
      {stateLabels[state]}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "lemon" | "amber" | "rose" | "sky";
}) {
  const tones = {
    neutral: "bg-ink-50 text-ink-500 ring-ink-200",
    lemon: "bg-lemon-50 text-lemon-800 ring-lemon-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    rose: "bg-rose-50 text-rose-700 ring-rose-200",
    sky: "bg-sky-50 text-sky-700 ring-sky-200",
  };
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Meter({
  value,
  label,
  caption,
  tone = "auto",
}: {
  value: number;
  label?: string;
  caption?: string;
  tone?: "auto" | "lemon" | "ink";
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    tone === "ink"
      ? "bg-ink-400"
      : tone === "lemon"
        ? "bg-lemon-500"
        : pct >= 85
          ? "bg-rose-500"
          : pct >= 70
            ? "bg-amber-500"
            : "bg-lemon-500";
  return (
    <div>
      {label || caption ? (
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-ink-500">{label}</span>
          <span className="font-medium text-ink-700 tabular-nums">
            {caption}
          </span>
        </div>
      ) : null}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div
          className={cx("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "lemon" | "rose";
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p
        className={cx(
          "mt-1 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "lemon"
            ? "text-lemon-700"
            : tone === "rose"
              ? "text-rose-600"
              : "text-ink-900",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function Table({
  children,
  minWidth = "46rem",
}: {
  children: React.ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-sm"
        style={{ minWidth }}
      >
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cx(
        "border-b border-ink-100 bg-ink-50/60 px-4 py-2.5 text-left text-xs font-semibold text-ink-500",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td
      className={cx(
        "border-b border-ink-100 px-4 py-3 align-middle text-ink-700",
        className,
      )}
    >
      {children}
    </td>
  );
}

export function Button({
  children,
  href,
  variant = "primary",
  size = "md",
  type = "button",
  className,
  onClick,
  disabled,
  form,
}: {
  children: React.ReactNode;
  href?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  type?: "button" | "submit";
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  // Associates this button with a <form> elsewhere in the DOM by id -
  // needed when a form's submit control lives outside the <form> tag
  // itself, e.g. a Modal's separate footer slot.
  form?: string;
}) {
  const variants = {
    primary:
      "bg-lemon-400 text-[#171d36] hover:bg-lemon-300 ring-1 ring-inset ring-lemon-500/40 font-semibold",
    secondary:
      "bg-white text-ink-700 hover:bg-ink-50 ring-1 ring-inset ring-ink-200",
    ghost: "text-ink-500 hover:bg-ink-100 hover:text-ink-800",
    danger: "bg-white text-rose-600 hover:bg-rose-50 ring-1 ring-inset ring-rose-200",
  };
  const sizes = {
    sm: "px-2.5 py-1.5 text-xs",
    md: "px-3.5 py-2 text-sm",
  };
  const classes = cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg transition-all duration-200 active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lemon-600",
    variants[variant],
    sizes[size],
    disabled && "cursor-not-allowed opacity-60",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} form={form} className={classes} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-ink-50 px-1.5 py-0.5 font-mono text-[0.8em] text-ink-700 ring-1 ring-inset ring-ink-100">
      {children}
    </code>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-200 bg-white/70 px-6 py-14 text-center shadow-[0_1px_2px_rgba(23,29,54,0.03)]">
      <h3 className="text-sm font-semibold text-ink-800">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-400">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Note({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warning";
}) {
  return (
    <div
      className={cx(
        "rounded-lg px-4 py-3 text-sm ring-1 ring-inset",
        tone === "warning"
          ? "bg-amber-50 text-amber-900 ring-amber-200"
          : "bg-ink-50 text-ink-600 ring-ink-100",
      )}
    >
      {children}
    </div>
  );
}
