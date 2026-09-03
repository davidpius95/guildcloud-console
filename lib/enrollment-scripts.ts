// The scripts an enrollment link hands to a device, and the commands the
// console tells people to run. Both live here so the page and the routes
// can never drift into advertising a command that isn't the one served.
//
// "Tailscale" appears in this file because it is what actually gets
// installed. The master plan's constraint is that the word never surfaces
// in the console UI; a script the customer explicitly chose to run, and
// the vendor's own installer URL, are not the UI.
//
// Deliberately not `server-only`: these are pure string builders that take
// the key as an argument and hold no secrets, and keeping them importable
// is what lets the scripts be unit-tested. The Windows and macOS paths
// cannot be exercised on the machine that wrote them, so a test asserting
// their shape - and running the POSIX one through `sh -n` - is the only
// standing check they have.

export type Platform = "macos" | "linux" | "windows";

/**
 * POSIX shell, for macOS and Linux.
 *
 * The macOS branch exists because the previous one-size script silently
 * failed there. `tailscale.com/install.sh` does not install anything on a
 * Mac - its `appstore` case runs `open <App Store URL>` and exits 0. The
 * old script took that success at face value, went straight on to
 * `sudo tailscale up`, hit "command not found", and died on `set -e`
 * having connected nothing. A Mac with no client got a broken link.
 *
 * The second Mac-only trap is PATH: the App Store build ships its CLI
 * inside the bundle (`/Applications/Tailscale.app/Contents/MacOS/Tailscale`)
 * and the standalone build only adds `/usr/local/bin/tailscale` if the user
 * opts into CLI integration, so `command -v tailscale` finds nothing even
 * when the client is installed and running. Hence resolving a CLI by
 * probing the documented locations rather than trusting PATH.
 *
 * `sudo` is Linux-only on purpose: there the daemon is a system service,
 * while on macOS the client runs in the user's own session and elevating
 * talks to the wrong daemon.
 */
function posixScript(key: string): string {
  return `#!/bin/sh
set -e

# The CLI is not always on PATH, notably on macOS - probe the documented
# install locations before giving up.
find_cli() {
  if command -v tailscale >/dev/null 2>&1; then
    command -v tailscale
    return 0
  fi
  for candidate in \\
    /usr/local/bin/tailscale \\
    /Applications/Tailscale.app/Contents/MacOS/Tailscale
  do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

CLI="$(find_cli || true)"

if [ -z "$CLI" ]; then
  if [ "$(uname -s)" = "Darwin" ]; then
    # Do not call install.sh here: on macOS it only opens the App Store
    # page and exits successfully, which would leave this script pretending
    # to have installed something.
    echo "The private-network client isn't installed on this Mac yet."
    echo
    echo "Install it, then run this same command again:"
    echo "  https://apps.apple.com/us/app/tailscale/id1475387142"
    echo
    echo "Using Homebrew instead?  brew install --cask tailscale"
    exit 1
  fi

  echo "Installing the private-network client..."
  curl -fsSL https://tailscale.com/install.sh | sh
  CLI="$(find_cli || true)"

  if [ -z "$CLI" ]; then
    echo "The client installed but still isn't on PATH - open a new terminal and run this command again."
    exit 1
  fi
fi

echo "Connecting this device..."
if [ "$(uname -s)" = "Darwin" ]; then
  # No sudo: the macOS client runs in the user's own session.
  "$CLI" up --reset --force-reauth --authkey ${key} --accept-dns=true
else
  sudo "$CLI" up --reset --force-reauth --authkey ${key} --accept-dns=true
fi
echo "Connected."
`;
}

/**
 * PowerShell, for Windows.
 *
 * Served from its own URL rather than sniffed from a header: `irm` sends
 * the same wildcard Accept header as `curl`, so there is nothing to
 * negotiate on, and a wrong guess would hand a Windows box a POSIX script.
 * (Spelling that header literally here would close this comment early -
 * the same trap the CSS in globals.css carries a warning about.)
 *
 * The MSI is fetched from the per-architecture `latest` alias on
 * pkgs.tailscale.com, verified to resolve to a real signed installer
 * (`application/x-msi`, ~38MB) rather than being assumed.
 */
function windowsScript(key: string): string {
  // No #Requires line: it is honoured for script files only, and this is
  // run through `iex` as a string, so it would assert nothing while
  // looking like a guarantee.
  return `$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "This needs an Administrator PowerShell window."
  Write-Host "Right-click PowerShell, choose 'Run as administrator', then paste the command again."
  exit 1
}

# Same lesson as macOS: probe for the binary instead of trusting one
# location. A 32-bit PowerShell on 64-bit Windows resolves
# $env:ProgramFiles to the x86 tree, where Tailscale is not installed.
function Find-TailscaleExe {
  $onPath = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  foreach ($root in @($env:ProgramW6432, $env:ProgramFiles, \${env:ProgramFiles(x86)})) {
    if ($root) {
      $candidate = Join-Path $root 'Tailscale\\tailscale.exe'
      if (Test-Path $candidate) { return $candidate }
    }
  }
  return $null
}

$exe = Find-TailscaleExe

# -not $exe, not Test-Path $exe: Find-TailscaleExe returns $null when the
# client is absent, and Test-Path $null throws - which, under
# ErrorActionPreference Stop, would abort on exactly the machines this
# branch exists to serve.
if (-not $exe) {
  Write-Host "Installing the private-network client..."
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' }
          elseif ([Environment]::Is64BitOperatingSystem) { 'amd64' }
          else { 'x86' }
  $msi = Join-Path $env:TEMP "tailscale-setup-$arch.msi"
  Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-$arch.msi" -OutFile $msi -UseBasicParsing
  Start-Process msiexec.exe -ArgumentList '/i', ('"' + $msi + '"'), '/quiet', '/norestart' -Wait
  Remove-Item $msi -Force -ErrorAction SilentlyContinue
}

$exe = Find-TailscaleExe
if (-not $exe) {
  Write-Host "The client installed but tailscale.exe could not be found afterwards."
  exit 1
}

Write-Host "Connecting this device..."
& $exe up --reset --force-reauth --authkey ${key} --accept-dns=true
Write-Host "Connected."
`;
}

export function enrollmentScript(platform: Platform, key: string): string {
  return platform === "windows" ? windowsScript(key) : posixScript(key);
}

/** What the console tells someone to paste, per platform. */
export function enrollmentCommand(platform: Platform, baseUrl: string, token: string): string {
  const url = `${baseUrl}/api/enroll/${token}`;
  return platform === "windows"
    ? `irm ${url}/windows | iex`
    : `curl -fsSL ${url} | sh`;
}
