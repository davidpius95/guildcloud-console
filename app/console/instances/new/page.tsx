import { CreateInstanceWizard } from "@/components/create-instance-wizard";
import { Note, PageHeader } from "@/components/ui";
import {
  getCatalogProvisionability,
  getCatalogTemplateAvailability,
  getCurrentUserOrg,
  getProjectsForOrg,
  getRealSites,
  getSshKeysForOrg,
} from "@/lib/supabase/queries";
import { images, plans } from "@/lib/catalog";

export default async function NewInstancePage() {
  const userOrg = await getCurrentUserOrg();

  // Mirrors the "owners/admins can create instances" RLS policy - a
  // Developer/Billing/Read-only member gets a real explanation here instead
  // of filling out the whole wizard and only failing at submit.
  if (userOrg && userOrg.membership.role !== "Owner" && userOrg.membership.role !== "Admin") {
    return (
      <>
        <PageHeader
          title="Create a Guild Instance"
          description="Choose a site, image, plan, protection, and access method. The hourly price and monthly maximum are shown before anything is created."
        />
        <Note>
          Only organization Owners and Admins can create instances. Ask an
          Owner or Admin on your team, or have your role changed in{" "}
          Settings &rarr; Team.
        </Note>
      </>
    );
  }

  const projects = userOrg ? await getProjectsForOrg(userOrg.organization.id) : [];
  const sshKeyCount = userOrg ? (await getSshKeysForOrg(userOrg.organization.id)).length : 0;
  const templateAvailability = await getCatalogTemplateAvailability();
  const sites = await getRealSites();
  const provisionability =
    userOrg && sites.length > 0
      ? await getCatalogProvisionability({
          siteIds: sites.map((site) => site.id),
          imageIds: images.map((image) => image.id),
          planIds: plans.map((plan) => plan.id),
        })
      : [];

  return (
    <>
      <PageHeader
        title="Create a Guild Instance"
        description="Choose a site, image, plan, protection, and access method. The hourly price and monthly maximum are shown before anything is created."
      />
      <CreateInstanceWizard
        projects={projects}
        sshKeyCount={sshKeyCount}
        templateAvailability={templateAvailability}
        provisionability={provisionability}
        sites={sites}
      />
    </>
  );
}
