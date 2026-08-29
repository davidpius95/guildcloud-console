import assert from "node:assert/strict";
import test from "node:test";

import { loadWorkerConfig } from "./config.js";

function env(overrides = {}) {
  return {
    WORKER_CLUSTER_ID: "guild-a",
    WORKER_SITE_ID: "lag-1",
    WORKER_ID: "guild-a-lxc-500",
    PVE_HOST: "192.168.8.195",
    PVE_PORT: "8006",
    PVE_TOKEN_SECRET_NAME: "proxmox_guild_a_site_worker_token",
    PVE_POOL_ID: "guildcloud-guild-a",
    BACKUP_JOB_ID: "guild-a-standard-daily",
    BACKUP_STORAGE: "guild-pbs",
    SNIPPETS_DIR: "/mnt/guild-snippets",
    SNIPPETS_STORAGE_ID: "guild-snippets",
    TAILSCALE_TAILNET: "tail345216.ts.net",
    TAILSCALE_TAG_OWNER: "owner@example.com",
    TAILSCALE_POOL_TAG: "tag:guildcloud-pool",
    ...overrides,
  };
}

const REQUIRED = [
  "WORKER_CLUSTER_ID",
  "WORKER_SITE_ID",
  "WORKER_ID",
  "PVE_HOST",
  "PVE_PORT",
  "PVE_TOKEN_SECRET_NAME",
  "PVE_POOL_ID",
  "BACKUP_JOB_ID",
  "BACKUP_STORAGE",
  "SNIPPETS_DIR",
  "SNIPPETS_STORAGE_ID",
  "TAILSCALE_TAILNET",
  "TAILSCALE_TAG_OWNER",
  "TAILSCALE_POOL_TAG",
];

for (const key of REQUIRED) {
  test(`throws when ${key} is missing`, () => {
    const values = env();
    delete values[key];
    assert.throws(() => loadWorkerConfig(values), new RegExp(key));
  });

  test(`throws when ${key} is blank`, () => {
    assert.throws(() => loadWorkerConfig(env({ [key]: "   " })), new RegExp(key));
  });
}

test("throws when PVE_PORT is not a positive integer", () => {
  for (const value of ["0", "-1", "not-a-port", "80.5", "70000"]) {
    assert.throws(() => loadWorkerConfig(env({ PVE_PORT: value })), /PVE_PORT/);
  }
});

test("throws when PVE_HOST looks like a URL rather than a host", () => {
  assert.throws(
    () => loadWorkerConfig(env({ PVE_HOST: "https://192.168.8.195:8006" })),
    /PVE_HOST/,
  );
});

test("throws on an unknown PLACEMENT_CLAIM_MODE", () => {
  assert.throws(
    () => loadWorkerConfig(env({ PLACEMENT_CLAIM_MODE: "sometimes" })),
    /PLACEMENT_CLAIM_MODE/,
  );
});

test("defaults PLACEMENT_CLAIM_MODE to legacy so an unset value never claims via placement", () => {
  assert.equal(loadWorkerConfig(env()).placementClaimMode, "legacy");
});

test("accepts both placement claim modes", () => {
  for (const mode of ["legacy", "rpc"]) {
    assert.equal(loadWorkerConfig(env({ PLACEMENT_CLAIM_MODE: mode })).placementClaimMode, mode);
  }
});

test("parses the guild-a configuration", () => {
  const config = loadWorkerConfig(env());

  assert.equal(config.clusterId, "guild-a");
  assert.equal(config.siteId, "lag-1");
  assert.equal(config.workerId, "guild-a-lxc-500");
  assert.equal(config.pveHost, "192.168.8.195");
  assert.equal(config.pvePort, 8006);
  assert.equal(config.pveTokenSecretName, "proxmox_guild_a_site_worker_token");
  assert.equal(config.pvePoolId, "guildcloud-guild-a");
  assert.equal(config.backupJobId, "guild-a-standard-daily");
  assert.equal(config.backupStorage, "guild-pbs");
  assert.equal(config.backupNamespace, "");
  assert.equal(config.snippetsDir, "/mnt/guild-snippets");
  assert.equal(config.snippetsStorageId, "guild-snippets");
});

test("parses the guild-b configuration, including its backup namespace", () => {
  const config = loadWorkerConfig(
    env({
      WORKER_CLUSTER_ID: "guild-b",
      WORKER_ID: "guild-b-lxc-501",
      PVE_HOST: "192.168.8.142",
      PVE_TOKEN_SECRET_NAME: "proxmox_guild_b_site_worker_token",
      PVE_POOL_ID: "guildcloud-guild-b",
      BACKUP_JOB_ID: "guild-b-standard-daily",
      BACKUP_NAMESPACE: "guild-b",
    }),
  );

  assert.equal(config.clusterId, "guild-b");
  assert.equal(config.siteId, "lag-1");
  assert.equal(config.pveHost, "192.168.8.142");
  assert.equal(config.pveTokenSecretName, "proxmox_guild_b_site_worker_token");
  assert.equal(config.backupNamespace, "guild-b");
});

test("warm pool and tailnet housekeeping default to off so a new cluster never opts itself in", () => {
  const config = loadWorkerConfig(env());

  assert.equal(config.warmPoolEnabled, false);
  assert.equal(config.tailnetHousekeepingOwner, false);
});

test("parses boolean flags case-insensitively and rejects ambiguous values", () => {
  assert.equal(
    loadWorkerConfig(
      env({
        WARM_POOL_ENABLED: "TRUE",
        WARM_POOL_IMAGE_ID: "ubuntu-2404",
        WARM_POOL_PLAN_ID: "std-2",
        WARM_POOL_TARGET: "1",
        WARM_POOL_NODE: "nodeD",
      }),
    ).warmPoolEnabled,
    true,
  );
  assert.equal(loadWorkerConfig(env({ WARM_POOL_ENABLED: "false" })).warmPoolEnabled, false);
  assert.throws(() => loadWorkerConfig(env({ WARM_POOL_ENABLED: "yes" })), /WARM_POOL_ENABLED/);
});

test("warm pool image, plan, and node are required once the warm pool is enabled", () => {
  assert.throws(
    () => loadWorkerConfig(env({ WARM_POOL_ENABLED: "true" })),
    /WARM_POOL_IMAGE_ID/,
  );

  const config = loadWorkerConfig(
    env({
      WARM_POOL_ENABLED: "true",
      WARM_POOL_IMAGE_ID: "ubuntu-2404",
      WARM_POOL_PLAN_ID: "std-2",
      WARM_POOL_TARGET: "1",
      WARM_POOL_NODE: "nodeD",
    }),
  );

  assert.equal(config.warmPool.imageId, "ubuntu-2404");
  assert.equal(config.warmPool.planId, "std-2");
  assert.equal(config.warmPool.target, 1);
  assert.equal(config.warmPool.node, "nodeD");
});

test("rejects a negative warm pool target", () => {
  assert.throws(
    () =>
      loadWorkerConfig(
        env({
          WARM_POOL_ENABLED: "true",
          WARM_POOL_IMAGE_ID: "ubuntu-2404",
          WARM_POOL_PLAN_ID: "std-2",
          WARM_POOL_TARGET: "-1",
          WARM_POOL_NODE: "nodeD",
        }),
      ),
    /WARM_POOL_TARGET/,
  );
});

test("the returned config is frozen so no caller can retarget a live worker", () => {
  const config = loadWorkerConfig(env());

  assert.throws(() => {
    config.clusterId = "guild-b";
  }, TypeError);
  assert.equal(config.clusterId, "guild-a");
});

test("describeConfig never includes a secret value, only its name", () => {
  const config = loadWorkerConfig(env());
  const described = JSON.stringify(config.describe());

  assert.match(described, /proxmox_guild_a_site_worker_token/);
  assert.doesNotMatch(described, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(described.includes("secretValue"), false);
});

test("control-plane auth defaults to the legacy service-role mode", () => {
  const config = loadWorkerConfig(env());
  assert.equal(config.controlPlaneAuthMode, "service_role");
});

test("worker_token mode requires a worker token", () => {
  assert.throws(
    () => loadWorkerConfig(env({ CONTROL_PLANE_AUTH_MODE: "worker_token" })),
    /requires SUPABASE_WORKER_TOKEN/,
  );
});

test("worker_token mode refuses to run while the service-role key is still present", () => {
  // Otherwise a half-finished migration looks complete: the worker would use
  // its scoped token while the broad key stayed on the box, unrotated.
  assert.throws(
    () =>
      loadWorkerConfig(
        env({
          CONTROL_PLANE_AUTH_MODE: "worker_token",
          SUPABASE_WORKER_TOKEN: "header.payload.signature",
          SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
          SUPABASE_SERVICE_ROLE_KEY: "left-behind",
        }),
      ),
    /refuses to run with SUPABASE_SERVICE_ROLE_KEY still set/,
  );
});

test("worker_token mode requires a real API key for the apikey header", () => {
  // The gateway rejects a minted JWT in `apikey` with "Invalid API key" before
  // JWT verification runs, so without this the worker could never authenticate.
  assert.throws(
    () =>
      loadWorkerConfig(
        env({
          CONTROL_PLANE_AUTH_MODE: "worker_token",
          SUPABASE_WORKER_TOKEN: "header.payload.signature",
        }),
      ),
    /requires SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY/,
  );
});

test("worker_token mode is accepted once the service-role key is gone", () => {
  for (const apiKeyVar of ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"]) {
    const config = loadWorkerConfig(
      env({
        CONTROL_PLANE_AUTH_MODE: "worker_token",
        SUPABASE_WORKER_TOKEN: "header.payload.signature",
        [apiKeyVar]: "sb_publishable_example",
      }),
    );
    assert.equal(config.controlPlaneAuthMode, "worker_token", `with ${apiKeyVar}`);
  }
});

test("an unknown control-plane auth mode is rejected", () => {
  assert.throws(
    () => loadWorkerConfig(env({ CONTROL_PLANE_AUTH_MODE: "bypass" })),
    /CONTROL_PLANE_AUTH_MODE must be one of/,
  );
});

test("describeConfig reports the auth mode but never the token itself", () => {
  const described = JSON.stringify(
    loadWorkerConfig(
      env({
        CONTROL_PLANE_AUTH_MODE: "worker_token",
        SUPABASE_WORKER_TOKEN: "header.super-secret-payload.signature",
        SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
      }),
    ).describe(),
  );
  assert.match(described, /"controlPlaneAuthMode":"worker_token"/);
  assert.doesNotMatch(described, /super-secret-payload/);
});
