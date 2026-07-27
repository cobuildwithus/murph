# Truthful hosted group reply latency outcomes

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Integrate and simplify the returned Pro patch so the hosted reply-latency
  monitor distinguishes durable intentional group silence from genuinely
  unresolved work and keeps grouped reply-to-inbound linkage complete.

## Success criteria

- Durable terminal non-reply evidence grants bounded checkpoint grace without
  pretending that a delivery occurred or advancing mailbox consumption early;
  `consumed_at` must take over before grace expires.
- Grouped/rebatched replies retain every answered mailbox item needed for
  accepted-delivery trace linkage.
- Invalid chronology, failed projection, and genuinely unprocessed work remain
  alertable.
- No new persisted state owner or database migration is introduced.
- Focused owner tests, canonical verification, completion reviews, and the
  final pushed-head gate pass.

## Scope

- In scope: assistant suppression evidence, grouped outbox coverage,
  hosted-runtime diagnostic milestone transport, latency trace projection and
  monitor interpretation, focused tests, and current runtime/testing docs.
- Out of scope: alert thresholds, mailbox checkpoint timing, provider delivery
  semantics, early mailbox consumption, new monitoring services, and unrelated
  hosted wake or orchestration changes.

## Constraints

- Keep durable assistant suppression evidence as the source of truth.
- Treat latency milestones as replayable diagnostics only.
- Preserve terminal outbox immutability and monotonic active-intent coverage.
- Keep observability writes best effort so they cannot break canonical reply
  completion.
- Prefer deleting or collapsing returned patch machinery when an existing
  owner can derive the same fact.

## Risks and mitigations

1. Risk: a marker reaches Web before its local evidence survives a runner
   crash.
   Mitigation: project only committed local suppression evidence, reject
   impossible timestamp chronology, and reopen the trace unless durable
   consumption arrives within the normal checkpoint horizon plus buffer. Let a
   genuinely newer post-recovery commit refresh grace while stale replay keeps
   its original timestamp, preserving that timestamp per input when recovery
   repairs more than one suppression partition.
2. Risk: grouped reply rebatching drops earlier answered items.
   Mitigation: monotonically union coverage only while the outbox intent is
   pending or retryable, then freeze it when provider dispatch starts so later
   inputs remain honest follow-up work.
3. Risk: runtime/web deploy skew rejects the additive diagnostic marker.
   Mitigation: keep the projection best effort and document the safe deployment
   order and post-deploy proof.
4. Risk: the returned cross-package patch is larger than the requirement.
   Mitigation: inspect every owner transition, remove unnecessary seams, and
   require the final ReviewGPT gate.

## Tasks

1. Apply and inspect the returned patch against the current branch.
2. Reduce the implementation to the smallest existing-owner data flow.
3. Run focused tests and canonical diff-aware verification.
4. Run product-experience review where the alert/recovery contract changes.
5. Push a review candidate, run the preliminary specialist pass, resolve
   findings, complete parent final review, close this plan, and run the final
   ReviewGPT gate with CI.

## Verification

- Focused owner suites for latency monitoring, assistant automation/outbox,
  hosted maintenance, and runtime-control parsing.
- Canonical `pnpm test:diff` over every changed source, test, and durable-doc
  path.
- Direct scenario proof that committed silence receives bounded grace before
  delayed checkpointing, expired-unconsumed or invalid evidence reopens, durable
  consumption stays healthy, and stale replay cannot extend grace.
