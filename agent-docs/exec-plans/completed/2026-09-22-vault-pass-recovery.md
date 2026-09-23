# Restore scheduled context and pattern capture reliability

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

- Restore reliable scheduled connected context, usable Journal pattern evidence, and truthful completion state. Verify the production assistant boundaries with GPT-6 Sol and a private, isolated vault replay.

## Success criteria

- Journal capture distinguishes actions from subjective outcomes and produces queryable semantic tags without inventing values.
- Pattern notification history preserves identities and mutes while tolerating known incomplete legacy metadata.
- Expired occurrences do not claim successful execution; the next scheduled occurrence advances once after expiry.
- Compaction failures have a demonstrated cause or an explicit remaining provider boundary, with focused recovery proof.
- Private replay and any authorized live repair use canonical writers and readback; no private evidence enters tracked files.

## Scope

- In scope: assistant capture guidance, existing notification ledger, cron completion/recovery, connected-plan reconciliation, canonical repair of affected private records, and missing-source diagnosis.
- Out of scope: new schedulers or memory stores, invented health facts, arbitrary provider mutations, and unsolicited messaging.

## Constraints

- Existing core writers own all canonical mutations. Keep authority and source freshness explicit. Preserve foreground priority, version checks, opt-outs, and delivery idempotency.
- Use synthetic committed fixtures. Keep member replay inputs/results private and outside the repository. Do not change the production model merely to run requested Sol verification.

## Risks and mitigations

1. Compaction failure recovery could replay already-committed tool effects. Preserve native conversation continuity and existing canonical idempotency; never retry arbitrary external writes.
2. Legacy metadata normalization could fabricate history. Missing delivery dates remain unknown and missing grades cannot prove a result reviewed.
3. Private repairs could overwrite newer user edits. Read current canonical state and use exact revision checks before every repair.

## Tasks

1. Trace compaction transport and cron session/expiry ownership; establish bounded production evidence.
2. Add deterministic regressions and smallest fixes for Journal capture, notification history, scheduled context, and completion truth.
3. Strengthen connected-context completion/readback and memory ownership guidance.
4. Run focused tests and typechecks, then production-derived live GPT-6 Sol journeys.
5. Replay the private vault through canonical readers/writers; verify repair effects, investigate missing files, and use supported live repair authority when available.
6. Review the complete diff, document limitations and deployment requirements, close the plan, and create a scoped commit.

## Decisions

- Product UX patch: quiet capture remains quiet; actions and outcomes retain original meaning; delayed maintenance must not send stale follow-ups. Member corrections and current source facts win over stale operational memory.
- Canonical memory remains for member facts and preferences. Connected-source account state belongs in its existing Knowledge ledger.

## Verification

- Focused assistant-engine capture, current-state, ledger, cron, and connected-context tests; affected package typechecks.
- Focused real-Codex journeys using `pnpm test:assistant:live -- --model gpt-6-sol --test <focused-pattern>`.
- Private archive schema, projection, history, and canonical repair readback. No original archive mutation.
- Parent review and applicable completion gates; report local, live-model, live-vault, and deployment proof separately.

## Implementation and evidence

- Canonical/local expiry records a consumed failure, preserves the preceding success, and advances the next occurrence exactly once. The full cron runtime suite passed (246 tests).
- Legacy Pattern rows normalize omitted grade/date metadata to unknown values while preserving identities and mutes. Unknown grades cannot establish that a current graded cell was reviewed.
- Journal guidance separates actions, context, subjective outcomes, and plans; preserves absent intensity; and prevents mixing numeric ratings with verbal levels under one key.
- Connected context reconciles a missing future follow-up after a partial save, preserves disabled/completed history, and keeps operational bookkeeping outside memory.
- Restored the native stream-idle window to 90 seconds. A pinned-Codex HTTP fixture reproduces the exact compaction failure after 30 seconds, then completes after 35 seconds under the restored setting and preserves task state. Native retry ownership and outer attempt limits remain unchanged.
- Scheduled conversation continuity is intentional; no session reset, history truncation, or outer turn retry was added.
- Live subscription verification used GPT-5.6 Sol because the requested GPT-6 Sol model was explicitly rejected by the account. Capture, the Personal Patterns single-finding digest and ledger, partial calendar save/retry, memory maintenance/replay, and native compaction/continuity passed. The compaction sample was small; it does not establish the original production payload's latency tail.
- The actual private archive was replayed outside the repository through canonical writers with revision checks and readback. No private source data, identifiers, or transcripts are committed. A repaired canonical-data example is retained separately; the original export was not modified.
- Assistant-engine and assistant-runtime typechecks passed. Web typecheck passed. The focused changelog rendering suite passed (10 tests). Related deterministic assistant tests passed (136 tests), runtime config checks passed (54 tests), and startup/config selection passed (43 selected tests).
- Complexity diff passed with no increased debt. Independent review checked scheduler anchors, history preservation, capture scales, and native compaction recovery. Parent review retained the existing ownership boundaries.

## Remaining boundaries

- Awaiting the member identifier needed to select the hosted vault safely. Existing Ops authentication works, but no hosted mutation or provider refresh has been submitted without an exact target.
- Missing original source files cannot be reconstructed from absent bytes. Current hosted existence/recovery still needs that target.
- Code is locally verified, not deployed. Longer stream silence can delay transport fallback; the existing 120-second idle-maintenance budget can still interrupt a very slow fallback. No claim of eliminating provider stalls is made.
- The user authorized PR creation and ReviewGPT completion. Implementation and isolated replay are complete; PR #3661 carries the release review and exact-head CI evidence. Deployment and live-vault repair remain separate, unperformed follow-ups.
- Product UX: local/replay proof Ready; live-vault rollout Hold pending target and release verification. Changelog: updated, with source PR attribution is #3661.

## Completion boundary

- Closed for implementation and private replay. Exact-head CI and ReviewGPT results are recorded on PR #3661. No claim of hosted repair, deployment, GPT-6 availability, or recovery of absent source bytes is made.
- Complete native-provider request measurement with identical synthetic direct/group fixtures passed. Individual decoded bytes: 145704 base, 146883 head; group: 136112 for both. Exact target tokenization remains unavailable and is reported as a limitation.
Completed: 2026-09-22
