"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { Modal } from "./modal";
import { Badge, Button, Card, CardHeader, Note, Table, Td, Th } from "./ui";
import { IconPlus } from "./icons";
import { formatDate } from "@/lib/format";
import type { AccessResourceType, Membership } from "@/lib/types";
import { addAccessGrant, removeAccessGrant, type NetworkingActionState } from "@/app/console/networking/actions";

const resourceTypeLabel: Record<AccessResourceType | "all", string> = {
  all: "All resources",
  instance: "Guild Instance",
  database: "PostgreSQL database",
  cluster: "Kubernetes cluster",
  bucket: "Object storage bucket",
  function: "Function",
};

export type AccessGrant = {
  id: string;
  projectId: string;
  membershipId: string;
  resourceType: AccessResourceType | "all";
  resourceId: string | null;
  createdAt: string;
};

const initialState: NetworkingActionState = { error: null };
const ADD_GRANT_FORM_ID = "add-access-grant-form";

function memberLabel(m: Membership) {
  return m.email ?? m.invitedEmail ?? "—";
}

export function AccessPolicyCard({
  grants,
  members,
  projects,
  realInstances,
}: {
  grants: AccessGrant[];
  members: Membership[];
  projects: { id: string; name: string }[];
  // Only 'instance' is a real resource kind today - database/cluster/
  // bucket/function stay mock everywhere else in this app, nothing real
  // to select for them here either.
  realInstances: { id: string; name: string; projectId: string }[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<AccessGrant | null>(null);
  const [addState, addAction] = useActionState(addAccessGrant, initialState);
  const [isPending, startTransition] = useTransition();

  const grantable = members.filter((m) => m.role !== "Owner" && m.role !== "Admin");
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "—";
  const instanceName = (id: string) => realInstances.find((i) => i.id === id)?.name ?? id;

  function confirmRemove() {
    if (!removeTarget) return;
    startTransition(() => removeAccessGrant(removeTarget.id));
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

        {grants.length ? (
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
              {grants.map((grant) => {
                const member = members.find((m) => m.id === grant.membershipId);
                return (
                  <tr key={grant.id}>
                    <Td>
                      <span className="font-medium text-ink-900">
                        {member ? memberLabel(member) : "Unknown"}
                      </span>
                      <p className="text-xs text-ink-500">{member?.role}</p>
                    </Td>
                    <Td className="text-ink-500">{projectName(grant.projectId)}</Td>
                    <Td>
                      <Badge tone={grant.resourceType === "all" ? "amber" : "sky"}>
                        {resourceTypeLabel[grant.resourceType]}
                      </Badge>
                      {grant.resourceId ? (
                        <p className="mt-1 text-xs text-ink-500">
                          {grant.resourceType === "instance"
                            ? instanceName(grant.resourceId)
                            : grant.resourceId}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-ink-500">
                          All {grant.resourceType === "all" ? "resources" : `${grant.resourceType}s`} in project
                        </p>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs text-ink-500">{formatDate(grant.createdAt)}</Td>
                    <Td className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setRemoveTarget(grant)}
                      >
                        Revoke
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <p className="px-5 py-6 text-sm text-ink-500">
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
        projects={projects}
        realInstances={realInstances}
        addAction={addAction}
        addState={addState}
        onSubmitted={() => setAddOpen(false)}
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
          {(() => {
            const m = members.find((x) => x.id === removeTarget?.membershipId);
            return m ? memberLabel(m) : "This member";
          })()}{" "}
          will no longer be able to reach this resource over the private overlay.
        </p>
      </Modal>
    </>
  );
}

function AddRuleModal({
  open,
  onClose,
  members,
  projects,
  realInstances,
  addAction,
  addState,
  onSubmitted,
}: {
  open: boolean;
  onClose: () => void;
  members: Membership[];
  projects: { id: string; name: string }[];
  realInstances: { id: string; name: string; projectId: string }[];
  addAction: (formData: FormData) => void;
  addState: NetworkingActionState;
  onSubmitted: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [resourceType, setResourceType] = useState<AccessResourceType | "all">("all");
  const [resourceId, setResourceId] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const scopedInstances = useMemo(
    () => (resourceType === "instance" ? realInstances.filter((i) => i.projectId === projectId) : []),
    [projectId, resourceType, realInstances],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add access rule"
      description="Grants one identity reachability to a resource scope inside a project."
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" form={ADD_GRANT_FORM_ID} disabled={isPending || members.length === 0}>
            Add rule
          </Button>
        </>
      }
    >
      <form
        id={ADD_GRANT_FORM_ID}
        action={(formData) => {
          startTransition(async () => {
            await addAction(formData);
            onSubmitted();
            setResourceType("all");
            setResourceId("");
          });
        }}
        className="space-y-4"
      >
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Member</span>
          <select
            name="membershipId"
            className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email ?? m.invitedEmail ?? m.id} — {m.role}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-500">Project</span>
          <select
            name="projectId"
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
            name="resourceType"
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

        {resourceType === "instance" ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-500">
              Specific instance (optional — leave blank for all instances)
            </span>
            <select
              name="resourceId"
              value={resourceId}
              onChange={(e) => setResourceId(e.target.value)}
              className="w-full rounded-lg bg-white px-3 py-2 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:outline-2 focus:outline-offset-2 focus:outline-lemon-600"
            >
              <option value="">All instances in this project</option>
              {scopedInstances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        ) : resourceType !== "all" ? (
          <Note>
            {resourceTypeLabel[resourceType]} is still a mock resource type in
            this console — the grant is recorded, but there's nothing real to
            pick a specific one from yet.
          </Note>
        ) : (
          <Note tone="warning">
            This grants reachability to every resource in the project — use a
            narrower scope unless the member genuinely needs it.
          </Note>
        )}

        {addState.error ? <p className="text-xs text-rose-600">{addState.error}</p> : null}
      </form>
    </Modal>
  );
}
