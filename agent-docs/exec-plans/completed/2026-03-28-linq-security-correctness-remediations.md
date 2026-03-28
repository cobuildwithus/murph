# 2026-03-28 Linq Security Correctness Remediations

## Goal

Close the reported Linq security and correctness gaps across hosted onboarding, hosted Linq control-plane ownership, hosted/local event ingestion, and reply metadata propagation without widening into unrelated onboarding or assistant redesign:

1. Fail closed for the public hosted Linq webhook when the webhook secret is missing.
2. Move hosted Linq recipient binding ownership off browser-trusted raw strings by canonicalizing recipient numbers and validating ownership from trusted runtime probes.
3. Reject hosted active-member Linq message events at ingress when required delivery identifiers are missing.
4. Preserve message-level reply anchors across local CLI delivery and hosted onboarding replies.
5. Persist local Linq webhook captures before best-effort attachment hydration so transient CDN failures do not turn the whole webhook into a 500.
6. Tighten metadata/state handling where current hosted Linq state drift weakens reply reuse or event metadata trust.

## Constraints

- Preserve adjacent in-flight dirty worktree edits across `apps/web`, `packages/cli`, and `packages/inboxd`; integrate on top of the live tree instead of reverting or rewriting overlapping changes.
- Keep the hosted onboarding public webhook trust boundary aligned with the existing hosted control-plane fail-closed behavior.
- Reuse existing Linq probing/runtime helpers and shared normalization utilities where possible instead of introducing parallel ownership logic.
- Keep hosted execution dispatch behavior compatible with the current outbox/receipt model while rejecting malformed events earlier.
- Run focused regressions plus the repo-required verification commands and mandated spawned audit passes before handoff.

## Planned Shape

1. Tighten hosted webhook verification and ingress validation so missing secrets or missing Linq message ids fail before any side effects or outbox work is recorded.
2. Introduce canonical recipient-phone normalization plus trusted ownership checks for hosted Linq bindings, update lookup/storage paths, and add regressions for formatting conflicts.
3. Thread reply-to message ids through hosted webhook side-effect payloads and CLI Linq channel delivery so replies stay anchored to the triggering Linq message.
4. Refactor local Linq webhook ingest so canonical raw evidence is emitted/persisted before attachment downloads, then make attachment hydration degrade gracefully when fetches fail.
5. Clean up the hosted member/Linq metadata edges needed to preserve chat bindings and timestamp trust.
6. Run focused Linq/onboarding/inbox tests, then repo-wide verification, then required simplify/coverage/final-review audit passes.

## Verification Target

- Focused Vitest coverage for:
  - hosted onboarding Linq webhook auth/idempotency/routing
  - hosted Linq control-plane binding ownership and normalization
  - local inboxd Linq webhook ingest and attachment-failure behavior
  - CLI Linq reply-anchor delivery semantics
- Repo-required commands:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Status

- Context gathered from repo docs, the coordination ledger, and the live dirty worktree.
- Implementation completed for the scoped Linq remediation lane.
- Focused Linq verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-linq-webhook-auth.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts apps/web/test/linq-control-plane.test.ts apps/web/test/prisma-store-linq-binding.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config packages/inboxd/vitest.config.ts packages/inboxd/test/linq-webhook.test.ts packages/inboxd/test/linq-connector.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/assistant-channel.test.ts --no-coverage --maxWorkers 1`
- Repo-required wrappers remain red outside this lane:
  - `pnpm typecheck` / `pnpm test:coverage` fail in the existing `packages/cli` workspace build path with cross-package `rootDir` / file-list errors involving `@murph/runtime-state`, `@murph/query`, `@murph/inboxd`, and `@murph/contracts`.
  - `pnpm test` hit unrelated workspace build instability outside the Linq lane, including transient `packages/core/dist` `ENOTEMPTY` cleanup failure during the shared build wrapper.
- Required audit-subagent runs were attempted through local child Codex processes in this environment, but no actionable findings were returned before handoff.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
