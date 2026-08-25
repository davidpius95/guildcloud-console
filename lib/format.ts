// Real formatting helpers, extracted from lib/mock-data.ts so that pages
// rendering genuine customer data no longer have to import from a module
// whose name says the data is fake.

export function money(value: number) {
  return `$${value.toFixed(2)}`;
}

// Pinned locale/timezone (not the server's or browser's default) so
// server-rendered and client-hydrated output always match exactly - a bare
// toLocaleDateString()/toLocaleString() call resolves differently per
// environment (e.g. Node defaults to "8/8/2026", en-GB browsers render
// "08/08/2026" for the same Date), which is a real hydration-mismatch
// source, not just a cosmetic one.
export function formatDate(value: string | Date) {
  return new Date(value).toLocaleDateString("en-US", { timeZone: "UTC" });
}

export function formatDateTime(value: string | Date) {
  return new Date(value).toLocaleString("en-US", { timeZone: "UTC" });
}
