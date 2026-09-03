import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { enrollmentCommand, enrollmentScript } from "@/lib/enrollment-scripts";

const KEY = "tskey-auth-TESTONLY-not-a-real-key";

// Both scripts explain their own traps in comments sitting right next to
// the code that avoids them, so a naive `toContain` matches the prose and
// passes for the wrong reason. Twice now. Assert against code only.
function codeOnly(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

// These scripts run on machines this repo is never built on. The macOS
// branch exists because of a real production failure - install.sh only
// opens the App Store page on a Mac and exits 0, so the old script marched
// on to `tailscale up`, hit command-not-found, and died having connected
// nothing - and the Windows script has never executed on Windows at all.
// So the properties that made those fail are asserted here rather than
// trusted.
describe("POSIX enrollment script", () => {
  const script = enrollmentScript("linux", KEY);

  it("is valid POSIX shell", () => {
    // `sh -n` parses without executing. Catches the unbalanced if/fi and
    // broken line-continuation mistakes that are easy to make when the
    // script is authored inside a template literal.
    expect(() =>
      execFileSync("sh", ["-n"], { input: script, stdio: ["pipe", "ignore", "pipe"] }),
    ).not.toThrow();
  });

  it("never reaches install.sh on macOS", () => {
    // The bug: on Darwin, install.sh is a no-op that reports success. The
    // Darwin branch must exit before the install line is reached.
    const code = codeOnly(script);
    const darwinBranch = code.slice(code.indexOf('"$(uname -s)" = "Darwin"'));
    const exitIndex = darwinBranch.indexOf("exit 1");
    const installIndex = darwinBranch.indexOf("install.sh");
    expect(exitIndex).toBeGreaterThan(-1);
    expect(installIndex).toBeGreaterThan(exitIndex);
  });

  it("finds the CLI outside PATH, where the macOS clients put it", () => {
    expect(script).toContain("/Applications/Tailscale.app/Contents/MacOS/Tailscale");
    expect(script).toContain("/usr/local/bin/tailscale");
  });

  it("elevates on Linux but not on macOS", () => {
    // The macOS client runs in the user's own session; sudo there talks to
    // the wrong daemon.
    expect(script).toMatch(/^\s*"\$CLI" up /m);
    expect(script).toMatch(/^\s*sudo "\$CLI" up /m);
  });

  it("carries the key", () => {
    expect(script).toContain(KEY);
  });

  it("is byte-identical for macos and linux", () => {
    // One script serves both; the branching is runtime, on uname.
    expect(enrollmentScript("macos", KEY)).toBe(enrollmentScript("linux", KEY));
  });
});

describe("Windows enrollment script", () => {
  const script = enrollmentScript("windows", KEY);

  it("refuses to run without Administrator", () => {
    expect(script).toContain("WindowsBuiltInRole]::Administrator");
    expect(script).toMatch(/if \(-not \$isAdmin\)/);
  });

  it("downloads a per-architecture MSI from the verified stable alias", () => {
    expect(script).toContain(
      "https://pkgs.tailscale.com/stable/tailscale-setup-latest-$arch.msi",
    );
    for (const arch of ["arm64", "amd64", "x86"]) {
      expect(script).toContain(`'${arch}'`);
    }
  });

  it("installs silently and waits for the installer to finish", () => {
    // Without -Wait the script would race ahead to `tailscale up` before
    // the binary exists - the same shape as the macOS bug.
    expect(script).toContain("/quiet");
    expect(script).toContain("-Wait");
  });

  it("re-resolves the binary after installing, before connecting", () => {
    // The install is silent and the exe location varies (ProgramW6432 vs
    // ProgramFiles on a 32-bit host process), so the path found before the
    // install is not necessarily the one that exists after it.
    const connectIndex = script.indexOf("up --reset");
    const lastResolve = script.lastIndexOf("Find-TailscaleExe");
    expect(lastResolve).toBeGreaterThan(-1);
    expect(lastResolve).toBeLessThan(connectIndex);
  });

  it("probes every Program Files root rather than trusting one", () => {
    expect(script).toContain("$env:ProgramW6432");
    expect(script).toContain("${env:ProgramFiles(x86)}");
    expect(script).toContain("Get-Command tailscale.exe");
  });

  it("never calls Test-Path on a value that can be null", () => {
    // Find-TailscaleExe returns $null when the client is absent, and
    // Test-Path $null throws. Under ErrorActionPreference Stop that aborts
    // on precisely the machines the install branch exists for.
    expect(codeOnly(script)).not.toContain("Test-Path $exe");
    expect(codeOnly(script)).toContain("if (-not $exe)");
  });

  it("carries no #Requires line, which iex would silently ignore", () => {
    expect(script).not.toContain("#Requires");
  });

  it("carries the key", () => {
    expect(script).toContain(KEY);
  });

  it("is not the POSIX script", () => {
    expect(script).not.toContain("#!/bin/sh");
  });
});

describe("enrollmentCommand", () => {
  const base = "https://cloud.guild-technologies.com";
  const token = "tok123";

  it("gives a shell pipeline for macOS and Linux", () => {
    expect(enrollmentCommand("linux", base, token)).toBe(
      `curl -fsSL ${base}/api/enroll/${token} | sh`,
    );
    expect(enrollmentCommand("macos", base, token)).toBe(
      enrollmentCommand("linux", base, token),
    );
  });

  it("points Windows at the PowerShell route", () => {
    expect(enrollmentCommand("windows", base, token)).toBe(
      `irm ${base}/api/enroll/${token}/windows | iex`,
    );
  });
});
