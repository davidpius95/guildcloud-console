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
    // Depth-independent on purpose. A bare ".next/**" is anchored to this
    // config's directory, so it ignores the root build output and nothing
    // else - agent worktrees under .claude/worktrees/ each carry their own
    // .next, and linting those made `npm run check` fail locally with tens
    // of thousands of errors in generated chunks. CI never saw it (fresh
    // clone, no worktrees), so the gate was only broken on real machines.
    ".claude/**",
    "**/.next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "supabase/functions/**",
  ]),
]);
