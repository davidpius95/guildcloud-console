import "@testing-library/jest-dom/vitest";

import { randomUUID } from "node:crypto";

if (!globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: randomUUID,
  });
}
