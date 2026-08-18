# Task 2B Report: Isolated Database Test Harness

Status: complete
Base: `249e0b350c2fa2d750f19bb98ef78b85c8860be`

## RED precondition

The base commit's `package.json` has no `test:db` script. The precondition
check against the base file reported:

```text
RED precondition: base package.json has no test:db script
```

The existing uncommitted harness remnant was not used as RED evidence.

## Implementation

- Added the checked-in Supabase CLI configuration with PostgreSQL major
  version 17.
- Added `npm run test:db` to invoke the harness. No `package-lock.json` change
  is required for an npm script-only change.
- Hardened the harness to pull and run one immutable
  `supabase/postgres@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00`
  image with `--pull=never`, PostgreSQL 17 verification, `--network none`,
  and no published ports.
- The harness streams the committed fixture, the real production migration,
  and the real pgTAP contract directly into the disposable database. It does
  not copy production migration SQL or invoke linked Supabase state.
- Added phase-scoped logs, actionable failure tails, and signal-safe cleanup
  of the exact disposable container.
- Added the exact `supabase/.temp/` ignore rule. The runtime state was not
  staged.

## GREEN execution

```text
PASS: 151 pgTAP assertions passed in the isolated database
```

## Verification

- `npm run test:db`: PASS, 151 pgTAP assertions.
- `npm test`: PASS, 29 worker tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS.
- `bash -n scripts/test-multi-cluster-schema.sh`: PASS.
- `git diff --check`: PASS.

## Concerns

- `npm run test:db` requires a running Docker daemon. If the immutable image
  is not cached, Docker must be able to pull that exact digest from its
  registry before the isolated container starts.
- The build retains existing Next.js warnings about the deprecated
  `middleware` convention and the repository-root `package-lock.json`.
