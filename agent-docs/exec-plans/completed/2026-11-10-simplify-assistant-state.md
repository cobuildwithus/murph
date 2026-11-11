# Simplify assistant state and occurrence bookkeeping

Status: completed
Created: 2026-11-10
Updated: 2026-11-10

## Goal

Reduce assistant state duplication while preserving scheduled execution, delivery,
foreground priority, and existing serialized-state readers.

## Success criteria

- Cron journals persist outcome/reason once and derive compatibility status.
- Local and canonical occurrence finalization share their common transition rules.
- Phase-result merging assembles shared fields once without losing wake ownership.
- Unsupported retirement is explicitly bounded by restore and pending-work proof.
- Focused owner tests, typechecks, complexity review and a synthetic real-Codex
  journey pass before the candidate is handed to the parent for final review.

## Scope

- In scope: cron history serialization, duplicate occurrence transitions, phase
  result composition, owner documentation and focused regression evidence.
- Out of scope: first-contact engine, tapbacks, referrals, deployments, production
  mutation, new queues, generic state-machine frameworks and speculative migrations.

## Constraints

Canonical automation records retain product policy. Existing runtime stores retain
occurrence and dispatch ownership. Preserve current API responses and old journal
readers. No source of authority moves to diagnostics or a model-visible field.

## Risks and mitigations

1. Old snapshots may contain onboarding generations or input formats.
   Retain readers until the parent proves a restore/rollback floor and no live
   pending obligations; quiet production traffic alone is insufficient.
2. Local device-triggered jobs are live, not dead compatibility.
   Collapse common pure transition rules without migrating their persistence or
   weakening parent-authority and event-cursor validation.
3. Wake-result merging distinguishes omission, null, and invocation ownership.
   Preserve those semantics and use existing composed checkpoint/wake regressions.

## Tasks

1. Remove redundant cron journal status writes, deriving status at the schema edge.
2. Collapse duplicated local/canonical occurrence result updates at the existing owner.
3. Collapse duplicate shared phase-result construction.
4. Record retirement conditions for onboarding and input formats.
5. Run focused proof, review the complete diff, close this plan, commit and open a
   draft PR. The parent owns Ready, ReviewGPT and required CI.

## Decisions

- A full local-to-canonical scheduler migration would add schema and rollout
  machinery without required fleet evidence. The implementation narrows to shared
  current transition logic; persistent-owner consolidation remains explicitly gated.
- History status remains a derived compatibility field in public reads. It is not
  independently stored by new or rewritten journals.

## Verification

- Engine occurrence/store/output proof: 370 tests pass across
  `assistant-cron-schedule-store`, `assistant-cron-runtime`,
  `assistant-cron-one-shot-completion.integration`, and
  `assistant-cron-output-history`.
- Runtime composed foreground/workspace/wake proof: 282 tests pass;
  projection wake convergence: 25 tests pass after the documented runtime build.
  The first projection attempt failed at setup because its compiled capture worker
  was absent; building the owning package resolved that prerequisite.
- Operator contract proof: 23 tests pass, including normalized reason handling
  and rejecting an explicit null compatibility status.
- Mixed-version proof passes: all six head-written outcomes are accepted by the
  exact base `34d9f4edc1` schema loaded into a temporary synthetic harness. The
  temporary harness and base module were removed after the check.
- All three affected packages pass typecheck. Runtime build, complexity diff,
  docs drift, and whitespace checks pass. Wake merge complexity debt falls by 8;
  occurrence and contract files introduce no complexity debt.
- The focused real-Codex inspection journey now checks the persisted status-free
  journal before exercising the production inspection tool and truthful reply.
  `pnpm test:assistant:live -- --test 'explains a consumed failed reminder without
  claiming delivery or recreating it'` stops before authentication/provider work:
  the pinned npm binary lacks required `app-server --ignore-user-config` support.
  The permitted sibling build locations contain no release binary; the available
  debug binary also lacks that capability. No provider action or member message
  occurred. Reply-review verdict: Hold, pending a compatible native binary.
  Existing Frog entry `20261026172108-local-live-runner` covers this limitation.

## Handoff and retirement disposition

- Implemented: common occurrence result bookkeeping; outcome-only journals with
  compatibility projection; one construction of shared assistant/system result
  fields. First-contact behavior, tapbacks, and referrals are untouched.
- Deferred: physical consolidation of live local jobs requires a separate
  migration design and restore proof; retaining their current store avoids
  orphaning device-triggered obligations.
- Blocked on evidence: remove historical onboarding generations only after all
  supported restorable snapshots have no old active/paused definitions or pending
  delivery references. Retire old JSON input/v1 pending-index readers only after
  the supported restore/rollback floor excludes those formats. The parent owns
  that retirement research; this candidate does not claim those deletions.
- The parent owns candidate review, compatible-native-binary live proof, Ready,
  ReviewGPT, exact-head CI and final completion. No merge or deployment performed.
Completed: 2026-11-10
