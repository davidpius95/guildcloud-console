// Cluster-neutral worker configuration.
//
// No field here that identifies a cluster (host, token secret, pool, backup
// job) has a default - a missing value must fail startup, never fall back to
// guild-a. That is the property that makes it safe to run this same code on
// every cluster: a copy-pasted env file with one blank line refuses to start
// instead of quietly claiming another cluster's work.

const REQUIRED_STRING_FIELDS = [
  ["WORKER_CLUSTER_ID", "clusterId"],
  ["WORKER_SITE_ID", "siteId"],
  ["WORKER_ID", "workerId"],
  ["PVE_HOST", "pveHost"],
  ["PVE_TOKEN_SECRET_NAME", "pveTokenSecretName"],
  ["PVE_POOL_ID", "pvePoolId"],
  ["BACKUP_JOB_ID", "backupJobId"],
  ["BACKUP_STORAGE", "backupStorage"],
  ["SNIPPETS_DIR", "snippetsDir"],
  ["SNIPPETS_STORAGE_ID", "snippetsStorageId"],
  ["TAILSCALE_TAILNET", "tailscaleTailnet"],
  ["TAILSCALE_TAG_OWNER", "tailscaleTagOwner"],
  ["TAILSCALE_POOL_TAG", "tailscalePoolTag"],
];

const PLACEMENT_CLAIM_MODES = new Set(["legacy", "rpc"]);

// How the worker authenticates to the control plane.
//   "service_role" - legacy: SUPABASE_SERVICE_ROLE_KEY, broad control-plane
//                    access, cannot be scoped to one cluster.
//   "worker_token" - SUPABASE_WORKER_TOKEN, a pre-minted cluster-scoped JWT
//                    that only carries EXECUTE on the worker_* RPCs.
// Defaults to the legacy mode so an un-migrated cluster keeps running; the
// default flips once every production worker has a token (plan Task 7).
const CONTROL_PLANE_AUTH_MODES = new Set(["service_role", "worker_token"]);

function requireNonBlank(env, key) {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing or blank required worker config: ${key}`);
  }
  return value.trim();
}

function parsePort(env) {
  const raw = requireNonBlank(env, "PVE_PORT");
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535 || !/^\d+$/.test(raw)) {
    throw new Error(`PVE_PORT must be a positive integer port, got ${JSON.stringify(raw)}`);
  }
  return port;
}

function parseHost(env) {
  const host = requireNonBlank(env, "PVE_HOST");
  if (/^[a-z]+:\/\//i.test(host) || host.includes("/")) {
    throw new Error(`PVE_HOST must be a bare hostname or IP, not a URL: ${JSON.stringify(host)}`);
  }
  return host;
}

function parseBoolean(env, key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${key} must be "true" or "false", got ${JSON.stringify(raw)}`);
}

function parsePlacementClaimMode(env) {
  const raw = env.PLACEMENT_CLAIM_MODE;
  if (raw === undefined || raw === "") return "legacy";
  if (!PLACEMENT_CLAIM_MODES.has(raw)) {
    throw new Error(
      `PLACEMENT_CLAIM_MODE must be one of ${[...PLACEMENT_CLAIM_MODES].join(", ")}, got ${JSON.stringify(raw)}`,
    );
  }
  return raw;
}

function parseControlPlaneAuth(env) {
  const raw = (env.CONTROL_PLANE_AUTH_MODE ?? "").trim() || "service_role";
  if (!CONTROL_PLANE_AUTH_MODES.has(raw)) {
    throw new Error(
      `CONTROL_PLANE_AUTH_MODE must be one of ${[...CONTROL_PLANE_AUTH_MODES].join(", ")}, ` +
        `got ${JSON.stringify(raw)}`,
    );
  }

  // Requiring exactly one credential is the point: a worker that still has the
  // service-role key sitting in its env has not actually been constrained, so
  // refuse rather than let a half-finished migration look complete.
  const hasServiceRole = typeof env.SUPABASE_SERVICE_ROLE_KEY === "string"
    && env.SUPABASE_SERVICE_ROLE_KEY.trim() !== "";
  const hasWorkerToken = typeof env.SUPABASE_WORKER_TOKEN === "string"
    && env.SUPABASE_WORKER_TOKEN.trim() !== "";

  if (raw === "worker_token") {
    if (!hasWorkerToken) {
      throw new Error("CONTROL_PLANE_AUTH_MODE=worker_token requires SUPABASE_WORKER_TOKEN");
    }
    // The apikey header cannot be the worker token -- the gateway rejects a
    // minted JWT there with "Invalid API key" before JWT verification runs. A
    // real publishable or anon key is required alongside it.
    const hasApiKey = ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"].some(
      (key) => typeof env[key] === "string" && env[key].trim() !== "",
    );
    if (!hasApiKey) {
      throw new Error(
        "CONTROL_PLANE_AUTH_MODE=worker_token requires SUPABASE_PUBLISHABLE_KEY or " +
          "SUPABASE_ANON_KEY for the apikey header",
      );
    }
    if (hasServiceRole) {
      throw new Error(
        "CONTROL_PLANE_AUTH_MODE=worker_token refuses to run with SUPABASE_SERVICE_ROLE_KEY " +
          "still set: remove it from the worker env so the key can be rotated",
      );
    }
  }
  // The service_role branch deliberately does not require the key here: index.js
  // already fails startup with a clear message when it is missing, and
  // duplicating that check would make this function reject the config objects
  // that every other test builds without Supabase credentials.

  return raw;
}

function parsePositiveInt(env, key) {
  const raw = requireNonBlank(env, key);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || !/^\d+$/.test(raw)) {
    throw new Error(`${key} must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function parseWarmPool(env, warmPoolEnabled) {
  if (!warmPoolEnabled) return null;
  return {
    imageId: requireNonBlank(env, "WARM_POOL_IMAGE_ID"),
    planId: requireNonBlank(env, "WARM_POOL_PLAN_ID"),
    target: parsePositiveInt(env, "WARM_POOL_TARGET"),
    // Warm-pool VMs are built ahead of any customer request, so there is no
    // operation to carry a placement decision yet - unlike a real create,
    // which gets its node from place_next_pending_operation(). Pin it to one
    // configured node instead of guessing.
    node: requireNonBlank(env, "WARM_POOL_NODE"),
  };
}

// loadWorkerConfig(env) -> frozen config object.
//
// env is a plain key/value map (typically process.env). Throws Error with a
// message naming the offending variable on any missing, blank, or malformed
// field - this is meant to be called once at process start so a bad
// deployment fails loudly before touching Supabase or Proxmox.
export function loadWorkerConfig(env) {
  const config = {};
  for (const [envKey, field] of REQUIRED_STRING_FIELDS) {
    config[field] = requireNonBlank(env, envKey);
  }

  config.pveHost = parseHost(env);
  config.pvePort = parsePort(env);
  config.backupNamespace = (env.BACKUP_NAMESPACE ?? "").trim();
  config.placementClaimMode = parsePlacementClaimMode(env);
  config.controlPlaneAuthMode = parseControlPlaneAuth(env);
  config.warmPoolEnabled = parseBoolean(env, "WARM_POOL_ENABLED", false);
  config.tailnetHousekeepingOwner = parseBoolean(env, "TAILNET_HOUSEKEEPING_OWNER", false);
  config.warmPool = parseWarmPool(env, config.warmPoolEnabled);

  config.describe = () => ({
    clusterId: config.clusterId,
    siteId: config.siteId,
    workerId: config.workerId,
    pveHost: config.pveHost,
    pvePort: config.pvePort,
    pveTokenSecretName: config.pveTokenSecretName,
    pvePoolId: config.pvePoolId,
    backupJobId: config.backupJobId,
    backupStorage: config.backupStorage,
    backupNamespace: config.backupNamespace,
    snippetsDir: config.snippetsDir,
    snippetsStorageId: config.snippetsStorageId,
    placementClaimMode: config.placementClaimMode,
    controlPlaneAuthMode: config.controlPlaneAuthMode,
    warmPoolEnabled: config.warmPoolEnabled,
    tailnetHousekeepingOwner: config.tailnetHousekeepingOwner,
  });

  return Object.freeze(config);
}
