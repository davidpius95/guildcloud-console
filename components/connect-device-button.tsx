"use client";

import { useState, useTransition } from "react";
import { Modal } from "./modal";
import { Button, Note, Spinner } from "./ui";
import { CopyField } from "./copy-field";
import { requestDeviceEnrollment } from "@/app/console/networking/actions";

// Triggers device enrollment directly from wherever it's rendered, with no
// navigation involved. The previous "Enroll device ->" link on the guide
// card sent the user through a full page load of /console/networking
// (several server-side queries: members, projects, grants, instances)
// before an effect there even fired the actual request - two round trips
// stacked in sequence read as slow and janky. This starts the real
// request (requestDeviceEnrollment -> enroll-device Edge Function ->
// Tailscale API) the instant the button is clicked, so the only wait the
// user sees is the one that was ever actually necessary.
export function ConnectDeviceButton({
  children,
  instanceId,
  variant = "ghost",
  size = "sm",
  className,
  unstyled = false,
}: {
  children: React.ReactNode;
  // Enrollment has to start from one VM's Connect card. Other surfaces may
  // render this as education, but they cannot create a tailnet credential.
  instanceId?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  // Renders a bare <button> instead of the shared Button component, for
  // call sites that want this to read as an inline text link (e.g. the
  // remote-access guide's numbered steps) rather than button chrome -
  // the caller supplies the full className in that case.
  unstyled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function start(regenerate = false) {
    setOpen(true);
    setError(null);
    setCommand(null);
    if (!instanceId) {
      setError("Choose the specific Ready VM you want to connect to, then use its Connect card.");
      return;
    }
    startTransition(async () => {
      const result = await requestDeviceEnrollment(instanceId, regenerate);
      if (result.error) setError(result.error);
      else setCommand(result.command);
    });
  }

  function close() {
    setOpen(false);
    setCommand(null);
    setError(null);
  }

  // The command is `curl -fsSL <url> | sh`; the URL is the middle token.
  const linkUrl = command?.split(" ").find((part) => part.startsWith("http")) ?? null;

  return (
    <>
      {unstyled ? (
        <button type="button" className={className} disabled={isPending} onClick={() => start(false)}>
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <Spinner />
              Generating…
            </span>
          ) : (
            children
          )}
        </button>
      ) : (
        <Button variant={variant} size={size} className={className} loading={isPending} onClick={() => start(false)}>
          {isPending ? "Generating…" : children}
        </Button>
      )}

      <Modal
        open={open}
        onClose={close}
        title="Connect this device"
        description={instanceId ? "This command connects your device to this VM only. You can run it on your own devices." : "Choose a Ready VM and use its Connect card to create a VM-only command."}
        footer={
          <Button size="sm" onClick={close}>
            Done
          </Button>
        }
      >
        {command ? (
          <div className="space-y-3">
            <CopyField label="Command" value={command} />
            {/* The same URL, on its own, for anyone who would rather open a
                link than trust a piped shell command sight-unseen. Opening
                it in a browser explains the step and hands back this exact
                command - it never exposes the credential, which is why the
                two are offered side by side rather than as alternatives. */}
            {linkUrl ? (
              <CopyField label="Or open this link in a browser" value={linkUrl} />
            ) : null}
            <Note>
              This link stays valid for 90 days and can be run on your own
              devices. It grants access to this VM only; it does not grant
              access to other GuildCloud or tailnet machines.
            </Note>
            <button
              type="button"
              onClick={() => start(true)}
              disabled={isPending}
              className="text-xs font-medium text-ink-500 underline transition-colors hover:text-ink-700 disabled:cursor-wait"
            >
              Generate a new link and retire this one
            </button>
          </div>
        ) : error ? (
          <Note tone="warning">{error}</Note>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-500">
            <Spinner />
            Generating your connection command…
          </p>
        )}
      </Modal>
    </>
  );
}
