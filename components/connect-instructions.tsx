"use client";

import { useState } from "react";
import { cx, Note } from "./ui";
import { CopyField } from "./copy-field";

export type Platform = "macos" | "linux" | "windows";

const PLATFORM_LABEL: Record<Platform, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
};

// Where to run it, per platform. The macOS line names the client install
// explicitly because that is the step the old one-line script silently
// skipped - install.sh only opens the App Store page on a Mac, so a
// customer with no client got a command that could never work.
const PLATFORM_STEPS: Record<Platform, string> = {
  macos:
    "Open Terminal and paste this. If the client isn't installed yet the command says so and links you to it - install it, then run the command again.",
  linux:
    "Open a terminal and paste this. It installs the private-network client if it isn't already there, then authenticates this device.",
  windows:
    "Open PowerShell as Administrator (right-click it, 'Run as administrator') and paste this. It installs the private-network client if it isn't already there, then authenticates this device.",
};

/**
 * The commands the enrollment page hands over, defaulting to the platform
 * detected from the request but switchable - a link gets opened on a phone,
 * or forwarded to the person who actually owns the machine, far more often
 * than a detected-and-locked UI would allow for.
 */
export function ConnectInstructions({
  detected,
  commands,
}: {
  detected: Platform;
  commands: Record<Platform, string>;
}) {
  const [platform, setPlatform] = useState<Platform>(detected);
  const order: Platform[] = ["macos", "linux", "windows"];

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Choose the device you're connecting"
        className="flex gap-1 rounded-lg bg-ink-50 p-1"
      >
        {order.map((p) => (
          <button
            key={p}
            role="tab"
            type="button"
            aria-selected={platform === p}
            onClick={() => setPlatform(p)}
            className={cx(
              "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
              platform === p
                ? "bg-white text-ink-900 shadow-[0_1px_2px_rgba(23,29,54,0.06)]"
                : "text-ink-500 hover:text-ink-700",
            )}
          >
            {PLATFORM_LABEL[p]}
          </button>
        ))}
      </div>

      <p className="text-sm text-ink-700">{PLATFORM_STEPS[platform]}</p>

      <CopyField label="Command" value={commands[platform]} />

      {platform === "macos" ? (
        <Note>
          The client has to be installed from the App Store before the command
          can connect anything - macOS doesn&rsquo;t allow a terminal command to
          install it for you.
        </Note>
      ) : null}
    </div>
  );
}
