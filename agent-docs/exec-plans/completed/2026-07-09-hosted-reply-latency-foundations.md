# Hosted reply latency foundations

Status: completed
Created: 2026-07-09
Updated: 2026-07-09

## Goal

- Make hosted reply latency measurement truthful and remove proven median-path work before Codex begins a turn.
- Preserve durable mailbox, access, usage-gate, replay, and runtime-attempt authority while simplifying the hot path.

## Success criteria

- Post-generation Linq delivery work cannot create or overwrite the provider-start milestone.
- Provider milestones cannot be merged across different runtime attempts.
- The latency trace distinguishes Linq typing request/acceptance, local Codex turn start, and first locally observed Codex output/text without implying an upstream OpenAI request or token boundary.
- The major pre-provider phases identified by the audit have metadata-only timings without adding synchronous observability writes.
- A foreground hosted invocation does not perform separate conversation and pre-assistant system mailbox fetches when one authorized fetch can return both lanes.
- Mailbox sequence/item projections use the smallest consistent query shape while preserving callback replay protection, active access, read-first usage gating, and per-lane ordering.
- Duplicate pre-provider maintenance/diagnostic work is removed or reordered only where existing owner contracts prove it is nonessential to reply admission.
- Focused regressions, required typecheck/coverage, security/privacy review, parent final review, PR ReviewGPT loop, and final PR CI all pass with no unresolved accepted findings.

## Scope

- In scope:
  - Hosted ingress/runtime latency trace semantics and metadata-only phase coverage.
  - Runtime-attempt binding for provider milestones.
  - Hosted mailbox fetch/query consolidation for the foreground conversation and system lanes.
  - Proven duplicate pre-provider work and typing placement on the existing reply route.
  - Focused tests and durable protocol/verification documentation when behavior or measurement contracts change.
- Out of scope:
  - Racing the best-effort direct wake ahead of Temporal acceptance.
  - Receipt/outbox laziness or retention changes.
  - Fresh-attempt retry-policy, container lifecycle, linger, fence, or snapshot-size changes.
  - Background Codex respawning and speculative process lifecycle machinery.

## Constraints

- Technical constraints:
  - Temporal acceptance remains the durable wake authority; direct wake ordering is unchanged.
  - Web remains the mailbox and trace authority; Cloudflare remains a thin runner; assistant owners emit only milestones they actually observe.
  - No raw messages, prompts, response bodies, identifiers, secrets, or local paths enter telemetry.
  - Observability remains queued/fire-and-forget off the user-visible reply path.
  - Callback replay protection, active member access, read-first usage gating, mailbox ordering, `consumedAt`, and at-most-once delivery invariants remain intact.
  - Prefer deletion, one request, one projection, and existing phase/event seams over new state, managers, queues, or compatibility layers.
- Product/process constraints:
  - Work in the isolated `codex/hosted-reply-latency-foundations` branch and open a PR.
  - Run the repository-required specialist audits and the PR ReviewGPT loop to completion.
  - Discuss tail work only after this PR is complete; do not implement recommendation #3 here.

## Risks and mitigations

1. Risk: telemetry milestones continue to imply upstream generation when they only prove a local lifecycle event.
   Mitigation: name each milestone by the exact observed boundary and keep derived dashboard labels explicit.
2. Risk: consolidating mailbox reads weakens access, usage, replay, or ordering guarantees.
   Mitigation: keep those gates at the existing web owner and add focused route/store/runtime regressions for blocked, replayed, and multi-lane reads.
3. Risk: moving or removing pre-provider work changes reply semantics.
   Mitigation: change only proven duplicate/nonessential barriers and retain direct scenario coverage over the production-hosted invocation path.
4. Risk: overlapping active hosted-mailbox work creates merge or ownership conflicts.
   Mitigation: base on current `origin/main`, keep the diff narrow, avoid the direct-wake lane, and reconcile latest `main` before final handoff.

## Tasks

1. Trace current measurement, mailbox, and pre-provider paths and lock exact semantics with failing regressions.
2. Repair provider/delivery milestone ownership and add bounded missing phase events.
3. Collapse foreground conversation/system mailbox reads and their sequence projections without weakening gates.
4. Remove only proven duplicate pre-provider barriers and place typing at the earliest definite reply boundary.
5. Run focused tests, `test:diff`/owner coverage, typecheck, direct scenario proof, and required specialist audits.
6. Finish the scoped plan commit, push, open the intent-contract PR, run ReviewGPT rounds to zero accepted findings, and prove final CI/mergeability.

## Decisions

- Keep direct wake behind durable Temporal acceptance; its measured handoff is not the primary latency target.
- Treat local Codex `turn/start` as a local milestone, not proof of an OpenAI request or first token.
- Store exact assistant milestones in the existing attempt-bound phase document, with best-effort retry only for the staging/trace-row race and no synchronous observability barrier.
- Use one post-restore authorized mailbox snapshot for the warm foreground conversation/system lanes, then preserve conversation-first processing and existing system-lane failure containment.
- Do not optimize sidecar payload fetches in this PR because sampled Linq foreground payloads are already inline.
- Do not build speculative KMS concurrency before a direct KMS span proves the safe restructuring opportunity.

## Verification

- Commands to run:
  - Focused Vitest regressions for every changed owner during iteration.
  - `pnpm test:diff <task paths...>` when it truthfully covers the final diff.
  - `pnpm typecheck` and the required coverage-bearing owner/app lane.
  - Direct hosted-local or production-faithful route/runtime scenario for the consolidated fetch and milestone ordering.
  - `git diff --check`, privacy/path/secret readback, parent full-diff review, specialist audits, PR ReviewGPT rounds, and final PR CI/merge-conflict proof.
- Expected outcomes:
  - All checks green; trace events remain metadata-only and nonblocking; no reply, access, usage, replay, or delivery regression; zero unresolved accepted audit/ReviewGPT findings.
Completed: 2026-07-09
