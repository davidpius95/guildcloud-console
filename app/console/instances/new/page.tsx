import { CreateInstanceWizard } from "@/components/create-instance-wizard";
import { PageHeader } from "@/components/ui";
import { getCurrentUserOrg, getProjectsForOrg } from "@/lib/supabase/queries";

export default async function NewInstancePage() {
  const userOrg = await getCurrentUserOrg();
  const projects = userOrg ? await getProjectsForOrg(userOrg.organization.id) : [];

  return (
    <>
      <PageHeader
        title="Create a Guild Instance"
        description="Choose a site, image, plan, protection, and access method. The hourly price and monthly maximum are shown before anything is created."
      />
      <CreateInstanceWizard projects={projects} />
    </>
  );
}
