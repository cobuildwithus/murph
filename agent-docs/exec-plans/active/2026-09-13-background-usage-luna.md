# Reduce scheduled background model usage

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

- Ship the immediate source-supported background usage reductions: bounded canonical meal selection and Luna for managed Journal passes. The broader deterministic Journal design remains deferred.

## Success criteria

- Empty managed meal closeouts have zero model calls, using a bounded canonical query.
- Preserve private ownership, notices, opt-outs, corrections, cancellations and pending follow-ups.
- Both managed Journal passes and existing active records use Luna through the existing target override. Ordinary conversation preferences remain unchanged.
- Focused tests, typechecks, real-model proof, parent review, final ReviewGPT and exact-head CI support the PR.

## Scope

- In scope: Journal morning/afternoon Luna routing, SQL-bounded meal selection for the existing empty-work gate and closeout CLI, owner docs, synthetic tests and changelog.
- Deferred: model-free Journal reconciliation, bounded classification-only Luna, and typed fixed reminders. Existing connected-source collection and free-form ledgers do not provide the typed complete-evidence and correction contracts needed to claim those paths are safely deterministic.
- Out of scope: production mutations, merge/deploy, unrelated model preferences, populated meal interpretation, weekly synthesis and unrelated product policies.

## Constraints

- Reuse canonical, connected-app, provider, cron, usage and outbox owners. Do not invent provider capabilities or parallel state.
- Bound scans, calls, retries and model input/output. Preserve useful behavior and unresolved legacy work.
- Use synthetic evidence only. Keep one completion owner in this session.

## Product UX

- Outcome: useful private Journal updates and reminders consume less background inference.
- Entry and promise: scheduled occurrences process authorized work and stay quiet when nothing useful is due.
- Journeys: empty meal closeout, historical pending photos, same-occurrence cleanup retries, modified instructions, invalid time/read failure, and Journal notice/calendar/email interpretation on Luna.
- Proof: actual cron/model-entry suppression, query readback and retry ordering, zero-call empty paths and focused synthetic Luna journeys.
- Done when: useful changes remain correct and uncertainty cannot produce unsafe effects.

## Risks and mitigations

1. Partial or legacy evidence mistaken for emptiness: require complete evidence and preserve unresolved obligations.
2. Model mistakes causing effects: preserve the existing Journal instructions and tool boundaries, and verify focused real Luna journeys. Classification-only output remains deferred.
3. Duplicate or lost updates: canonical revision/source identity, tombstone handling and existing recovery boundaries.
4. Mixed-version skew: document and prove actual reader/writer compatibility.

## Tasks

1. Obtain ReviewGPT's apply-ready patch against the current snapshot.
2. Inspect and integrate it, resolving source-proven gaps locally.
3. Run focused deterministic tests and typechecks, then applicable real-model proof.
4. Review the diff, update durable docs/changelog, and open a scoped PR.
5. Complete final ReviewGPT and exact-head CI.

## Decisions

- User authorized implementation, an apply-ready ReviewGPT patch and PR creation.
- The full ReviewGPT implementation failed and its workspace could not be recovered. A small returned routing patch was inspected and applied; deterministic meal selection and admission were implemented locally. The PR explicitly does not claim the complete Journal redesign.

## Verification

- Baseline: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-journal-connected-context-eligibility.test.ts` passed all 20 tests before implementation.
- Baseline: `pnpm --dir packages/assistant-engine typecheck` passed before implementation.
- Baseline: `pnpm --dir packages/assistant-engine build` passed, including emitted package-reference boundaries.
- Baseline: the opt-in `automation edit: complete first provider input` scripted-runtime measurement passed for direct and group fixtures: 167221 and 153260 UTF-8 bytes respectively, excluding `prompt_cache_key`. The existing measurement does not provide exact model-token counts. Repeat if the returned patch changes the shared automation tool or prompt surface.
- Dependency installation completed with the frozen lockfile.
- The first ReviewGPT implementation request failed with `Thinking failed` before producing an attachment. Recovery confirmed its workspace was lost. A subsequent bounded request returned the Journal routing patch that was inspected and applied.
- Implemented the narrow routing patch and deterministic empty-meal admission. All 321 focused assistant tests, the 10,000-meal query test, two existing closeout CLI regressions, and affected query/vault-usecases/assistant-engine typechecks passed. Real Luna journeys and completion gates are in progress. No production changes.

- Emitted assistant-engine build, 10 changelog tests, and complexity guard passed. Default-subscription Luna journeys failed authentication before provider actions; authorized alternate-home validation is in progress. Final review and CI remain pending.

- Base reconciliation: #3402 independently landed the empty-meal cron gate while this task was open. Reused that gate and its stronger scheduled-only, read-failure retry tests unchanged, removing our duplicate gate and tests. This PR now adds bounded SQL selection and Luna routing on top.
- Live notice passed on an authorized alternate subscription. Calendar proof had a stale event-end timing assertion and email proof counted CLI help as a write. Corrected only these fixture assertions using the existing help classifier and exact promised hour-after-event instant; rerunning on the same subscription.

- After base reconciliation: 325 focused assistant tests, one large-selection query test, two closeout CLI regressions, and all three affected typechecks pass. The source gate and cron lifecycle match the current base; only SQL selection changes beneath them.

- The corrected calendar run exposed the ambiguous event-time instruction: Luna sometimes chose the event end instead of one hour later. Clarified the existing skill to use event end plus one hour, with a concrete timezone example; seven focused connected-app prompt tests pass.
- Parent reply review found that the email fixture accepted an invalid delivery decision. Journal live fixtures now use scheduled production tool admission (finish-without-reply disabled), consistent occurrence/timezone context, and the real notification decision parser. Three focused journeys are rerunning on the same authorized Luna subscription. Latest assistant typecheck passes.
