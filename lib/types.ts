export type ResourceState =
  | "ready"
  | "provisioning"
  | "degraded"
  | "stopped"
  | "failed"
  | "deleting";

export type ProtectionTier = "standard" | "protected" | "warm-standby";

export type Site = {
  id: string;
  name: string;
  location: string;
  status: "healthy" | "admission-paused" | "degraded";
  capacityReservePct: number;
  usedCpuPct: number;
  usedMemoryPct: number;
  usedStoragePct: number;
  acceptingNewWork: boolean;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  accent: "lemon" | "sky" | "violet" | "amber";
  resourceCount: number;
  monthlySpend: number;
};

export type Instance = {
  id: string;
  name: string;
  projectId: string;
  siteId: string;
  image: string;
  plan: string;
  vcpu: number;
  memoryGb: number;
  diskGb: number;
  privateIp: string;
  privateHostname: string;
  adminUser: string;
  state: ResourceState;
  protection: ProtectionTier;
  passwordSshEnabled: boolean;
  hourlyPrice: number;
  monthlyMax: number;
  createdAt: string;
  cpuPct: number;
  memoryPct: number;
  diskPct: number;
  lastBackupAt: string | null;
};

export type Volume = {
  id: string;
  name: string;
  projectId: string;
  siteId: string;
  sizeGb: number;
  attachedTo: string | null;
  state: ResourceState;
  monthlyMax: number;
};

export type Database = {
  id: string;
  name: string;
  projectId: string;
  siteId: string;
  engine: "PostgreSQL 16" | "PostgreSQL 15";
  plan: string;
  storageGb: number;
  privateHostname: string;
  state: ResourceState;
  protection: ProtectionTier;
  monthlyMax: number;
  lastBackupAt: string | null;
  connections: number;
  maxConnections: number;
};

export type Bucket = {
  id: string;
  name: string;
  projectId: string;
  siteId: string;
  usedGb: number;
  objects: number;
  versioning: boolean;
  visibility: "private";
  monthlyMax: number;
};

export type KubernetesCluster = {
  id: string;
  name: string;
  projectId: string;
  siteId: string;
  version: string;
  mode: "shared-managed";
  namespaces: number;
  workloads: number;
  state: ResourceState;
  monthlyMax: number;
};

export type FunctionResource = {
  id: string;
  name: string;
  projectId: string;
  siteId: string;
  runtime: "Node.js 20" | "Python 3.12";
  trigger: "HTTP" | "Schedule" | "Storage event" | "PostgreSQL event";
  state: ResourceState;
  invocations24h: number;
  errorRate: number;
  avgDurationMs: number;
  monthlyMax: number;
};

export type OperationStage = {
  label: string;
  status: "done" | "active" | "pending" | "failed";
};

export type Operation = {
  id: string;
  kind: string;
  resourceName: string;
  projectId: string;
  startedAt: string;
  state: "running" | "succeeded" | "failed";
  stages: OperationStage[];
};

export type Alert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  resource: string;
  openedAt: string;
  acknowledged: boolean;
};

export type LedgerEntry = {
  id: string;
  date: string;
  description: string;
  kind: "top-up" | "usage" | "adjustment" | "refund";
  amount: number;
  reference: string;
};

export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Admin" | "Developer" | "Billing" | "Read-only";
  deviceEnrolled: boolean;
  lastActive: string;
};

export type CatalogPlan = {
  id: string;
  name: string;
  vcpu: number;
  memoryGb: number;
  diskGb: number;
  hourlyPrice: number;
  monthlyMax: number;
  note?: string;
};

export type MigrationSource = "AWS" | "DigitalOcean" | "Hetzner" | "Other";

export type DiscoveredWorkload = {
  id: string;
  name: string;
  kind: "VM" | "Database" | "Object storage";
  spec: string;
  sizeGb: number;
};

export type MigrationJob = {
  id: string;
  name: string;
  source: MigrationSource;
  projectId: string;
  status: "discovering" | "planning" | "migrating" | "completed" | "failed";
  workloadCount: number;
  startedAt: string;
  completedAt: string | null;
  stages: OperationStage[];
};

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "urgent" | "high" | "normal" | "low";

export type TicketMessage = {
  id: string;
  author: string;
  role: "customer" | "support";
  body: string;
  at: string;
};

export type SupportTicket = {
  id: string;
  subject: string;
  projectId: string;
  resource: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  protectionTier: ProtectionTier | null;
  createdAt: string;
  updatedAt: string;
  firstResponseTargetMinutes: number;
  firstResponseAt: string | null;
  messages: TicketMessage[];
};

export type CatalogImage = {
  id: string;
  name: string;
  version: string;
  family: "os" | "solution";
  recommended?: boolean;
  availableSites: string[];
};
