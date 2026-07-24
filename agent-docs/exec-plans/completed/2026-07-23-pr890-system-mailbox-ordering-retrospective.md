# PR 890 System-Mailbox Ordering Retrospective

## Goal

Resolve ReviewGPT round 2's repeated pre-mailbox authorization mechanism with
one general ordering contract: deterministic system-mailbox work is imported
and checkpointed before unrelated model-capable workspace work is authorized.

## Retrospective Decision

- An accepted deterministic mailbox item is independent of model entitlement.
- System-mailbox lag runs through one import-only processing mode that imports
  only the system lane, checkpoints canonical progress, and returns before the
  assistant phase.
- A subsequent reconciliation applies the existing engagement and AI-usage
  gates to the model-capable wake produced or preserved by that import.
- Conversation mailbox work remains subject to the existing AI-usage gate so
  user notices and pending-input ownership remain intact.
- Delete the meal-specific recent-capture engagement exception and the
  pre-import system-item AI query once the general ordering makes both
  unnecessary.

## Constraints

- Add no state owner, queue, scheduler, cursor, lifecycle, bypass flag, or
  feature-specific authorization branch.
- Reuse the existing runtime processing-mode seam and mailbox lane watermarks.
- Preserve retention priority, foreground preemption, model-usage denial, and
  ordinary unrelated automation engagement behavior.
- Prove accepted capture import under a co-due closeout and denied AI usage,
  then prove the later model wake remains denied.

## Working Set

- Hosted Web runtime reconciliation and mailbox reads.
- Temporal runtime-workflow dispatch.
- Hosted execution processing-mode contracts and parsers.
- Cloudflare runner processing-mode transport/ownership.
- Assistant-runtime system-only import entry.
- Focused tests and directly affected durable architecture/reliability docs.

## Verification Plan

- Failing-first reconciliation proof for system lag plus co-due denied model
  wake.
- Workflow proof that system lag dispatches import-only processing.
- Runtime proof that system-only mode imports/checkpoints the system lane and
  never enters the assistant phase.
- Relevant package/app typechecks and focused suites.
- Canonical diff verification and acceptance.
- ReviewGPT round 3 after the retrospective decision and remediation are
  committed and pushed.

## Completion Evidence

- Failing-first proof reproduced the round 2 defect: accepted system work was
  blocked by the AI-usage gate when a model-capable wake was co-due.
- Web reconciliation and mailbox-route suites passed with system import ahead
  of model authorization while conversation items remain usage-gated.
- Hosted execution passed 383 tests; Temporal passed 87 tests; the full
  assistant-runtime suite passed 1,810 tests with 2 skipped; the Cloudflare
  runner alarm suite passed 92 tests.
- Typechecks passed for Web, Cloudflare, assistant runtime, hosted execution,
  and the Temporal orchestrator. Documentation drift and diff checks passed.
- Canonical diff verification reached and passed every changed package suite,
  then failed only in unrelated repository-wide Health Commons generated-state
  fixtures and hosted-local Linux bridge/MinIO assumptions.
- Canonical acceptance passed across all 31 workspace projects in 4m53s.
- Final product/privacy review found no new state owner, queue, scheduler,
  cursor, opt-in, raw private-data logging, or authorization bypass. System
  import is deterministic and import-only; all model-capable work remains
  subject to the existing engagement and AI-usage gates.
Status: completed
Updated: 2026-07-23
Completed: 2026-07-23
