import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CreateInstanceWizard } from "@/components/create-instance-wizard";
import { InstanceActions } from "@/components/instance-actions";
import { platformCapabilities } from "@/lib/platform-capabilities";

vi.mock("server-only", () => ({}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/console/instances/actions", () => ({
  createInstance: vi.fn(async () => ({ error: null })),
  resizeInstance: vi.fn(async () => ({ error: null })),
  createInstanceSnapshot: vi.fn(async () => ({ error: null })),
  restoreInstance: vi.fn(async () => ({ error: null })),
  deleteInstance: vi.fn(async () => ({ error: null })),
}));

describe("customer-visible capability truth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("the capability contract keeps unimplemented services off", () => {
    expect(platformCapabilities.browserRecoveryConsole).toBe(false);
    expect(platformCapabilities.extraVolumes).toBe(false);
    expect(platformCapabilities.offsiteBackups).toBe(false);
    expect(platformCapabilities.monitoring).toBe(false);
    expect(platformCapabilities.walletPayments).toBe(false);
  });

  test("create wizard prices only fields that are submitted", () => {
    render(
      <CreateInstanceWizard
        projects={[{ id: "11111111-1111-4111-8111-111111111111", name: "Production" }]}
        sshKeyCount={1}
        templateAvailability={[{ catalogImageId: "ubuntu-2404", siteId: "lag-1" }]}
        provisionability={[
          {
            siteId: "lag-1",
            catalogImageId: "ubuntu-2404",
            catalogPlanId: "std-2",
            eligible: true,
            message: "Capacity available.",
          },
        ]}
        sites={[
          {
            id: "lag-1",
            name: "Lagos 1",
            location: "Lagos, Nigeria",
            acceptingNewWork: true,
            capacityReservePct: 30,
          },
        ]}
      />,
    );

    expect(screen.queryByText("Additional block storage")).not.toBeInTheDocument();
    expect(screen.queryByText("Protection tier")).not.toBeInTheDocument();
    expect(screen.queryByText(/off-site backup/i)).not.toBeInTheDocument();
    expect(screen.getByText("40 GB disk")).toBeInTheDocument();
  });

  test("restore offers only a ready snapshot replacement and never a blank new VM", async () => {
    const user = userEvent.setup();
    render(
      <InstanceActions
        instance={{
          id: "22222222-2222-4222-8222-222222222222",
          name: "api-prod",
          state: "ready",
          catalog_plan_id: "std-1",
          diskGb: 40,
        }}
        snapshots={[
          {
            id: "33333333-3333-4333-8333-333333333333",
            name: "before-release",
            proxmox_snapname: "snap-before-release",
            state: "ready",
            created_at: "2026-08-29T00:00:00.000Z",
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            name: "still-creating",
            proxmox_snapname: "snap-still-creating",
            state: "creating",
            created_at: "2026-08-29T00:01:00.000Z",
          },
        ]}
        isReal
      />,
    );

    await user.click(screen.getByRole("button", { name: "Restore" }));

    expect(screen.queryByText("Restore to a new instance")).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /before-release/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /still-creating/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace live instance" })).toBeDisabled();
  });
});
