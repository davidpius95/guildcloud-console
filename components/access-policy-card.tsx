"use client";

import { useMemo, useState } from "react";
import { Modal } from "./modal";
import { Badge, Button, Card, CardHeader, Note, Table, Td, Th } from "./ui";
import { IconPlus } from "./icons";
import {
  buckets,
  clusters,
  databases,
  functions,
  instances,
  projectName,
  projects,
} from "@/lib/mock-data";
import type { AccessPolicyRule, AccessResourceType, TeamMember } from "@/lib/types";

const resourceTypeLabel: Record<AccessResourceType | "all", string> = {
  all: "All resources",
  instance: "Guild Instance",
  database: "PostgreSQL database",
  cluster: "Kubernetes cluster",
  bucket: "Object storage bucket",
  function: "Function",
};

function resourcesForProject(projectId: string, type: AccessResourceType) {
  switch (type) {
    case "instance":
      return instances.filter((r) => r.projectId === projectId).map((r) => ({ id: r.id, name: r.name }));
    case "database":
      return databases.filter((r) => r.projectId === projectId).map((r) => ({ id: r.id, name: r.name }));
    case "cluster":
      return clusters.filter((r) => r.projectId === projectId).map((r) => ({ id: r.id, name: r.name }));
    case "bucket":
      return buckets.filter((r) => r.projectId === projectId).map((r) => ({ id: r.id, name: r.name }));
    case "function":
      return functions.filter((r) => r.projectId === projectId).map((r) => ({ id: r.id, name: r.name }));
  }
}

function resourceName(type: AccessResourceType, id: string) {
  const all = [...instances, ...databases, ...clusters, ...buckets, ...functions];
  return all.find((r) => r.id === id)?.name ?? id;
}

export function AccessPolicyCard({
  initialRules,
  team,
}: {
  initialRules: AccessPolicyRule[];
  team: TeamMember[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AccessPolicyRule | null>(null);

  const grantable = team.filter((m) => m.role !== "Owner" && m.role !== "Admin");

  function addRule(rule: Omit<AccessPolicyRule, "id" | "createdAt">) {
    setRules((r) => [
      { ...rule, id: `apr_${r.length + 1}_${Date.now()}`, createdAt: "2026-08-07" },
      ...r,
    ]);
    setAddOpen(false);
  }

  function confirmRemove() {
    if (!removeTarget) return;
    setRules((r) => r.filter((x) => x.id !== removeTarget.id));
    setRemoveTarget(null);
  }

  return (
    <>
      <Card className="min-w-0">
        <CardHeader
          title="Access policy"
          subtitle="Defines which identities can reach which resources. Owners and Admins always have full project access; other roles need an explicit grant below."
          action={
            <Button size="sm" onClick={() => setAddOpen(true)} disabled={grantable.length === 0}>
              <IconPlus className="h-3.5 w-3.5" />
              Add rule
            </Button>
          }
        />

        {rules.length ? (
          <Table minWidth="34rem">
            <thead>
              <tr>
                <Th>Member</Th>
                <Th>Project</Th>
                <Th>Resource</Th>
                <Th>Granted</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => {
                const member = team.find((m) => m.id === rule.memberId);
                return (
                  <tr key={rule.id}>
                    <Td>
                      <span className="font-medium text-ink-900">
                        {member?.name ?? "Unknown"}
                      </span>
                      <p className="text-xs text-ink-400">{member?.role}</p>
                    </Td>
                    <Td className="text-ink-500">{projectName(rule.projectId)}</Td>
                    <Td>
                      <Badge tone={rule.resourceType === "all" ? "amber" : "sky"}>
                        {resourceTypeLabel[rule.resourceType]}
                      </Badge>
                      {rule.resourceId ? (
                        <p className="mt-1 text-xs text-ink-500">
                          {resourceName(rule.resourceType as AccessResourceType, rule.resourceId)}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-ink-400">
                          All {rule.resourceType === "all" ? "resources" : `${rule.resourceType}s`} in project
                        </p>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-ink-500">{rule.createdAt}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(rule)}>
                        Revoke
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-400">
            No explicit grants yet. Developer, Billing, and Read-only members
            cannot reach any private resource until you add one.
          </p>
        )}

        <div className="border-t border-ink-100 px-5 py-3">
          <Note>
            Removing a grant here takes effect immediately for future
            connections. It does not disconnect an already-open session.
          </Note>
        </div>
      </Card>

      <AddRuleModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        members={grantable}
        onConfirm={addRule}
      />

      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Revoke this grant?"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmRemove}>
              Revoke
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-700">
          {team.find((m) => m.id === removeTarget?.memberId)?.name} will no
          longer be able to reach this resource over the private overlay.
        </p>
      </Modal>
    </>
  );
}

function AddRuleModal({
  open,
  onClose,
  members,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  members: TeamMember[];
  onConfirm: (rule: Omit<AccessPolicyRule, "id" | "createdAt">) => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [memberId, setMemberId] = useState(members[0]?.id ?? "");
  const [resourceType, setResourceType] = useState<AccessResourceType | "all">("all");
  const [resourceId, setResourceId] = useState<string>("");

  const scopedResources = useMemo(
    () => (resourceType === "all" ? [] : resourcesForProject(projectId, resourceType)),
    [projectId, resourceType],
  );

  function submit() {
    onConfirm({
      projectId,
      memberId,
      resourceType,
      resourceId: resourceType === "all" ? undefined : resourceId || undefined,
    });
    setResourceType("all");
    setResourceId("");
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add access rule"
      description="Grants one identity reachability to a resource scope inside a project."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!memberId} onClick={submit}>
            Add rule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Member</span>
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.role}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Project</span>
          <select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setResourceId("");
            }}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Resource scope</span>
          <select
            value={resourceType}
            onChange={(e) => {
              setResourceType(e.target.value as AccessResourceType | "all");
              setResourceId("");
            }}
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          >
            {(Object.keys(resourceTypeLabel) as Array<AccessResourceType | "all">).map((t) => (
              <option key={t} value={t}>
                {resourceTypeLabel[t]}
              </option>
            ))}
          </select>
        </label>

        {resourceType !== "all" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Specific resource (optional — leave blank for all {resourceType}s)
            </span>
            <select
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            >
              <option value="">All {resourceType}s in this project</option>
              {scopedResources.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Note tone="warning">
            This grants reachability to every resource in the project — use a
            narrower scope unless the member genuinely needs it.
          </Note>
        )}
      </div>
    </Modal>
  );
}
