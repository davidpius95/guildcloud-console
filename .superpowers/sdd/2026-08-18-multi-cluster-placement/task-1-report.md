# Task 1 Report: Worker Unit-Test Harness and Pure Placement Policy

## Status

Implemented and verified. The pure policy is intentionally independent of the
database placement authority that will be added in a later task.

## Implementation

- Added root `test:worker` and `test` scripts using
  `node --test deploy/site-worker/*.test.js`.
- Added the worker-local `npm test` command.
- Enabled root ESM package scope so the new worker policy can use the required
  named exports.
- Implemented `evaluateCandidate(candidate, request, now)` with contract
  validation, 60-second freshness checks, ordered structured rejection codes,
  30% memory/storage reserves, the 70% vCPU ceiling, held reservations, and
  `max(used_memory, committed_memory)`.
- Implemented integer capacity metrics, clamped weighted scoring, warm-pool
  bonus, and `rankCandidates(candidates, request, now)` filtering and
  deterministic ordering.
- Returned only the contract decision fields; no credentials or management
  details are introduced.

## TDD Evidence

### RED

1. Initial gate tests failed with `ERR_MODULE_NOT_FOUND` because
   `deploy/site-worker/placement-policy.js` did not exist.
2. Capacity tests then produced 15 passing tests and 6 expected failures for
   missing reserve gates and placeholder metrics.
3. Score tests then produced 21 passing tests and 3 expected failures for the
   placeholder score.
4. Ranking tests failed at module instantiation because `rankCandidates` was
   not yet exported.

### GREEN

After each minimal implementation slice, the focused suite passed. The final
focused run passed all 26 tests with zero failures.

## Tests and Results

- `npm run test:worker`: PASS, 26 tests.
- `npm test`: PASS, 26 tests.
- `npm test --prefix deploy/site-worker-guild-a`: PASS, 26 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS. Next.js emitted the existing middleware deprecation
  warning and package-lock location warning; neither failed the build.
- `git diff --check`: PASS.

## Changed Files

- `package.json`
- `deploy/site-worker-guild-a/package.json`
- `deploy/site-worker/placement-policy.js`
- `deploy/site-worker/placement-policy.test.js`

## Commit

- `453d2a5 test: define multi-cluster placement policy`

## Self-Review

- Verified every rejection code is emitted in the ruling's required order.
- Verified freshness accepts exactly 60,000 ms and rejects future observations.
- Verified all request/candidate numeric fields are validated before capacity
  calculations.
- Replaced locale-dependent `localeCompare` tie-breaking with direct string
  ordering for deterministic cluster/node/storage sorting.
- Confirmed the policy imports as ESM and both named exports are available.
- Confirmed no database, network, credential, or worker lifecycle behavior was
  changed.

## Concerns

- This module does not provide atomic reservation or database authority; those
  remain explicitly deferred to the later RPC task.
- Capacity arithmetic follows the JavaScript-number contract and uses integer
  fields; the durable RPC must repeat the formulas while holding database
  locks.
- The pre-existing untracked `supabase/.temp/` directory was not modified or
  staged.

## Fix Round 1

### Accepted Findings

- `rankCandidates` now validates the request and `now` before evaluating the
  list, including when the candidate list is empty.
- Added `deploy/site-worker/package.json` with `type: module` and removed the
  root `package.json` `type: module` setting, keeping ESM scoped to the worker
  policy directory.
- Retained and explicitly regression-tested `vcpuHeadroomRatio: 0` when
  `vcpuCeiling` is zero; the metric remains finite and the vCPU hard gate still
  rejects the positive request.

### Fix-Round TDD Evidence

- RED: `npm test` reported 27 passing tests and exactly 2 failures for the new
  empty-list invalid-request and invalid-`now` assertions; both failures were
  missing expected `TypeError` exceptions.
- GREEN: `npm run test:worker` passed all 29 tests after the validation and
  package-scope fixes.

### Fix-Round Verification

- `npm run test:worker`: PASS, 29 tests.
- `npm test`: PASS, 29 tests.
- `npm test --prefix deploy/site-worker-guild-a`: PASS, 29 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, with the existing package-lock location and
  middleware-to-proxy warnings only.
- `git diff --check`: PASS.

### Fix-Round Commit

- `9d799a5 fix: harden placement policy validation`
