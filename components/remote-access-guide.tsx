"use client";

import { useState } from "react";
import Link from "next/link";
import { IconLock, IconChevron, IconShield, IconArrowRight } from "./icons";
import { Card, CardHeader, Badge, Button } from "./ui";
import { ConnectDeviceButton } from "./connect-device-button";

export function RemoteAccessGuide({
  variant = "card",
  className = "",
}: {
  variant?: "card" | "compact" | "banner";
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(true);

  if (variant === "compact") {
    return (
      <div className={`rounded-lg border border-ink-100 bg-ink-50/50 p-3.5 ${className}`}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-lemon-200 text-xs font-semibold text-lemon-900">
              ?
            </span>
            <span className="text-xs font-medium text-ink-900">
              How do I connect to this server?
            </span>
          </div>
          <IconChevron
            className={`h-3.5 w-3.5 text-ink-500 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="mt-3 space-y-2.5 border-t border-ink-100 pt-2.5 text-xs text-ink-600">
            <div className="flex items-start gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[10px] font-bold text-ink-700">
                1
              </span>
              <div>
                <p className="font-semibold text-ink-900">Install Tailscale</p>
                <p className="text-ink-500">
                  Download the free app from{" "}
                  <a
                    href="https://tailscale.com/download"
                    target="_blank"
                    rel="noreferrer"
                    className="font-medium text-lemon-700 underline hover:text-lemon-800"
                  >
                    tailscale.com
                  </a>{" "}
                  on your Mac, PC, or phone.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[10px] font-bold text-ink-700">
                2
              </span>
              <div>
                <p className="font-semibold text-ink-900">Join your private network</p>
                <p className="text-ink-500">
                  <ConnectDeviceButton
                    unstyled
                    className="font-medium text-lemon-700 underline hover:text-lemon-800 disabled:cursor-wait disabled:opacity-70"
                  >
                    Generate a connection command
                  </ConnectDeviceButton>{" "}
                  and run it on this computer to enroll it.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2">
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[10px] font-bold text-ink-700">
                3
              </span>
              <div>
                <p className="font-semibold text-ink-900">Connect securely</p>
                <p className="text-ink-500">
                  Copy the SSH command above and paste it into your terminal. You're in!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className={className}>
      <CardHeader
        title="How to Connect Remotely (via Tailscale)"
        subtitle="Your servers are 100% private with no exposed internet ports. Follow these 3 simple steps to connect."
        action={
          <Link
            href="/console/networking"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-lemon-700 hover:text-lemon-800 hover:underline"
          >
            Manage enrolled devices
            <IconArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      <div className="grid gap-4 p-5 sm:grid-cols-3">
        {/* Step 1 */}
        <div className="relative flex flex-col justify-between rounded-lg border border-ink-100 bg-ink-50/40 p-4 transition-colors hover:bg-ink-50/80">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white dark:bg-ink-100 dark:text-ink-900">
                1
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
                Setup
              </span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-ink-900">
              Install Tailscale
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              Download the free, zero-config app on your computer or mobile device.
            </p>
          </div>
          <div className="mt-4 pt-2">
            <a
              href="https://tailscale.com/download"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-lemon-700 hover:text-lemon-800 hover:underline"
            >
              Download Tailscale &rarr;
            </a>
          </div>
        </div>

        {/* Step 2 */}
        <div className="relative flex flex-col justify-between rounded-lg border border-ink-100 bg-ink-50/40 p-4 transition-colors hover:bg-ink-50/80">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-lemon-600 text-xs font-bold text-ink-950">
                2
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
                Enrolment
              </span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-ink-900">
              Connect Your Device
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              Generate a connection command and run it on this device. Takes one command, once.
            </p>
          </div>
          <div className="mt-4 pt-2">
            <ConnectDeviceButton
              unstyled
              className="inline-flex items-center gap-1 text-xs font-medium text-lemon-700 hover:text-lemon-800 hover:underline disabled:cursor-wait disabled:opacity-70"
            >
              Generate connection command
            </ConnectDeviceButton>
          </div>
        </div>

        {/* Step 3 */}
        <div className="relative flex flex-col justify-between rounded-lg border border-ink-100 bg-ink-50/40 p-4 transition-colors hover:bg-ink-50/80">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-900 text-xs font-bold text-white dark:bg-ink-100 dark:text-ink-900">
                3
              </span>
              <span className="text-[11px] font-medium uppercase tracking-wider text-ink-500">
                Access
              </span>
            </div>
            <h3 className="mt-3 text-sm font-semibold text-ink-900">
              Connect to Any Instance
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-ink-500">
              Click any instance in your console to copy its private SSH command or private IP.
            </p>
          </div>
          <div className="mt-4 pt-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-500">
              <IconLock className="h-3 w-3 text-lemon-600" />
              Private & Encrypted
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
