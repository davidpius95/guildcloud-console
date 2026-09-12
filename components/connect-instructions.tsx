"use client";

import { useId, useRef, useState } from "react";
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
    "Open Terminal and paste this. If the client isn’t installed yet, the command says so and links you to it — install it, then run the command again.",
  linux:
    "Open a terminal and paste this. It installs the private-network client if it isn’t already there, then authenticates this device.",
  windows:
    "Open PowerShell as Administrator (right-click it and choose “Run as administrator”), then paste this. It installs the private-network client if it isn’t already there, then authenticates this device.",
};

const ORDER: Platform[] = ["macos", "linux", "windows"];

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
  const baseId = useId();
  const tabId = (p: Platform) => `${baseId}-tab-${p}`;
  const panelId = `${baseId}-panel`;
  const tabRefs = useRef<Partial<Record<Platform, HTMLButtonElement | null>>>({});

  // role="tab" promises arrow-key navigation, and a tablist that only
  // responded to clicks left keyboard users stranded on the first tab with
  // no way to reach the command for their own machine.
  function onKeyDown(e: React.KeyboardEvent) {
    const current = ORDER.indexOf(platform);
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % ORDER.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + ORDER.length) % ORDER.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ORDER.length - 1;
    else return;
    e.preventDefault();
    setPlatform(ORDER[next]);
    tabRefs.current[ORDER[next]]?.focus();
  }

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Choose the device you’re connecting"
        onKeyDown={onKeyDown}
        className="flex gap-1 rounded-lg bg-ink-50 p-1"
      >
        {ORDER.map((p) => (
          <button
            key={p}
            ref={(el) => {
              tabRefs.current[p] = el;
            }}
            id={tabId(p)}
            role="tab"
            type="button"
            aria-selected={platform === p}
            aria-controls={panelId}
            // Roving tabindex: one stop for the whole group, so Tab moves
            // past the switcher to the command rather than through it.
            tabIndex={platform === p ? 0 : -1}
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

      {/* A labelled tabpanel, so the tabs actually point at something: with
          no element referenced by aria-controls, a screen reader announced
          "tab" and then had nothing to move into. */}
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(platform)}
        tabIndex={0}
        className="space-y-3 focus-visible:outline-none"
      >
        <p className="text-sm text-ink-700">{PLATFORM_STEPS[platform]}</p>

        <CopyField
          label="Command"
          value={commands[platform]}
          copyLabel={`Copy the ${PLATFORM_LABEL[platform]} command`}
        />

        {platform === "macos" ? (
          <Note>
            The client has to be installed from the App Store before the command
            can connect anything — macOS doesn’t allow a terminal command to
            install it for you.
          </Note>
        ) : null}
      </div>
    </div>
  );
}
