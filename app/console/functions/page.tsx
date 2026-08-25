import { ComingSoon } from "@/components/coming-soon";

export default function FunctionsPage() {
  return (
    <ComingSoon
      title="Guild Functions"
      description="Event-driven Node.js and Python functions."
      detail="Functions aren't available yet, so there is nothing deployed to list. Long-running services belong on a Guild Instance today."
      bullets={[
        "HTTP, scheduled, storage-event, and PostgreSQL-event triggers are planned.",
        "Node.js and Python are the intended first runtimes.",
      ]}
    />
  );
}
