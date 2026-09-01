import assert from "node:assert/strict";
import test from "node:test";

test("lifecycle module exposes the Proxmox correctness boundary", async () => {
  const lifecycle = await import("./lifecycle.js");
  assert.equal(typeof lifecycle.createSnapshot, "function");
  assert.equal(typeof lifecycle.rollbackSnapshot, "function");
  assert.equal(typeof lifecycle.resizeInstanceResources, "function");
});

test("snapshot becomes successful only after its UPID and observed snapshot complete", async () => {
  const { createSnapshot } = await import("./lifecycle.js");
  const events = [];
  const pve = async (_token, method, path, body) => {
    events.push({ method, path, body });
    if (method === "POST") return "UPID:nodeA:0001";
    return [{ name: "snap-release" }];
  };
  const waitForTask = async (_token, node, upid) => {
    events.push({ method: "WAIT", node, upid });
  };

  const observed = await createSnapshot({
    pve,
    waitForTask,
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    snapname: "snap-release",
  });

  assert.deepEqual(observed, { proxmox_task_id: "UPID:nodeA:0001", snapshot: "snap-release" });
  assert.deepEqual(events.map((event) => event.method), ["POST", "WAIT", "GET"]);
});

test("snapshot rejects a Proxmox response without a task id", async () => {
  const { createSnapshot } = await import("./lifecycle.js");
  await assert.rejects(
    createSnapshot({
      pve: async () => null,
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      snapname: "snap-release",
    }),
    /did not return a task id/,
  );
});

test("restore rejects an empty snapshot instead of rebooting as a successful no-op", async () => {
  const { rollbackSnapshot } = await import("./lifecycle.js");
  await assert.rejects(
    rollbackSnapshot({
      pve: async () => "UPID:unexpected",
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      snapname: "",
    }),
    /snapshot name is required/,
  );
});

test("restore waits for the rollback task before reporting observed completion", async () => {
  const { rollbackSnapshot } = await import("./lifecycle.js");
  const events = [];
  const observed = await rollbackSnapshot({
    pve: async (_token, method, path) => {
      events.push({ method, path });
      return "UPID:nodeA:rollback";
    },
    waitForTask: async (_token, node, upid) => {
      events.push({ method: "WAIT", node, upid });
    },
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    snapname: "snap-release",
  });

  assert.deepEqual(observed, { proxmox_task_id: "UPID:nodeA:rollback", snapshot: "snap-release" });
  assert.deepEqual(events.map((event) => event.method), ["POST", "WAIT"]);
});

function statefulResizePve({ diskKey = "scsi0", diskGb = 40, failDisk = false } = {}) {
  const state = { cores: 1, memory: 2048, diskGb };
  const calls = [];
  const pve = async (_token, method, path, body) => {
    calls.push({ method, path, body });
    if (method === "GET") {
      return {
        cores: state.cores,
        memory: state.memory,
        boot: `order=${diskKey};ide2;net0`,
        [diskKey]: `local-lvm:vm-101-disk-0,size=${state.diskGb}G`,
      };
    }
    if (path.endsWith("/config")) {
      state.cores = body.cores;
      state.memory = body.memory;
      return null;
    }
    if (path.endsWith("/resize")) {
      if (failDisk) throw new Error("disk resize failed");
      state.diskGb += Number(String(body.size).replace(/^\+/, "").replace(/G$/, ""));
      return "UPID:nodeA:resize";
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  return { pve, calls };
}

test("resize grows the observed boot disk and publishes verified target resources", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve();
  const waits = [];

  const observed = await resizeInstanceResources({
    pve: fake.pve,
    waitForTask: async (_token, node, upid) => waits.push({ node, upid }),
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    target: { vcpu: 2, memory_gb: 4, disk_gb: 80 },
  });

  assert.deepEqual(observed, { vcpu: 2, memory_gb: 4, disk_gb: 80, disk: "scsi0" });
  assert.deepEqual(waits, [{ node: "nodeA", upid: "UPID:nodeA:resize" }]);
  assert.equal(fake.calls.find((call) => call.path.endsWith("/resize")).body.size, "+40G");
});

test("resize resolves a non-scsi boot disk from observed configuration", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve({ diskKey: "virtio0" });

  const observed = await resizeInstanceResources({
    pve: fake.pve,
    waitForTask: async () => undefined,
    token: "redacted-token",
    node: "nodeA",
    vmid: 101,
    target: { vcpu: 2, memory_gb: 4, disk_gb: 80 },
  });

  assert.equal(observed.disk, "virtio0");
});

test("resize refuses any disk shrink before changing Proxmox", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve({ diskGb: 80 });

  await assert.rejects(
    resizeInstanceResources({
      pve: fake.pve,
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      target: { vcpu: 2, memory_gb: 4, disk_gb: 40 },
    }),
    /disk shrinking is not supported/,
  );
  assert.equal(fake.calls.filter((call) => call.method === "PUT").length, 0);
});

test("resize never reports success after a partial disk failure", async () => {
  const { resizeInstanceResources } = await import("./lifecycle.js");
  const fake = statefulResizePve({ failDisk: true });

  await assert.rejects(
    resizeInstanceResources({
      pve: fake.pve,
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 101,
      target: { vcpu: 2, memory_gb: 4, disk_gb: 80 },
    }),
    /disk resize failed/,
  );
});

test("create grows the cloned boot disk from the template size to the plan size", async () => {
  const { ensureBootDiskSize } = await import("./lifecycle.js");
  const events = [];
  let size = "16G";
  const pve = async (_token, method, path, body) => {
    events.push({ method, path, body });
    if (method === "GET") {
      return { boot: "order=scsi0", scsi0: `ceph-vm:vm-102-disk-0,discard=on,size=${size},ssd=1` };
    }
    size = "40G";
    return "UPID:nodeA:0009";
  };
  const waitForTask = async () => events.push({ method: "WAIT" });

  const observed = await ensureBootDiskSize({
    pve,
    waitForTask,
    token: "redacted-token",
    node: "nodeA",
    vmid: 102,
    diskGb: 40,
  });

  assert.deepEqual(observed, { disk: "scsi0", disk_gb: 40, grown: true });
  assert.deepEqual(
    events.filter((event) => event.method === "PUT").map((event) => event.body),
    [{ disk: "scsi0", size: "+24G" }],
  );
  // The grow must precede the caller's start, and be confirmed by a re-read.
  assert.deepEqual(events.map((event) => event.method), ["GET", "PUT", "WAIT", "GET"]);
});

test("create never shrinks a boot disk that already exceeds the plan", async () => {
  const { ensureBootDiskSize } = await import("./lifecycle.js");
  const events = [];
  const pve = async (_token, method, path, body) => {
    events.push({ method, path, body });
    return { boot: "order=scsi0", scsi0: "ceph-vm:vm-102-disk-0,size=160G" };
  };

  const observed = await ensureBootDiskSize({
    pve,
    waitForTask: async () => assert.fail("no resize task should run"),
    token: "redacted-token",
    node: "nodeA",
    vmid: 102,
    diskGb: 40,
  });

  assert.deepEqual(observed, { disk: "scsi0", disk_gb: 160, grown: false });
  assert.deepEqual(events.map((event) => event.method), ["GET"]);
});

test("create fails loudly when the boot disk does not reach the plan size", async () => {
  const { ensureBootDiskSize } = await import("./lifecycle.js");
  await assert.rejects(
    ensureBootDiskSize({
      // Proxmox reports success but the disk never actually grows.
      pve: async (_token, method) =>
        method === "GET"
          ? { boot: "order=scsi0", scsi0: "ceph-vm:vm-102-disk-0,size=16G" }
          : "UPID:nodeA:0010",
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 102,
      diskGb: 80,
    }),
    /boot disk scsi0 did not reach 80G after resize \(observed 16G\)/,
  );
});

test("create rejects a plan with no usable disk size rather than silently skipping", async () => {
  const { ensureBootDiskSize } = await import("./lifecycle.js");
  await assert.rejects(
    ensureBootDiskSize({
      pve: async () => assert.fail("Proxmox must not be reached"),
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 102,
      diskGb: undefined,
    }),
    /target disk_gb must be positive/,
  );
});

// The Guild-A failure reproduced: the disk grow still holds the qemu-server
// lock when the restart is attempted. The old four-attempts-in-12s loop failed
// the resize here; this must wait the lock out instead.
test("restart waits out a held Proxmox lock instead of failing the resize", async () => {
  const { restartInstanceAfterConfigChange } = await import("./lifecycle.js");
  const events = [];
  let clock = 0;
  let locked = 3;
  const pve = async (_token, method, path) => {
    events.push({ method, path });
    if (method === "GET") {
      if (locked > 0) {
        locked -= 1;
        return { status: "running", lock: "disk" };
      }
      return { status: "running" };
    }
    return "UPID:nodeA:0011";
  };

  const observed = await restartInstanceAfterConfigChange({
    pve,
    waitForTask: async () => events.push({ method: "WAIT" }),
    token: "redacted-token",
    node: "nodeA",
    vmid: 102,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });

  assert.deepEqual(observed, { restarted: true, action: "reboot" });
  assert.equal(events.filter((event) => event.method === "POST").length, 1);
  // It backs off rather than hammering Proxmox while the lock is held.
  assert.ok(clock >= 2000 + 4000 + 8000);
});

test("restart starts a stopped VM rather than rebooting it", async () => {
  const { restartInstanceAfterConfigChange } = await import("./lifecycle.js");
  const paths = [];
  let started = false;
  const pve = async (_token, method, path) => {
    if (method === "GET") return { status: started ? "running" : "stopped" };
    paths.push(path);
    started = true;
    return "UPID:nodeA:0012";
  };

  const observed = await restartInstanceAfterConfigChange({
    pve,
    waitForTask: async () => undefined,
    token: "redacted-token",
    node: "nodeA",
    vmid: 102,
    sleep: async () => undefined,
    now: () => 0,
  });

  assert.deepEqual(observed, { restarted: true, action: "start" });
  assert.deepEqual(paths, ["nodes/nodeA/qemu/102/status/start"]);
});

test("restart does not report success while the VM is still powered off", async () => {
  const { restartInstanceAfterConfigChange } = await import("./lifecycle.js");
  let clock = 0;
  await assert.rejects(
    restartInstanceAfterConfigChange({
      // Proxmox accepts the task and the VM never comes back up.
      pve: async (_token, method) => (method === "GET" ? { status: "stopped" } : "UPID:nodeA:0013"),
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 102,
      budgetMs: 30000,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    }),
    /did not reach a running state|did not restart|Failed to restart/,
  );
});

test("restart gives up on a real fault instead of burning the whole budget", async () => {
  const { restartInstanceAfterConfigChange } = await import("./lifecycle.js");
  let clock = 0;
  await assert.rejects(
    restartInstanceAfterConfigChange({
      pve: async (_token, method) => {
        if (method === "GET") return { status: "running" };
        throw new Error("500 no such VM");
      },
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 102,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    }),
    /no such VM/,
  );
  assert.equal(clock, 0, "a non-lock fault must not be retried");
});

test("lock timeouts are transient, other Proxmox errors are not", async () => {
  const { isTransientRestartError } = await import("./lifecycle.js");
  assert.equal(
    isTransientRestartError(
      new Error("can't lock file '/var/lock/qemu-server/lock-102.conf' - got timeout"),
    ),
    true,
  );
  assert.equal(isTransientRestartError(new Error("VM is locked (disk)")), true);
  assert.equal(isTransientRestartError(new Error("500 no such VM")), false);
});

// Guild-A again: with the lock waited out, the next thing to break was the
// qmreboot task outrunning waitForTask's 120s default on slow ceph storage.
// A task that outran its own wait is not a failed task.
test("restart survives a reboot task that outruns its own wait", async () => {
  const { restartInstanceAfterConfigChange } = await import("./lifecycle.js");
  let clock = 0;
  let polls = 0;
  const observed = await restartInstanceAfterConfigChange({
    pve: async (_token, method) => {
      if (method !== "GET") return "UPID:nodeA:0014";
      polls += 1;
      // Uptime resets on the second poll: the reboot did happen, late.
      return polls <= 1 ? { status: "running", uptime: 900 } : { status: "running", uptime: 5 };
    },
    waitForTask: async () => {
      throw new Error("Proxmox task UPID:nodeA:0014 did not finish within 120000ms");
    },
    token: "redacted-token",
    node: "nodeA",
    vmid: 102,
    sleep: async (ms) => { clock += ms; },
    now: () => clock,
  });
  assert.deepEqual(observed, { restarted: true, action: "reboot" });
});

test("restart refuses a reboot that never actually restarted the VM", async () => {
  const { restartInstanceAfterConfigChange } = await import("./lifecycle.js");
  let clock = 0;
  await assert.rejects(
    restartInstanceAfterConfigChange({
      // Running throughout with a climbing uptime: the VM never went down, so
      // the new cores and memory are not in effect and this is not a success.
      pve: async (_token, method) =>
        method === "GET" ? { status: "running", uptime: 900 + clock / 1000 } : "UPID:nodeA:0015",
      waitForTask: async () => undefined,
      token: "redacted-token",
      node: "nodeA",
      vmid: 102,
      budgetMs: 60000,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    }),
    /did not reach a running state/,
  );
});

test("a task Proxmox reports as failed is still terminal", async () => {
  const { restartInstanceAfterConfigChange } = await import("./lifecycle.js");
  let clock = 0;
  await assert.rejects(
    restartInstanceAfterConfigChange({
      pve: async (_token, method) => (method === "GET" ? { status: "running", uptime: 10 } : "UPID:nodeA:0016"),
      waitForTask: async () => { throw new Error("Proxmox task failed: volume not found"); },
      token: "redacted-token",
      node: "nodeA",
      vmid: 102,
      sleep: async (ms) => { clock += ms; },
      now: () => clock,
    }),
    /volume not found/,
  );
  assert.equal(clock, 0, "a genuinely failed task must not be retried");
});

// A failed create used to abandon its clone. podF still carries guests from
// 2026-08-27 for that reason, holding CPU, memory and disk with nothing but a
// `failed` row pointing at them.
test("rolling back a failed create stops and purges the clone", async () => {
  const { destroyGuest } = await import("./lifecycle.js");
  const calls = [];
  const observed = await destroyGuest({
    pve: async (_token, method, path, body) => {
      calls.push({ method, path, body });
      if (method === "GET") return [{ vmid: 105 }, { vmid: 102 }];
      return "UPID:podF:0020";
    },
    waitForTask: async () => calls.push({ method: "WAIT" }),
    token: "redacted-token",
    node: "podF",
    vmid: 102,
    sleep: async () => undefined,
  });

  assert.deepEqual(observed, { destroyed: true, guest_was_present: true });
  assert.deepEqual(
    calls.find((c) => c.method === "DELETE"),
    {
      method: "DELETE",
      path: "nodes/podF/qemu/102",
      body: { purge: 1, "destroy-unreferenced-disks": 1 },
    },
  );
  // Stopped before destroy, and the destroy task awaited.
  assert.deepEqual(calls.map((c) => c.method), ["GET", "POST", "DELETE", "WAIT"]);
});

test("rolling back is idempotent when the clone is already gone", async () => {
  const { destroyGuest } = await import("./lifecycle.js");
  const calls = [];
  const observed = await destroyGuest({
    // Proxmox answers a DELETE for a missing vmid with 403, not 404, so
    // presence is asked rather than inferred from an error.
    pve: async (_token, method) => {
      calls.push(method);
      if (method === "GET") return [{ vmid: 999 }];
      assert.fail("must not touch a guest that is not there");
    },
    waitForTask: async () => assert.fail("no destroy task should run"),
    token: "redacted-token",
    node: "podF",
    vmid: 102,
    sleep: async () => undefined,
  });

  assert.deepEqual(observed, { destroyed: false, guest_was_present: false });
  assert.deepEqual(calls, ["GET"]);
});

test("rolling back refuses to run without a node or vmid to target", async () => {
  const { destroyGuest } = await import("./lifecycle.js");
  const never = async () => assert.fail("Proxmox must not be reached");
  await assert.rejects(
    destroyGuest({ pve: never, waitForTask: never, token: "t", node: "", vmid: 102 }),
    /node is required/,
  );
  await assert.rejects(
    destroyGuest({ pve: never, waitForTask: never, token: "t", node: "podF", vmid: null }),
    /vmid is required/,
  );
});
