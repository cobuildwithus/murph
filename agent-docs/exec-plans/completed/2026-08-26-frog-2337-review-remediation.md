# Resolve Frog #2337 final review finding

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Remove the obsolete production-wrapper instruction from the canonical
  phone-call privacy rollout and prove that it stays aligned with the protected
  production-maintenance owner.

## Success criteria

- The phone-call rollout directs the bounded command to a reviewed,
  task-specific `Hosted Web Contract Migrations` step.
- Focused coverage rejects the obsolete wrapper wording and pins the protected
  workflow owner in that rollout section.

## Scope

- In scope: the canonical phone-call rollout paragraph and its existing
  production-maintenance guard test.
- Out of scope: production behavior, workflow changes, secrets, provider calls,
  database access, or changes outside Frog issue #2337.

## Constraints

- Technical constraints: preserve the exact alias proof, prior-function drain,
  bounded dry-run/apply loop, and final zero-row proof.
- Product/process constraints: this final-review finding qualifies only for the
  behavior-preserving non-production remediation exception; keep it docs/test
  only and rerun the final ReviewGPT gate afterward.

## Risks and mitigations

1. Risk: replacing the stale wrapper phrase could weaken the privacy scrub gate.
   Mitigation: change only the invocation owner while preserving every existing
   freeze, drain, batching, comparison, and convergence requirement.

## Tasks

1. Inspect the canonical rollout and confirm the stale instruction.
2. Replace it with the existing protected workflow owner.
3. Add focused section-level coverage for the corrected wording.
4. Run focused tests, Web typecheck, docs checks, diff/privacy inspection, and
   the next exact-head final ReviewGPT round.

## Decisions

- Reuse the production-maintenance section introduced by the repair; add no new
  execution path or credential owner.

## Verification

- Commands to run: focused production-migration-guard Vitest, Web typecheck,
  docs drift/gardening, `git diff --check`, blocked-pattern scan.
- Expected outcomes: all checks pass, the obsolete wrapper phrase is absent,
  and the phone-call rollout names the protected workflow owner.
Completed: 2026-08-26
