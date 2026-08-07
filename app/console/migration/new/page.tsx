import Link from "next/link";
import { MigrationWizard } from "@/components/migration-wizard";
import { PageHeader } from "@/components/ui";

export default function NewMigrationPage() {
  return (
    <>
      <nav className="mb-4 text-xs text-ink-400">
        <Link href="/console/migration" className="hover:text-ink-700 hover:underline">
          Migration
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-600">New</span>
      </nav>

      <PageHeader
        title="Start a migration"
        description="Discover what's running on your current provider, map each workload to a GuildCloud plan, then migrate."
      />

      <MigrationWizard />
    </>
  );
}
