# Recap writing flex capacity budget

Status: completed
Created: 2026-11-12
Updated: 2026-11-12

## Outcome and owners

Only the trusted recap show writer uses Flex, with a twenty-minute capacity
budget from its first provider attempt. The existing system mailbox owns durable
retry and backoff; Web's lifecycle receipt, generation identity and recovery own
publication and delivery. Image/song provider settings, prompts and cache
retention stay unchanged.

Inspection found that show notifications discard isolated native resume state and
that any failure currently seals a template or retires a remake. Flex capacity failure
must instead preserve the pending notification and its native thread. Reuse the
assistant session store for an unbound per-generation execution session: its
creation time owns the budget and its existing Codex binding owns continuation.
The room's session, delivery route and transcript remain authoritative for context
and delivery. Existing session snapshot validation and rollout retention apply.
No database migration, new scheduler or in-process capacity wait is needed.

## Verification and review

Prove initial Flex selection, ordinary-turn isolation, durable retries at and
around twenty minutes, native continuation with per-attempt media authority, canonical
recovery, slow-generation abort behavior and usage pricing on both tiers. Run
focused package tests and typechecks, inspect the full diff and complexity report.
No live provider calls. The original handoff was local-only. The parent rebased
and pushed PR #4906 at `a691fb3c01`; this follow-up addresses its accepted round-1
ReviewGPT finding in a new local commit for the parent's round-2 delta review.
No push or PR mutation is part of this follow-up.

## Product journeys

Leo and Ava receive the existing recap once after immediate capacity, transient
capacity, or standard fallback. An accepted recap is replayed without more model
or media work. The budget does not interrupt active generation. Remakes retain
their exact generation identity. Changelog: not applicable. This changes internal
provider economics and preserves the existing recap outcome under the newly
selected tier; it adds no member controls, content format or visible billing rule.

## Progress

- Implemented Flex selection only for show notifications, durable capacity
  retry, per-generation native continuation and standard fallback at the budget.
- Parent review bounded capacity retries to Flex attempts. The first attempt at
  or after twenty minutes uses standard service; a standard-tier capacity failure
  invokes the existing failed-recap read, publishing the canonical template for
  an initial recap or retiring a remake while preserving its prior recap. The
  mailbox has no attempt cap, so rethrowing standard capacity errors would extend
  the owner's capacity budget indefinitely. The boundary test now succeeds on
  the first standard attempt using the same thread; focused initial
  and remake cases prove `recapRead.failed` settlement without a retry rethrow.
- Preserved canonical recovery before provider work and the room's session for
  delivery. Missing or incompatible continuation uses existing recap failure
  recovery instead of starting another provider thread.
- Preserved pricing evidence for capacity refusals without token counters on
  both tiers. Tests use real usage extraction, recording and distinct turn IDs;
  accepted recovery performs no further provider or media work.
- ReviewGPT round 1 HIGH finding: accepted and fixed by deletion. The added
  durable media provenance receipts were inside the writer-writable vault and
  therefore could not authenticate source dependencies. Removed the receipt
  schema, state-file readers/writers and their persistence tests. Restored
  `recap-files.ts` and the per-turn `recapSources` map in `hosted-tool-context.ts`
  exactly to `origin/main`. Native thread continuation and all Flex policy and
  accounting remain. A new attempt rejects media generated in an earlier
  failed attempt, including audio with song timing; it must regenerate the media
  it submits. This consequence is owner-accepted. Accepted recap recovery still
  avoids additional provider work. Image/song provider settings are unchanged.
- Checked hosted limits: the default processing command budget is twenty
  seconds, while the ten-minute container lease is post-completion warmth.
  Active work keeps the container alive. Checkpoint ownership is fenced by
  attempt, generation and workspace version. Capacity waiting uses existing
  durable mailbox re-wakes, so no invocation must sleep for twenty minutes.
  The existing ten-minute provider Flex abort is bypassed only for show writing.
- Parent candidate review passed: scoped diff, unchanged provider contracts and
  dependencies, existing snapshot retention, pricing, privacy and complexity.
  No schema migration or separate activation gate is required. Older code can
  read the existing session schema; rollback would restore the previous recap
  tier and failure behavior. No deployment or rollback was performed.

## Local verification results

All commands below passed. Provider execution was stubbed; fixture media and
native rollouts were synthetic. No private runtime evidence was used.

```sh
pnpm build:test-runtime:prepared
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/assistant-runtime typecheck
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts test/assistant-codex-final-coverage.test.ts test/assistant-codex-turn-planning.test.ts test/assistant-codex-runtime-config.test.ts test/assistant-codex-failures.test.ts test/assistant-automation-support.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/codex-runtime-helpers.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/recap-media-files.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/recap-media-files.test.ts test/assistant-service-runtime.test.ts test/assistant-notification-turn-runtime.test.ts
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-game-recap-notification.test.ts test/hosted-runtime-system-mailbox-notification.test.ts
pnpm --dir apps/web exec vitest run --config vitest.config.ts test/hosted-execution-usage-allowance.test.ts test/hosted-execution-usage.test.ts
pnpm --dir apps/web exec vitest run --config vitest.config.ts test/game-chat-lifecycle.test.ts
pnpm complexity:diff
pnpm docs:drift
git diff --check
```

Test totals: engine six-file selection 483; provider helpers 83; runtime 213;
Web usage/pricing 186; Web lifecycle 61; media/checkpoint proof 7. After the continuation helper refactor,
the three changed engine suites passed again (327 tests). After strengthening
usage-ID proof, the notification suite passed again (118 tests), followed by
engine typecheck. Runtime tests and typecheck passed after the retry refactor.
Before the round-1 finding, after versioning the media receipts, media, hosted-tool-context and notification
tests passed together (195 tests), followed by engine typecheck. The prepared
runtime build, runtime typecheck, complexity and documentation guards passed on
that candidate. The cross-attempt media-reuse proof is superseded by the
round-1 fix and the rejection/regeneration proof described above.

Parent-review amendment reran all focused files: notification 120, remaining
eight engine suites 525 (645 total), runtime 213, and Web usage/pricing/lifecycle
247. Both assistant package typechecks, the prepared runtime build,
`complexity:diff`, `docs:drift`, and `git diff --check` passed. The notification
suite proved standard success at exactly twenty minutes; the old media-reuse
assertion is superseded by the round-1 fix. It also proved
both initial and remake settlement after standard capacity failure. The grouped
test commands for this amendment were:

```sh
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-final-coverage.test.ts test/assistant-codex-turn-planning.test.ts test/assistant-codex-runtime-config.test.ts test/assistant-codex-failures.test.ts test/assistant-automation-support.test.ts test/codex-runtime-helpers.test.ts test/recap-media-files.test.ts test/assistant-service-runtime.test.ts
pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-game-recap-notification.test.ts test/hosted-runtime-system-mailbox-notification.test.ts
pnpm --dir apps/web exec vitest run --config vitest.config.ts test/hosted-execution-usage-allowance.test.ts test/hosted-execution-usage.test.ts test/game-chat-lifecycle.test.ts
```

Initial setup needed `pnpm install --frozen-lockfile`. The first Web test attempt
failed because the generated Prisma client was absent; the next-best setup was
`MURPH_PRISMA_SKIP_ENV_FILES=1 pnpm --dir apps/web prisma:generate`, which passed
without reading env files or connecting to a database. Web tests then passed.
A new fixture initially failed engine typecheck because its hosted tool context
was incomplete; completing the synthetic context fixed it. The initial complexity
check found increased debt in existing large functions; extracting focused retry
and continuation helpers resolved it without increasing hotspot debt.

## Handoff limits

Round-1 remediation verification passed: updated notification/media suites 127,
remaining seven engine suites 518 (645 total), runtime 213, Web pricing/lifecycle
247. Both assistant package typechecks, `build:test-runtime:prepared`,
`complexity:diff`, `docs:drift`, and diff/privacy checks passed. A direct diff
against `origin/main` confirms both affected production media files match it
exactly, with no receipt reader, writer, schema or state-file path remaining.
The engine test invocations for this delta were:

```sh
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts test/recap-media-files.test.ts
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-final-coverage.test.ts test/assistant-codex-turn-planning.test.ts test/assistant-codex-runtime-config.test.ts test/assistant-codex-failures.test.ts test/assistant-automation-support.test.ts test/codex-runtime-helpers.test.ts test/assistant-service-runtime.test.ts
```

Runtime and Web used the grouped commands recorded above. The media proof now
rejects earlier-attempt files despite their continued presence, then accepts
audio after a second synthetic provider request in the new attempt. Native
thread continuity, Flex-to-standard selection, terminal standard capacity
settlement, and usage pricing remain covered independently.

No live Flex, media or hosted invocation was run. The local proof covers tier
selection, null resets, capacity classification, budget boundaries, native
resume planning, actual rollout retention and per-attempt ledger inputs; it does
not prove live capacity availability or production delivery. Exact-head CI and
round-2 ReviewGPT remain with the parent's pushed-candidate workflow.
This follow-up ends with a new local scoped commit, without amending the reviewed
head, pushing, or changing the PR.
Completed: 2026-11-12
