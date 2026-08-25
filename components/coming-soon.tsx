import Link from "next/link";
import { Card, PageHeader } from "./ui";
import { IconArrowRight } from "./icons";

// A single honest empty state for product surfaces that are designed but not
// built. These pages previously rendered fabricated rows from lib/mock-data
// (fake volumes, fake invoices, fake clusters) with no indication they were
// not the customer's real infrastructure - someone reading their own console
// had no way to tell which numbers were theirs. Nothing here invents data:
// the page says what it will do and what to use instead today.
export function ComingSoon({
  title,
  description,
  detail,
  bullets,
}: {
  title: string;
  description: string;
  detail: string;
  bullets?: string[];
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card>
        <div className="px-6 py-14 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
            Not available yet
          </span>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-ink-500">
            {detail}
          </p>
          {bullets && bullets.length > 0 ? (
            <ul className="mx-auto mt-5 max-w-sm space-y-2 text-left">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2.5 text-xs text-ink-500">
                  <span
                    aria-hidden
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-lemon-500"
                  />
                  <span className="leading-relaxed">{b}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-7">
            <Link
              href="/console/instances"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-lemon-700 dark:text-lemon-400 hover:text-lemon-800 hover:underline"
            >
              Go to Guild Instances
              <IconArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </Card>
    </>
  );
}
