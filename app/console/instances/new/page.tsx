import { CreateInstanceWizard } from "@/components/create-instance-wizard";
import { PageHeader } from "@/components/ui";

export default function NewInstancePage() {
  return (
    <>
      <PageHeader
        title="Create a Guild Instance"
        description="Choose a site, image, plan, protection, and access method. The hourly price and monthly maximum are shown before anything is created."
      />
      <CreateInstanceWizard />
    </>
  );
}
