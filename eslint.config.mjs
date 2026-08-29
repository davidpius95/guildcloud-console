import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // Existing UI intentionally mirrors server snapshots into polling state.
      // Keep that behavior until the polling reducer is redesigned separately.
      "react-hooks/set-state-in-effect": "off",
      // Product copy uses natural apostrophes in JSX text throughout the app.
      "react/no-unescaped-entities": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "supabase/functions/**",
  ]),
]);
