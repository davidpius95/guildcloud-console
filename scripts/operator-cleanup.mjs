#!/usr/bin/env node
// The supported way for platform staff to clean up a tenant's abandoned
// infrastructure.
//
// Before this existed, the only routes were "ask the customer" or "go around
// RLS with service-role access". The second was used once, on 2026-09-02, to
// remove two abandoned clones belonging to another tenant: the guests were
// destroyed through the Proxmox API and the control-plane rows deleted by hand.
// It worked, but it is a bad habit to acquire -- destroying a guest without
// also removing its row leaves a `failed` instance naming a vmid that Proxmox
// will reissue, and a later delete then resolves node+vmid onto an unrelated
// customer's server. The safe sequence lived only in an operator's head.
//
// This script needs no Proxmox access and has none. It signs in as a platform
// operator and *requests* a delete, which enqueues the same operation a
// customer's own delete enqueues; the site worker then performs the entire
// hardened teardown -- guest destroyed, tailnet device released, rows removed,
// capacity released. Asking, not destroying, is the whole point: there is no
// second path to keep in step with the first.
//
// Usage:
//   List what looks abandoned, across every tenant:
//     node scripts/operator-cleanup.mjs list
//
//   Delete one instance by id (prints what it will do, then asks):
//     node scripts/operator-cleanup.mjs delete <instance-id>
//
//   Skip the prompt (for a non-interactive run you have already reasoned about):
//     node scripts/operator-cleanup.mjs delete <instance-id> --yes
//
// Environment:
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY  (as the app uses)
//   GUILDCLOUD_OPERATOR_EMAIL, GUILDCLOUD_OPERATOR_PASSWORD
//
// The operator signs in as themselves. There is no service-role key here on
// purpose: that key bypasses RLS entirely and would put every table one typo
// away, which is exactly the posture this script exists to retire. Authority
// comes from a row in `platform_operators`, which the app cannot grant itself.

import { createClient } from "@supabase/supabase-js";
import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";

const [, , command, ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith("--")));
const positional = rest.filter((a) => !a.startsWith("--"));

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is not set`);
  return value;
}

async function signIn() {
  const client = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: requireEnv("GUILDCLOUD_OPERATOR_EMAIL"),
    password: requireEnv("GUILDCLOUD_OPERATOR_PASSWORD"),
  });
  if (error) fail(`sign-in failed: ${error.message}`);

  // Checked up front so the failure is "you are not an operator" rather than an
  // empty listing, which reads like "nothing to clean up" and is worse.
  const { data: isOperator, error: opError } = await client.rpc("is_platform_operator");
  if (opError) fail(`could not check operator status: ${opError.message}`);
  if (!isOperator) {
    fail(
      `${process.env.GUILDCLOUD_OPERATOR_EMAIL} is not a platform operator. ` +
        `Add a row to platform_operators out of band; the app cannot grant this.`,
    );
  }
  return client;
}

async function listAbandoned(client) {
  const { data, error } = await client.rpc("operator_list_abandoned_instances");
  if (error) fail(`listing failed: ${error.message}`);
  return data ?? [];
}

function renderTable(rows) {
  if (rows.length === 0) {
    console.log("No abandoned instances. Every instance is ready, provisioning, or already being torn down.");
    return;
  }
  console.log(`${rows.length} abandoned instance(s):\n`);
  for (const row of rows) {
    const guest = row.proxmox_vmid
      ? `${row.cluster_id}/${row.proxmox_node} vmid ${row.proxmox_vmid}`
      : "no guest recorded";
    console.log(`  ${row.instance_id}`);
    console.log(`    ${row.name}  [${row.state}]  ${row.age_days}d old`);
    console.log(`    ${row.organization_name} / ${row.project_name ?? "(no project)"}`);
    console.log(`    ${guest}\n`);
  }
}

async function confirm(question) {
  if (flags.has("--yes")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase() === "y";
}

async function main() {
  if (command === "list") {
    const client = await signIn();
    renderTable(await listAbandoned(client));
    return;
  }

  if (command === "delete") {
    const instanceId = positional[0];
    if (!instanceId) fail("usage: operator-cleanup.mjs delete <instance-id>");

    const client = await signIn();
    // Shown from the operator's own listing rather than echoing the id back, so
    // a mistyped id surfaces as "not in the abandoned list" instead of silently
    // deleting a healthy instance that happens to exist.
    const target = (await listAbandoned(client)).find((row) => row.instance_id === instanceId);
    if (!target) {
      fail(
        `${instanceId} is not in the abandoned list. Run \`list\` first. ` +
          `Instances that are ready or in flight are not eligible.`,
      );
    }

    console.log("About to request deletion of:\n");
    renderTable([target]);
    console.log(
      "The site worker performs the teardown: the guest is destroyed, its tailnet\n" +
        "device released, and its rows removed. This cannot be undone from here.\n" +
        `The action is recorded in ${target.organization_name}'s own audit log.\n`,
    );

    if (!(await confirm(`Delete ${target.name}?`))) {
      console.log("Nothing was requested.");
      return;
    }

    const { data, error } = await client.rpc("request_instance_delete", {
      p_instance_id: instanceId,
      p_idempotency_key: `operator-cleanup-${randomUUID()}`,
    });
    if (error) fail(`delete request rejected: ${error.message}`);

    console.log(`\nQueued. operation ${data}`);
    console.log("The worker picks this up on its next cycle; watch the instance in the console,");
    console.log("or re-run `list` until it disappears.");
    return;
  }

  console.error("usage: operator-cleanup.mjs list");
  console.error("       operator-cleanup.mjs delete <instance-id> [--yes]");
  process.exit(1);
}

await main();
