const MEMBER_PREFIX = "tag:guildcloud-member-";
const INSTANCE_PREFIX = "tag:guildcloud-instance-";
const LEGACY_MEMBER_TAG = "tag:guildcloud-member";
const PROJECT_PREFIX = "tag:guildcloud-tenant-project-";

function shortId(id) {
  if (typeof id !== "string" || id.length < 8) throw new TypeError("expected a UUID-like id");
  return id.slice(0, 8);
}

export function memberTag(membershipId) {
  return `${MEMBER_PREFIX}${shortId(membershipId)}`;
}

export function instanceTag(instanceId) {
  return `${INSTANCE_PREFIX}${shortId(instanceId)}`;
}

function isScopedAccessGrant(grant) {
  const src = grant?.src ?? [];
  const dst = grant?.dst ?? [];
  return src.some((tag) => tag.startsWith(MEMBER_PREFIX)) && dst.some((tag) => tag.startsWith(INSTANCE_PREFIX));
}

function isLegacyBroadMemberGrant(grant) {
  const src = grant?.src ?? [];
  const dst = grant?.dst ?? [];
  return src.includes(LEGACY_MEMBER_TAG) && dst.some((tag) => tag.startsWith(PROJECT_PREFIX));
}

function isScopedSshRule(rule) {
  const src = rule?.src ?? [];
  const dst = rule?.dst ?? [];
  return src.some((tag) => tag.startsWith(MEMBER_PREFIX)) && dst.some((tag) => tag.startsWith(INSTANCE_PREFIX));
}

function isLegacyBroadMemberSshRule(rule) {
  const src = rule?.src ?? [];
  const dst = rule?.dst ?? [];
  return src.includes(LEGACY_MEMBER_TAG) && dst.some((tag) => tag === "tag:guildcloud-tenant" || tag === "tag:guildcloud-pool");
}

function grantKey(src, dst) {
  return `${src}\u0000${dst}`;
}

// Only an explicit instance grant creates reachability. Organization role or
// project membership alone never opens a route: a device-enrollment URL is
// tied to one VM, so its tailnet identity must be able to reach that VM and
// nothing else unless another distinct VM grant is created later.
export function desiredMemberInstanceGrants({ memberships, instances, accessGrants }) {
  const membersById = new Map(memberships.map((member) => [member.id, member]));
  const instanceById = new Map(instances.map((instance) => [instance.id, instance]));
  const desired = new Map();

  for (const accessGrant of accessGrants) {
    const member = membersById.get(accessGrant.membership_id);
    if (!member || accessGrant.resource_type !== "instance" || !accessGrant.resource_id) continue;
    const src = memberTag(member.id);
    const eligible = instances.filter(
      (instance) =>
        instance.organization_id === member.organization_id &&
        instance.project_id === accessGrant.project_id &&
        instance.id === accessGrant.resource_id,
    );
    for (const instance of eligible) {
      const dst = instanceTag(instance.id);
      desired.set(grantKey(src, dst), { src: [src], dst: [dst], ip: ["*"] });
    }
  }

  return [...desired.values()];
}

// Rewrites only GuildCloud's dynamic member-to-instance grants. It leaves
// unrelated tailnet policy untouched, but deliberately removes the previous
// generic member->project grants because those were broader than the console
// access model and let a member reach every instance in a project/org.
export function reconcileScopedAccessPolicy(policy, { memberships, instances, accessGrants, tagOwner }) {
  const next = structuredClone(policy);
  next.tagOwners = next.tagOwners ?? {};
  next.grants = next.grants ?? [];
  next.ssh = next.ssh ?? [];

  for (const member of memberships) next.tagOwners[memberTag(member.id)] = [tagOwner];
  for (const instance of instances) next.tagOwners[instanceTag(instance.id)] = [tagOwner];

  const desiredGrants = desiredMemberInstanceGrants({ memberships, instances, accessGrants });
  next.grants = next.grants.filter(
    (grant) => !isScopedAccessGrant(grant) && !isLegacyBroadMemberGrant(grant),
  );
  next.grants.push(...desiredGrants);

  // Tailscale SSH has a separate policy layer from network grants. Keep it
  // equally narrow so a membership-specific device cannot use Tailscale SSH
  // against a tenant/pool tag outside its permitted instance set.
  next.ssh = next.ssh.filter(
    (rule) => !isScopedSshRule(rule) && !isLegacyBroadMemberSshRule(rule),
  );
  next.ssh.push(
    ...desiredGrants.map((grant) => ({
      action: "accept",
      src: grant.src,
      dst: grant.dst,
      users: ["autogroup:nonroot"],
    })),
  );
  return next;
}
