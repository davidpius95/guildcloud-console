export const platformCapabilities = Object.freeze({
  instances: true,
  privateAccess: true,
  sshKeys: true,
  passwordSsh: true,
  snapshots: true,
  replaceRestore: true,
  resize: true,
  onsiteBackups: true,
  browserRecoveryConsole: false,
  extraVolumes: false,
  offsiteBackups: false,
  monitoring: false,
  walletPayments: false,
  invoices: false,
  managedDatabases: false,
  kubernetes: false,
  objectStorage: false,
  functions: false,
} as const);

export type PlatformCapability = keyof typeof platformCapabilities;
