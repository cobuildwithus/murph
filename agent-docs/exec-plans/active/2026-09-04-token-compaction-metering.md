# Meter compaction from provider usage

Status: active
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Replace estimated hosted idle-compaction allowance accounting with provider-reported token buckets when pinned Codex exposes them. Preserve attribution to the warm thread's bound model and tier.

## Success criteria

- One idempotent ledger record per measured provider operation; no concurrent estimate.
- Older and cold-resumed threads retain their current estimate behavior when raw usage is unavailable.
- Provider replies and compaction thresholds remain unchanged; malformed or unavailable usage never becomes invented token counts.
- Focused parser, native configuration/runtime, and accounting tests pass with affected typechecks and parent review.

## Scope

- In scope: existing app-server notifications, usage record builder, and idle accounting.
- Out of scope: automatic compaction accounting, threshold changes, historical ledger adjustment, deployments, merges, other token optimizations.

## Constraints

- Technical constraints: Codex 0.151.0 remote-v2 compaction emits `rawResponse/completed` when `thread/start` opts into experimental raw events. Cold resume cannot enable that option; remote-v1 and malformed remote-v2 completions may not expose usage. Reuse the existing usage transport and ledger deduplication.
- Product/process constraints: provider responses must not retry or fail because telemetry fails; preserve member authority, privacy, and foreground priority.

## Risks and mitigations

1. Double charging or omitted usage. Choose measured rows or the existing estimate in the same runner owner; no new Worker capability switch. Prove next-turn exclusion with the pinned binary.
2. Provider usage or metadata changes. Parse bounded provider shapes with strict numeric validation and content-free diagnostics; verify native pinned metadata.
3. Automatic compaction has different native accounting paths. Leave automatic remote-v2 metering as an explicit preexisting follow-up; do not attach its responses to idle maintenance.

## Tasks

1. Trace native raw notifications, existing ledger, and warm configuration identity.
2. Capture idle responses by exact thread, compaction turn, and response identity.
3. Prove exact accounting, duplicate/retry isolation, failures, and legacy fallback.
4. Review the full candidate, run focused checks, and create a draft PR for parent review before Ready and concurrent ReviewGPT/CI.

## Decisions

- The existing Web usage ledger remains authoritative; no new durable state, reconciliation queue, or historical mutation.
- The legacy estimate is a token estimate, not a lower bound on provider dollar cost.
- Exact idle debits can increase or decrease; this is accounting accuracy, not a guaranteed spend reduction.
- Pinned upstream proof: `codex-rs/core/src/compact_remote_v2_attempt.rs` emits usage after validated completion; `app-server/src/bespoke_event_handling.rs` maps it to the typed raw notification. `core/src/compact_remote_v2.rs` records rollout-budget usage separately from turn counters. Local/custom compaction updates turn counters instead. None of these automatic paths is changed here.
- Provider model/tier metadata is not present on the pinned raw notification. Existing bound-thread model/tier attribution remains authoritative; no served-model claim is added.
- Raw provider payload items are excluded from stdout and persisted JSON events; only the bounded token-bucket projection enters maintenance accounting.

## Verification

- Focused engine parser/process tests, hosted-execution usage tests, assistant-runtime config/idle tests, affected typechecks, pinned-Codex provider-shape proof, complexity diff.
- Expected outcomes: measured token buckets and exact identities, unchanged provider payload/result semantics, legacy compatibility, no duplicate estimate.
- Passed: pinned Codex 0.151.0 synthetic-provider config/compaction tests (48 passed, 2 unrelated auth tests skipped), including measured fresh-thread usage, cold-resume estimate fallback, and a next foreground turn containing only its own 300 input/80 output tokens.
- Passed: engine parser/process assertions (53), idle accounting assertions (39), hosted usage ledger assertions (26), changelog archive rendering assertions (9), and engine/runtime/hosted-execution typechecks.
- Focused engine/runtime `test:coverage` runs passed their assertions but failed package-global thresholds because the selected tests do not exercise unrelated package files. Required CI remains the broad coverage gate; these commands are not reported as green.
- Complexity guard passed: engine debt unchanged; idle-maintenance maximum complexity reduced from 49 to 44. Parent candidate source/privacy review passed.
- Web `pnpm --dir apps/web typecheck` is blocked by the unchanged `test/device-sync-hosted-runtime-authority.test.ts:2` import of `@murphai/device-syncd/service`: its local built declaration is absent and the Web source aliases omit that subpath. Import and export match current main. Next-best validation is the passing changelog archive test; no unrelated source edit was made.
- Draft PR: #2865. Required CI, final ReviewGPT, and plan closure remain with completion. `git merge-tree --write-tree HEAD origin/main` passed against the refreshed base.

## Product UX

- Outcome: more accurate allowance debits for idle conversation summaries when native usage is available; no savings promise.
- Reaches: existing personal and group idle-maintenance accounting. Older/cold-resumed threads retain estimates. Automatic compaction is excluded.
- Proof: native pinned-runtime completion and next-turn isolation; ledger bucket and identity tests; failed-operation and telemetry-failure tests. No new controls or conversation flow.
- Changelog: `more-accurate-idle-summary-usage`; ordinary content-only archive presentation.
