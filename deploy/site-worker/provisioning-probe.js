// Alerts when this site can no longer create instances, before a customer
// finds out by trying.
//
// Why this exists: the snippet store filled up and took provisioning offline on
// 2026-08-29, and again on 2026-09-03. Neither raised anything. Uptime Kuma was
// already watching all 11 nodes plus every PVE UI, and not one of those monitors
// could have fired: the hosts were up, the web UIs answered, and the platform
// was completely unable to sell a server. Liveness is not readiness.
//
// So this probe asserts the thing that actually broke, in the place it broke:
// the directory the worker writes cloud-init snippets to, reached the same way
// the worker reaches it (same SNIPPETS_DIR, same NFS mount, same container).
// A check that reads a dashboard number instead would have missed the ESTALE
// fault entirely -- the control plane's capacity figures looked fine while
// every write returned "stale file handle".
//
// Reported to Kuma as a push monitor, which means silence is also a failure:
// if this probe stops running, or the worker LXC dies, the monitor goes down on
// its own without anything needing to notice.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Mirrors public.can_provision_instance. These are not independent judgement
// calls -- they are the admission gate's own numbers, so "the probe is red" and
// "customers are being refused" cannot drift apart. If the gate changes, these
// change with it.
export const ADMISSION_FLOOR_BYTES = 1073741824; // >= 1 GiB free
export const ADMISSION_MIN_FREE_RATIO = 0.05; // >= 5% free

// Headroom above the gate, so the page happens while creates still work. Two
// hours of warning is worth more than a precise post-mortem.
export const DEFAULT_WARN_BYTES = 2147483648; // 2 GiB

// Pure so it is testable without a filesystem: index.js's own history is the
// argument for that (see health-failures.js).
//
// `writeError` is passed in rather than inferred from free space because the
// two 2026-09 outages had different causes -- one was ENOSPC, the other ESTALE
// on a store with plenty of room. Space alone would have caught only one.
export function evaluateSnippetStore({
  writeError = null,
  freeBytes = 0,
  totalBytes = 0,
  warnBytes = DEFAULT_WARN_BYTES,
} = {}) {
  if (writeError) {
    return {
      ok: false,
      severity: "critical",
      reason: `cannot write to the snippet store: ${writeError}. Every instance create fails at template_cloud_init until this is fixed.`,
    };
  }

  if (!(totalBytes > 0)) {
    return {
      ok: false,
      severity: "critical",
      reason: "the snippet store reports no capacity at all, so admission cannot evaluate it.",
    };
  }

  const freeRatio = freeBytes / totalBytes;
  const gib = (n) => (n / 1073741824).toFixed(2);

  // Critical: admission is already refusing every create at this site.
  if (freeBytes < ADMISSION_FLOOR_BYTES) {
    return {
      ok: false,
      severity: "critical",
      reason: `snippet store has ${gib(freeBytes)} GiB free, below the ${gib(ADMISSION_FLOOR_BYTES)} GiB admission floor. Creates are being refused at this site right now.`,
    };
  }
  if (freeRatio < ADMISSION_MIN_FREE_RATIO) {
    return {
      ok: false,
      severity: "critical",
      reason: `snippet store is ${(100 - freeRatio * 100).toFixed(1)}% full, past the ${ADMISSION_MIN_FREE_RATIO * 100}% free floor. Creates are being refused at this site right now.`,
    };
  }

  // Warning: still serving, but close enough that someone should look.
  if (freeBytes < warnBytes) {
    return {
      ok: false,
      severity: "warning",
      reason: `snippet store has ${gib(freeBytes)} GiB free, approaching the ${gib(ADMISSION_FLOOR_BYTES)} GiB floor below which creates are refused.`,
    };
  }

  return {
    ok: true,
    severity: "ok",
    reason: `snippet store writable, ${gib(freeBytes)} GiB free (${(freeRatio * 100).toFixed(1)}%).`,
  };
}

// Actually writes, rather than only stat-ing. A directory can report free space
// and still reject every write -- permissions (the workers are unprivileged
// LXCs, so their uid 0 is 100000 on the wire and gets no no_root_squash
// exemption) or a stale NFS handle. Both have happened here.
export function probeSnippetStore(dir, { warnBytes } = {}) {
  const probeFile = path.join(dir, `.guildcloud-probe-${process.pid}`);
  let writeError = null;
  try {
    const fd = fs.openSync(probeFile, "w");
    try {
      fs.writeSync(fd, "probe\n");
      fs.fsyncSync(fd); // NFS defers ENOSPC to flush; without this a full store looks writable.
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    writeError = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      fs.unlinkSync(probeFile);
    } catch {
      // Best effort. A leftover probe file is harmless; failing to remove one
      // must never turn a healthy store red.
    }
  }

  let freeBytes = 0;
  let totalBytes = 0;
  try {
    const stat = fs.statfsSync(dir);
    // bavail, not bfree: bfree counts blocks reserved for root that the worker
    // cannot actually use.
    freeBytes = stat.bavail * stat.bsize;
    totalBytes = stat.blocks * stat.bsize;
  } catch (e) {
    if (!writeError) writeError = e instanceof Error ? e.message : String(e);
  }

  return evaluateSnippetStore({ writeError, freeBytes, totalBytes, warnBytes });
}

async function main() {
  const dir = process.env.SNIPPETS_DIR;
  const pushUrl = process.env.KUMA_PUSH_URL;
  const cluster = process.env.WORKER_CLUSTER_ID ?? "unknown";
  const warnBytes = process.env.PROBE_WARN_BYTES ? Number(process.env.PROBE_WARN_BYTES) : undefined;

  if (!dir || !pushUrl) {
    console.log(JSON.stringify({ ok: false, where: "provisioning-probe", error: "SNIPPETS_DIR and KUMA_PUSH_URL are both required" }));
    process.exit(2);
  }

  const result = probeSnippetStore(dir, { warnBytes });
  const message = `${cluster}: ${result.reason}`;
  console.log(JSON.stringify({ ok: result.ok, severity: result.severity, cluster, message }));

  const url = `${pushUrl}${pushUrl.includes("?") ? "&" : "?"}status=${result.ok ? "up" : "down"}&msg=${encodeURIComponent(message)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`push returned ${response.status}`);
  } catch (e) {
    // Deliberately a non-zero exit and nothing else. If Kuma is unreachable the
    // push never lands, and the monitor going stale is what raises the alarm --
    // this probe must not try to be its own alerting channel.
    console.log(JSON.stringify({ ok: false, where: "kuma_push", error: String(e) }));
    process.exit(1);
  }
}

// Only when run directly, so the pure exports stay importable from tests.
//
// Compared through realpath, not as strings. The unit invokes this via
// /opt/guildcloud-worker/current/..., which is the symlink deploy-pull.sh
// swaps; Node resolves import.meta.url to the release directory behind it, so
// a naive `import.meta.url === file://${process.argv[1]}` is never equal and
// main() silently never runs -- the probe then "succeeds" every minute while
// reporting nothing, which is worse than no monitor at all.
function isRunDirectly() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isRunDirectly()) {
  await main();
}
