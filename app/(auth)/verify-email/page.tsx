import { Card } from "@/components/ui";
import { IconServer } from "@/components/icons";

export default function VerifyEmailPage() {
  return (
    <Card className="p-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-lemon-100">
        <IconServer className="h-5 w-5 text-lemon-700" />
      </div>
      <h1 className="text-lg font-semibold text-ink-900">Check your inbox</h1>
      <p className="mt-1 text-sm text-ink-500">
        We sent a verification link to your email. Click it to continue setting up your
        organization.
      </p>
    </Card>
  );
}
