# Get Cloudflare hosted-local E2E green

Status: completed
Created: 2026-04-28
Updated: 2026-04-28

## Goal

- Make every repo-defined hosted-local E2E command under `apps/cloudflare`
  runnable from a normal local checkout.

## Success criteria

- `pnpm --dir apps/cloudflare test:e2e:local` reaches and passes the full
  hosted-local E2E Vitest suite.
- Individual E2E scripts remain usable without hidden environment overrides.
- Any remaining red command is clearly unrelated to this E2E lane.

## Scope

- In scope:
  - Cloudflare hosted-local E2E scripts and runner-bundle tooling.
  - Directly coupled tests that enforce those scripts.
  - Active hosted-system-mailbox E2E/runtime edits when the full E2E suite
    proves they are the blocker.
- Out of scope:
  - Unrelated Health Commons research files.
  - Unrelated assistant active-turn work.
  - Provider prompt/copy behavior.

## Constraints

- Preserve unrelated dirty work already present in the checkout.
- Avoid exposing local machine paths or personal identifiers in committed
  files or handoff.
- Keep hosted-local fixes deterministic and CI-compatible.

## Risks and mitigations

1. Risk: Serializing bundle builds makes local E2E setup slower.
   Mitigation: only change the runner-bundle build default if the current
   parallel default races package `dist` deletion during normal E2E startup.
2. Risk: Overlapping active hosted-system-mailbox edits hide real failures.
   Mitigation: rerun focused and full E2E checks after any patch and keep
   staged changes scoped.

## Tasks

1. Run the full hosted-local E2E command and identify the first blocker.
2. Patch the runner-bundle or directly failing E2E/runtime slice.
3. Run focused unit/tooling checks for edited files.
4. Run the full hosted-local E2E suite.
5. Run required typecheck/test coverage for the touched owners.
6. Commit only the scoped E2E fix if safe.

## Decisions

- The first blocker is runner-bundle artifact assembly failing before Vitest
  starts because package builds can race while deleting and resolving generated
  `dist` declarations.
- The remaining E2E blockers were hosted Linq cleanup and hosted runtime
  checkpoint/log validation:
  - conversation mailbox import must prepare hosted wake context before local
    inbox import and persist provider-visible Linq message IDs for cleanup
    after commit;
  - assistant phases must drain committed delivery effects and pending provider
    cleanup after workspace checkpoints, including system-mailbox interleavings;
  - provider cleanup retry state must persist the future retry checkpoint on
    delete failure;
  - hosted runtime checkpoint/log status must stay shallow and avoid forbidden
    sensitive key substrings.
- A scoped commit is unsafe from this checkout because the final fix overlaps
  another active hosted-system-mailbox row in `workspace-assistant-phase.ts`,
  its focused test, and the Linq first-contact E2E file.

## Verification

- Passed:
  - `pnpm --dir apps/cloudflare test:e2e:local` -> 4 files, 12 tests.
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-mailbox-conversation-import.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-provider-cleanup.test.ts test/hosted-runtime-events.test.ts test/hosted-runtime-maintenance.test.ts --no-coverage` -> 5 files, 49 tests.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/run-hosted-local-e2e.test.ts apps/cloudflare/test/runner-bundle-workspace-artifacts.test.ts apps/cloudflare/test/container-image-contract.test.ts --no-coverage` -> 2 files, 17 tests.
  - `pnpm --dir packages/assistant-runtime build`.
  - `pnpm typecheck`.
  - `git diff --check`.
- Required audits:
  - `simplify` found duplicated post-checkpoint delivery/provider cleanup; fixed with a shared helper.
  - `security-privacy-review` found a system-mailbox/provider-cleanup interleaving; fixed and rechecked clean.
  - `coverage-write` made no edits and judged coverage adequate.
  - `task-finish-review` found provider cleanup retry state persisted the old checkpoint; fixed with a retry-checkpoint regression.
Completed: 2026-04-28
