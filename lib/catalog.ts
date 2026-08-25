import type { CatalogImage, CatalogPlan } from "@/lib/types";

// Display metadata for the plan and image catalogue. These mirror the real
// seeded `catalog_plans` and `catalog_images` rows by id - the create wizard
// sends these ids straight into a real foreign-keyed column - so this is a
// presentation mirror of real records, not invented customer data. It was
// previously in lib/mock-data.ts alongside genuinely fabricated content.
//
// Actual availability is never taken from here: which image can be built at
// which site comes from catalog_image_site_templates via
// getCatalogTemplateAvailability(), and which sites exist at all comes from
// infrastructure_clusters via getRealSites().

export const plans: CatalogPlan[] = [
  {
    id: "std-1",
    name: "Standard 1",
    vcpu: 1,
    memoryGb: 2,
    diskGb: 40,
    hourlyPrice: 0.016,
    monthlyMax: 11.52,
  },
  {
    id: "std-2",
    name: "Standard 2",
    vcpu: 2,
    memoryGb: 4,
    diskGb: 80,
    hourlyPrice: 0.031,
    monthlyMax: 22.32,
  },
  {
    id: "std-4",
    name: "Standard 4",
    vcpu: 4,
    memoryGb: 8,
    diskGb: 160,
    hourlyPrice: 0.062,
    monthlyMax: 44.64,
  },
  {
    id: "std-8",
    name: "Standard 8",
    vcpu: 8,
    memoryGb: 16,
    diskGb: 320,
    hourlyPrice: 0.124,
    monthlyMax: 89.28,
    note: "Limited stock at Lagos 1",
  },
];


export const images: CatalogImage[] = [
  {
    id: "ubuntu-2404",
    name: "Ubuntu",
    version: "24.04 LTS",
    family: "os",
    recommended: true,
    availableSites: ["lag-1", "abj-1", "ams-1"],
  },
  {
    id: "debian-12",
    name: "Debian",
    version: "13",
    family: "os",
    availableSites: ["lag-1", "abj-1"],
  },
  {
    id: "fedora-41",
    name: "Fedora",
    version: "43",
    family: "os",
    availableSites: ["lag-1"],
  },
  {
    id: "rocky-9",
    name: "Rocky Linux",
    version: "10",
    family: "os",
    availableSites: ["lag-1", "abj-1"],
  },
  {
    id: "alma-9",
    name: "AlmaLinux",
    version: "10",
    family: "os",
    availableSites: ["lag-1", "abj-1"],
  },
  {
    id: "arch-linux",
    name: "Arch Linux",
    version: "Rolling",
    family: "os",
    availableSites: ["lag-1"],
  },
  {
    id: "docker",
    name: "Docker",
    version: "on Ubuntu 24.04",
    family: "solution",
    availableSites: ["lag-1", "abj-1"],
  },
  {
    id: "wordpress",
    name: "WordPress",
    version: "on Ubuntu 24.04",
    family: "solution",
    availableSites: ["lag-1"],
  },
];
