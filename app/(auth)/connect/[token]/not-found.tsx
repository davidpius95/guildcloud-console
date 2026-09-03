import Link from "next/link";
import { Card } from "@/components/ui";

// Rendered when the page calls notFound() for a token that no longer
// resolves. Split out of page.tsx purely so the response carries a real
// 404 instead of a 200 with an error card in it - a dead link is a
// missing resource, and saying "200 OK" about one misinforms every
// non-human that follows it.
export default function ConnectLinkNotFound() {
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold text-ink-900">Link no longer valid</h1>
      <p className="mt-2 text-sm text-ink-500">
        This connection link is invalid or has expired. Open the VM in the
        console and use its Connect card to generate a new one.
      </p>
      <Link
        href="/console"
        className="mt-4 inline-block text-sm font-medium text-ink-700 underline"
      >
        Go to the console
      </Link>
    </Card>
  );
}
