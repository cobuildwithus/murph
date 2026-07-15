# PR 623 ReviewGPT Lifetime Fixes

## Goal

Resolve the accepted ReviewGPT lifetime findings and the deterministic assistant
prompt budget failure on PR 623 without adding another owner or mechanism.

## Root Causes

- Invocation-local usage recording starts after reply delivery and checkpointing,
  but normal runner completion can clear its active fence before that bounded
  write settles.
- Snapshot abort and error cleanup validate at route entry, then may cross an
  asynchronous session, object, or web boundary before mutating R2 or cleanup
  state under a replaced fence.
- A main-branch group-offer wording change expanded the stable prompt 18 bytes
  beyond its existing budget.

## Constraints

- Await only the current invocation's already-existing deferred usage capture
  before returning normal runner completion; do not use the process-global drain.
- Keep reply handoff and idle checkpoint ahead of usage completion.
- Revalidate the existing active snapshot write fence at each cleanup phase;
  retain cleanup obligations for the existing UserRunner alarm when stale.
- Add no state, queue, retry, token, identity source, service, dependency, or
  cleanup mechanism.
- Fix the prompt budget by deleting redundant wording while preserving the exact
  `Like this message` group-offer contract.

## Working Set

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts`
- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`

## Verification Plan

- Focused assistant prompt, runtime deferred-usage, and Cloudflare snapshot tests.
- Truthful owner coverage/typecheck through repo scripts with the shared-host profile.
- Required prompt review for the wording deletion and coverage review for the
  behavior-bearing fixes.
- Parent final diff and lifetime-boundary review.
- Rebase on freshly fetched `origin/main`, push, start ReviewGPT immediately with
  CI, and continue until zero accepted findings and green checks.

## Completed Evidence

- Focused Cloudflare snapshot-route tests: 192 passed.
- Focused hosted-runtime workspace-entrypoint tests: 208 passed.
- Focused assistant prompt/model-behavior tests: 63 passed.
- Assistant-runtime owner coverage: 73 files, 1,635 passed, 2 skipped.
- Assistant-engine owner coverage: 150 files passed, 1 skipped; 2,168 tests
  passed, 4 skipped.
- Assistant-engine, assistant-runtime, and Cloudflare owner typechecks passed.
- Prompt review passed with the stable system prompt at 60,994 characters.
- Coverage review identified one missing stale completion-session proof; the
  focused route test was added and passed without another production mechanism.
- Security/privacy review found no Critical, High, or Medium issue and no
  remaining invariant violation.
- Full Cloudflare verification passed: typecheck, 104 Node test files with 1,802
  tests, and the Workers test file/test.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
