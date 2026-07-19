# PR 784 ReviewGPT Round 4 Remediation

## Goal

Close the accepted ReviewGPT round-4 regressions without restoring a
model-controlled shell or adding a second authority owner:

1. Persist one closed task identity for every new scheduled group automation:
   ordinary notification, health update, or exact challenge.
2. Preserve supported recurring group health updates through a selector-free,
   parent-derived shared-data read capability.
3. Structurally pause pre-binding Linq automations whose audience is not
   explicitly direct, because free text cannot recover group task authority.
4. Recheck current group route and source authority at each read and provider
   effect owner, including queued legacy intent cutover.

## Constraints

- Keep scheduled turns on the sterile one-shot App Server with no native shell,
  operator CLI, collaboration, app, plugin, MCP, or arbitrary filesystem
  authority.
- Derive group read authority only from the exact current canonical automation
  revision and the current server-authorized non-direct delivery route.
- Return only consented health projections; expose no model-selectable scope,
  route, member, record, or provider identifiers.
- Never infer challenge effect authority from title, tags, instructions, page
  prose, or projection cardinality.
- Keep the legacy disposition temporary and denial-only. Preserve linked
  authorityless work only when its current source and intent prove the same
  supported non-group audience. Remove the bridge after the deployed legacy
  inventory has drained; do not add a migration registry, compatibility
  manager, or second automation owner.

## Working Set

- `packages/contracts/src/automation.ts`, `packages/core/src/automation.ts`,
  and focused lifecycle/atomic-pause tests
- `packages/assistant-engine/src/assistant/scheduled-task-authority.ts`
- `packages/assistant-engine/src/assistant/cron/**`, outbox authority, and
  focused cron/outbox tests
- `packages/assistant-engine/src/assistant-codex/dynamic-tools/**`
- hosted runtime automation writer and provider-entry callbacks
- scheduled prompt/skill guidance and focused asset/tool tests
- matching architecture, reliability, security, and deployment documentation

## Verification Plan

- Focused core, scheduled-authority, scheduled-read, scheduled-tool, cron, and
  skill tests plus affected package typechecks.
- Real hosted runner bundle build, unchanged forbidden-import guards, and one
  measured budget ratchet for the final typed effect-owner graph. Keep the
  executor statically linked if lazy splitting adds glue or a new async
  failure seam without reducing total output.
- Full serial acceptance verification with the repository's CI-equivalent heap
  and worker limits.
- Push one exact candidate head, start ReviewGPT round 5 immediately alongside
  required CI, resolve only evidence-backed findings, and merge after all gates
  pass.

## Results

- Final architecture, simplicity, and narrow security audit: PASS with no
  blocking findings.
- Final coverage-write audit: PASS. Added explicit regressions for idempotent
  scheduled reclaim, authorityless linked outbox denial, mid-turn song-route
  revocation, and missing scheduled-media route ownership.
- Focused assistant-engine verification: 29 files and 527 tests passed. The
  final cross-path engine matrix passed 111 tests; hosted callbacks passed 195
  tests; CLI automation passed 21 tests; bundle policy passed 28 tests.
- The real hosted runner bundle passed at 1,556,301 bytes for the entry,
  7,852,899 bytes for the static closure, and 9,551,513 bytes total.
- `pnpm verify:acceptance` passed with serial CI-equivalent limits. This
  included 1,073 CLI tests, 2,674 assistant-engine tests (5 skipped), 731 core
  tests, 1,742 assistant-runtime tests (2 skipped), 5,866 web tests (148
  skipped), 1,842 Cloudflare tests, and 204 fixture scenarios.
- Remaining external gates are ReviewGPT round 5 on the exact pushed head and
  the required GitHub CI checks.
Status: completed
Updated: 2026-07-19
Completed: 2026-07-19
