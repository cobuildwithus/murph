# Reduce scheduled background model usage

Status: completed
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

- In scope: Journal morning/afternoon Luna routing, SQL-bounded meal selection for the existing empty-work gate and closeout CLI, host-computed Journal calendar bounds, owner docs, synthetic tests and changelog.
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

- Production-aligned live runs returned send decisions for routine captures, exposing a gap between the skill finish rule and the existing silent-save product contract. Replaced that ambiguous finish rule with explicit silent-save behavior while preserving notices, necessary clarification, and unresolved due check-ins. Focused prompt proof and the latest typecheck pass; the two affected live cases are rerunning.

## Current verification

- PR: https://github.com/cobuildwithus/murph/pull/3405
- Earlier calendar failures did not establish a production model failure: the fixture declared scheduled automation unavailable despite exposing its port, and its CLI fabricated success for invalid writes. The previous recommendation to require a full deterministic rewrite before completing this PR was unsupported by that evidence.
- Corrected capability declarations, login-shell fixture setup, and canonical CLI effects. The deterministic contract proves ledger readback across the CLI boundary, actual note creation, help without mutation, and rejection of unknown commands. Current assistant typecheck and complexity guard pass.
- Luna high on local subscription passes the new-account notice, excluded pre-feature baseline, global opt-out, calendar capture and grouped email travel scenarios. Assertions inspect canonical notes, ledger pages, hosted automation records, exact follow-up timing and linkage, privacy, and scheduled delivery decisions. The afternoon repeat preserved plan and follow-up identity but exposed a 38-hour provider window. The cron host now supplies exact 36-hour UTC bounds from the scheduled occurrence; focused offset/DST and composed cron tests pass. The strict live morning/afternoon replay now passes both exact windows, the linked reminder time, preserved identities, privacy, and silent decisions. Product UX: Ready for the scoped change.
- These are synthetic provider responses with real local effects. The agent still performs multiple tool steps and can recover from rejected arguments; this evidence is neither a deterministic Journal redesign nor a measured dollar-savings claim.
- Existing owner, query, closeout, prompt, changelog and emitted-build proof remains green. Parent candidate review passes the final bounded-time correction. Final ReviewGPT and required ready-state CI remain outstanding. No merge or deployment.

- Final candidate proof: all five Luna scenarios (six turns) pass; 308 focused managed/cron/prompt tests, the canonical CLI fixture contract, current assistant typecheck/build and complexity guard pass. The two complete ordinary direct/group provider-input captures remain exactly 167221/153260 UTF-8 bytes, matching baseline; no exact model tokenizer is configured. Final review and CI are next.

## Final review and closeout

- Final ReviewGPT round 1: PASS on `5b6791fc438b9bd91d7b738683e50cfe68952ccc`, GPT-6 Pro, Eragon lane, 372 seconds. The exact turn, response hash, and model attestation agree. The full 17-file audit found zero qualifying bugs or Complexity Collapse opportunities; zero findings were accepted or rejected and no remediation was needed.
- The reviewer independently exercised the production SQLite selector with 10,007 records and the calendar-window helper with offset, daylight-saving and invalid-input cases. It did not claim to rerun the full workspace or live subscription journeys. Parent final review agrees with the scoped result and confirms privacy, canonical ownership and useful success paths.
- Review context: full sensitive snapshot, first/current/context-anchor head all equal the reviewed head, no previous head, and empty remediation deltas. The managed tool removed its uploaded ZIP after capture; metadata was reconstructed with the same head and invocation and checked against the reviewed 17-file/805-line scope.
- The closure commit changes only this historical plan. It qualifies for the explanatory-doc exemption from another substantive review. Completed CI checks on the reviewed head passed; four package coverage jobs were still running at closeout. Required CI must pass on the final PR head before handoff; the PR body owns that final gate result.
- Current-base merge-tree proof was clean against verified `fe2170b73aa858f21689a99d1c01ba00d5a88ec6`. No production mutation, merge or deployment was performed. The broader deterministic Journal pipeline remains deferred; this change supplies bounded meal selection, Luna routing and deterministic calendar timestamps.
Completed: 2026-09-13
