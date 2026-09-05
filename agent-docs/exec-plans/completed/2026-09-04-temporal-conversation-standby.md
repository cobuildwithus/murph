# Preserve conversation work for standby admission

Status: completed
Created: 2026-09-04

## Outcome and ownership

Allow authenticated Temporal processing for pending conversation work to claim
the existing ready standby, regardless of which startup caller reaches the
member first. Web owns admitted mailbox facts, Temporal derives the work fact,
and Cloudflare owns allocation, consent, and exact runner write fences.

Use one optional positive-only `conversationWorkPending` request field derived
from current reconciliation conversation lag. Do not persist another priority
projection or infer conversation work from generic default processing.

## Product UX

- Effort: Patch.
- Outcome: avoid unnecessary cold startup for a pending conversation when a
  ready standby exists and Temporal reaches the runner first.
- Reaches: admitted hosted conversations, including mixed conversation/system
  work; background-only processing and existing runner reuse stay supported.
- Proof: authenticated route, request parser, Temporal derivation, and runner
  admission tests; preserve denial, retained targets, fallback, and fences.

## Scope and evidence

- Extend the existing request, parser, and fresh allocation condition.
- In the private consumer, derive the field from fresh admitted conversation
  lag, preserving activity ordering and retry/continue-as-new reconciliation.
- Independently trace readiness timeout causes and recent diagnostic coverage.
  Add bounded metadata only when a demonstrated gap remains.
- No pool expansion, startup queue, new scheduler, persisted state, consent
  change, model input change, or production mutation is part of this patch.

## Deployment compatibility

The old exact-key request parser rejects the new field. Deploy the compatible
Cloudflare receiver before the Temporal producer. Old producers remain valid
with field omission. Roll the producer back before rolling the receiver below
this contract. Keep private source out of public artifacts; use synthetic
contract evidence. An old public package can parse the base request before the
private consumer appends its locally validated optional fact.

## Tasks

1. Recover production evidence and independently review timeout code/logs.
2. Implement and test the public consumer and private producer in isolated
   parent-owned worktrees with non-overlapping agent scopes.
3. Update current owner docs and verify focused tests, typechecks, relevant
   build/replay proof, complexity, and private full verification.
4. Complete parent UX and diff review, scoped commits, draft paired PRs,
   exact-head review concurrent with CI, and report release prerequisites.

## Verification and handoff

- Public parser, signed route, and allocation proof: 176 tests pass, including
  background-mode refusal, tamper rejection, and retained target convergence.
- Hosted-execution and Cloudflare typechecks and hosted-execution build pass.
  Web typecheck and nine archive tests pass; final copy/reference readback is
  included with the final scoped commit.
- Private workflow/Activity proof: 405 focused tests and 34 historical replay
  fixtures pass; typecheck passes. The private PR owns full verification.
- Complexity guard passes with unchanged existing hotspot debt. Current owner
  docs, diff check, docs drift, and gardening pass.
- Parent Product UX walkthrough: Ready for the stated bounded allocation
  outcome. Authentication, consent, existing target convergence, and fallback
  remain covered; model behavior and provider inputs are unchanged.
- Timeout investigation: the activity completed with `retry_later`; its
  effective request budget is consistent with bounded readiness expiry.
  The exact internal stage remains unproven in accessible historical logs.
  Six existing deadline/diagnostics tests pass, including reuse after an
  eight-second deadline when the same shell becomes healthy at nine seconds.
- Existing merged startup-stage diagnostics already provide attempt
  correlation, effective deadline, stage, elapsed time, and cleanup outcome.
  No duplicate logging or speculative timeout change is needed. Canonical
  deployment history does not show those diagnostics deployed; direct
  Cloudflare verification is unavailable with current local authentication.
- Public PR: #2822. Exact-head CI and ReviewGPT remain external completion
  gates. Production proof requires receiver-first deployment, followed by the
  paired private producer. No production state was changed during this task.
Updated: 2026-09-04
Completed: 2026-09-04
