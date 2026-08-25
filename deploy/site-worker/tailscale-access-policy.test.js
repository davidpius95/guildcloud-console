import assert from "node:assert/strict";
import test from "node:test";

import {
  desiredMemberInstanceGrants,
  instanceTag,
  memberTag,
  reconcileScopedAccessPolicy,
} from "./tailscale-access-policy.js";

const owner = { id: "11111111-aaaa-bbbb-cccc-000000000001", organization_id: "org-a", role: "Owner" };
const developer = { id: "22222222-aaaa-bbbb-cccc-000000000002", organization_id: "org-a", role: "Developer" };
const otherOrg = { id: "33333333-aaaa-bbbb-cccc-000000000003", organization_id: "org-b", role: "Owner" };
const vmA = { id: "aaaaaaaa-aaaa-bbbb-cccc-000000000001", organization_id: "org-a", project_id: "project-a" };
const vmB = { id: "bbbbbbbb-aaaa-bbbb-cccc-000000000002", organization_id: "org-a", project_id: "project-a" };
const vmC = { id: "cccccccc-aaaa-bbbb-cccc-000000000003", organization_id: "org-b", project_id: "project-b" };

test("an explicit instance grant reaches only that instance", () => {
  const grants = desiredMemberInstanceGrants({
    memberships: [developer],
    instances: [vmA, vmB],
    accessGrants: [{ membership_id: developer.id, project_id: "project-a", resource_type: "instance", resource_id: vmA.id }],
  });
  assert.deepEqual(grants, [{ src: [memberTag(developer.id)], dst: [instanceTag(vmA.id)], ip: ["*"] }]);
});

test("a project-wide grant does not create VM reachability", () => {
  const grants = desiredMemberInstanceGrants({
    memberships: [developer],
    instances: [vmA, vmB, vmC],
    accessGrants: [{ membership_id: developer.id, project_id: "project-a", resource_type: "all", resource_id: null }],
  });
  assert.deepEqual(grants, []);
});

test("owners require an explicit instance grant too", () => {
  const grants = desiredMemberInstanceGrants({ memberships: [owner, otherOrg], instances: [vmA, vmC], accessGrants: [] });
  assert.deepEqual(grants, []);
});

test("reconciliation removes legacy broad grants and preserves unrelated policy", () => {
  const policy = {
    tagOwners: {},
    grants: [
      { src: ["tag:guildcloud-member"], dst: ["tag:guildcloud-tenant-project-a"], ip: ["*"] },
      { src: ["tag:operator"], dst: ["tag:guildcloud-mgmt"], ip: ["*"] },
    ],
    ssh: [
      { action: "accept", src: ["tag:guildcloud-member"], dst: ["tag:guildcloud-tenant"], users: ["autogroup:nonroot"] },
      { action: "accept", src: ["tag:operator"], dst: ["tag:guildcloud-tenant"], users: ["autogroup:nonroot"] },
    ],
  };
  const next = reconcileScopedAccessPolicy(policy, {
    memberships: [developer],
    instances: [vmA, vmB],
    accessGrants: [{ membership_id: developer.id, project_id: "project-a", resource_type: "instance", resource_id: vmA.id }],
    tagOwner: "admin@example.com",
  });
  assert.equal(next.grants.some((grant) => grant.src.includes("tag:guildcloud-member")), false);
  assert.ok(next.grants.some((grant) => grant.src.includes("tag:operator")));
  assert.ok(next.grants.some((grant) => grant.dst.includes(instanceTag(vmA.id))));
  assert.equal(next.grants.some((grant) => grant.dst.includes(instanceTag(vmB.id))), false);
  assert.equal(next.ssh.some((rule) => rule.src.includes("tag:guildcloud-member")), false);
  assert.ok(next.ssh.some((rule) => rule.src.includes("tag:operator")));
  assert.deepEqual(
    next.ssh.find((rule) => rule.src.includes(memberTag(developer.id))),
    { action: "accept", src: [memberTag(developer.id)], dst: [instanceTag(vmA.id)], users: ["autogroup:nonroot"] },
  );
});
