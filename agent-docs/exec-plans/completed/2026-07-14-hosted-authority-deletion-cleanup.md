# Hosted Authority Deletion Cleanup

Status: completed
Created: 2026-07-14

## Goal

Delete obsolete hosted preference and Linq route-authority machinery while preserving current inbound replies, canonical delivery identity, and current-home automation behavior.

## Proven cleanup targets

- The hosted preference causal-sequence loopback endpoint and client have no production caller. The private direct style tool receives the runtime-owned causal sequence directly at the provider accepted-input boundary.
- `createAssistantPreferenceMutationState` is unused after the canonical companion-state split.
- One maintenance test still fabricates grouped foreground input that the production selector can no longer produce.
- Background recovery hydrates the pending-input index before selecting one item. Bounded prefix progress would require new persisted cursor or continuation state because the index is not globally append-sorted, so this cleanup will not add that machinery without a measured failure.

## Compatibility gates

- Delete runner-side `currentInbound` after proving it is invocation-local and
  absent from assistant inputs, outbox intents, delivery effects, and workspace
  checkpoints. Keep only the Web parser during the old-bundle rollback window.
- Delete the latest-100 mailbox scan only after canonical answered mailbox ids cover every retained reply intent.
- The route-transition proof producer remained behind a default-off flag. Delete the unactivated producer/repair pipeline; retain only strict restore parsing for snapshots that may already contain the retired field. Stale legacy scheduled routes may fail closed instead of being rewritten, while current-home routing and reply-anchored delivery remain.

## Plan

1. Remove the dead preference loopback endpoint/client/types/tests and stale documentation.
2. Remove unused helper/test residue.
3. Delete the invocation-local runner `currentInbound` proof after proving no
   persisted intent or retry can depend on it; retain only old-bundle Web parsing.
4. Inspect each remaining Linq compatibility path; delete only those that pass their removal gate, and leave measured-risk candidates alone when deletion would require replacement machinery.
5. Run focused owner tests/typechecks, required audits, diff-aware verification, commit, push a PR, and complete the review loop.

## Verification

- Hosted execution parser/bridge tests: 60 passed; typecheck passed.
- Assistant engine and runtime focused selection/maintenance/bridge tests passed;
  both package typechecks passed.
- Core focused tests passed; typecheck passed.
- The restore-only legacy metadata fixture and accepted-input causal-sequence
  lifetime test both passed.
- The final assistant runtime callback/mailbox/workspace selection covered 431
  passing tests; one unrelated five-second scheduling assertion passed on its
  exact isolated rerun. Cloudflare typecheck passed after the runner request
  field deletion.
- Web typecheck passed after Prisma generation; the complete Web Vitest workspace
  passed with 4,960 tests and 135 skips.
- `pnpm test:diff` passed all syntax, architecture, dependency, boundary, and
  affected-package typecheck gates. Its parallel package-test phase exposed
  three load-sensitive timing failures outside the changed paths; exact isolated
  reruns passed, including the preference stress case with a 180-second harness
  timeout instead of its default 60-second ceiling.

## Decisions

- Delete the dormant route-transition producer, repair mutation, CLI, runtime
  prioritization/barrier, configuration, rollout docs, and dedicated tests as one
  feature rather than preserving partial machinery.
- Accept and discard the retired input metadata field only while restoring old
  strict snapshots; no current type, producer, or consumer sees its value.
- Delete `currentInbound` from the new runner entirely. It never crossed a
  persistence boundary; Web alone keeps the old request parser so already-running
  old bundles remain compatible during the deployment/rollback window.
- Leave background pending-index hydration unchanged. Bounding it correctly would
  require new persisted continuation state, and no measured failure justifies
  that replacement complexity.
- Stale legacy scheduled routes may fail closed. Current-home snapshots,
  reply-anchored sends, group authority, answered mailbox identities, and live
  Web-side egress authorization remain the active routing model.

## State

Implementation, verification, and completion reviews complete. Security/privacy,
coverage, routing/persistence, and deep-review passes found no remaining
actionable issue in the scoped change.
Updated: 2026-07-14
Completed: 2026-07-14
