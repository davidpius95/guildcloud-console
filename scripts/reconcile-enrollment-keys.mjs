#!/usr/bin/env node
// Recovers the Tailscale auth key id behind every enrollment link that was
// minted before the control plane started recording it.
//
// Why this exists: enroll-device created auth keys and never deleted one.
// "Generate a new link and retire this one" replaced the token and left
// the old key valid for its full 90 days, and removing a member left their
// reusable key live. 20260903074930 added `tailscale_key_id` and the
// revocation that uses it -- but only for keys minted from then on. Every
// older link still had no id, and the Tailscale API cannot look a key up
// by its secret, so those were revocable only by hand.
//
// They are recoverable after all: the id is the third field of the key
// itself (`tskey-auth-<id>-<secret>`), and the secret is already in Vault.
// The parsing happens inside Postgres, in
// operator_backfill_enrollment_key_ids -- deliberately not here. Doing it
// client-side would mean reading live tailnet credentials out over the
// wire, into a terminal and a shell history, to learn sixteen characters
// sitting next to them. That is the accident this whole line of work began
// with. This script only ever sees ids, which are not credentials.
//
// Usage:
//   Show what would be recovered, changing nothing:
//     node scripts/reconcile-enrollment-keys.mjs
//
//   Write the recovered ids:
//     node scripts/reconcile-enrollment-keys.mjs --apply
//
//   Skip the confirmation prompt:
//     node scripts/reconcile-enrollment-keys.mjs --apply --yes
//
// Environment:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY  (as the app uses)
//   GUILDCLOUD_OPERATOR_EMAIL, GUILDCLOUD_OPERATOR_PASSWORD
//
// The operator signs in as themselves, exactly as operator-cleanup.mjs
// does. There is no service-role key here on purpose. Authority comes from
// a row in platform_operators, which the app cannot grant itself.
//
// What this does NOT do: revoke anything. It restores the ability to
// revoke. Recording an id is reversible and inert; deleting a key is
// neither, and a bulk revoke of every historical link would cut off every
// device still relying on one. Once ids are recorded, the console's own
// "generate a new link" retires the old key as it always claimed to.

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";

const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const APPLY = flags.has("--apply");
const ASSUME_YES = flags.has("--yes");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value;
}

// Statuses the RPC can report. Anything the backfill cannot fix is called
// out rather than folded into a total, because "12 recovered" reads as
// done when three of them still need a human in the Tailscale console.
const NEEDS_HAND = new Set([
  "no secret in vault - revoke by hand",
  "key did not parse - revoke by hand",
]);

async function main() {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: requireEnv("GUILDCLOUD_OPERATOR_EMAIL"),
    password: requireEnv("GUILDCLOUD_OPERATOR_PASSWORD"),
  });
  if (signInError) fail(`could not sign in: ${signInError.message}`);

  // Always run the dry pass first, even with --apply: the operator should
  // see the same list they are about to authorise, not a summary written
  // after the fact.
  const { data: preview, error: previewError } = await supabase.rpc(
    "operator_backfill_enrollment_key_ids",
    { p_apply: false },
  );
  if (previewError) fail(previewError.message);

  if (!preview || preview.length === 0) {
    console.log("No enrollment links exist.");
    return;
  }

  const width = Math.max(...preview.map((r) => (r.instance_name ?? "").length), 8);
  console.log("");
  for (const row of preview) {
    console.log(
      `  ${(row.instance_name ?? "?").padEnd(width)}  ${(row.key_id ?? "-").padEnd(18)}  ${row.member_email ?? "-"}  ${row.status}`,
    );
  }

  const recoverable = preview.filter((r) => r.status === "would recover");
  const already = preview.filter((r) => r.status === "already recorded");
  const manual = preview.filter((r) => NEEDS_HAND.has(r.status));

  console.log("");
  console.log(`  ${preview.length} link(s): ${recoverable.length} recoverable, ${already.length} already recorded, ${manual.length} needing a human`);

  if (manual.length > 0) {
    console.log("");
    console.log("  These cannot be recovered from Vault. Their keys have to be");
    console.log("  deleted in the Tailscale admin console, or left to expire:");
    for (const row of manual) {
      console.log(`    - ${row.instance_name} (${row.member_email}): ${row.status}`);
    }
  }

  if (!APPLY) {
    console.log("");
    console.log("  Dry run. Re-run with --apply to write the recovered ids.");
    return;
  }

  if (recoverable.length === 0) {
    console.log("");
    console.log("  Nothing to write.");
    return;
  }

  if (!ASSUME_YES) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\n  Record ${recoverable.length} key id(s)? [y/N] `);
    rl.close();
    if (answer.trim().toLowerCase() !== "y") {
      console.log("  Aborted.");
      return;
    }
  }

  const { data: applied, error: applyError } = await supabase.rpc(
    "operator_backfill_enrollment_key_ids",
    { p_apply: true },
  );
  if (applyError) fail(applyError.message);

  const written = (applied ?? []).filter((r) => r.status === "recovered");
  console.log(`\n  Recorded ${written.length} key id(s).`);
  console.log("  Nothing was revoked. Replacing a link now retires its key,");
  console.log("  which is what these ids were missing for.");
}

main().catch((e) => fail(String(e)));
