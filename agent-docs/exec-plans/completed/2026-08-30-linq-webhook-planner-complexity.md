# Reduce Linq webhook planner cyclomatic complexity

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Reduce the cyclomatic complexity of `planHostedOnboardingLinqWebhook` by
  extracting cohesive planning seams while preserving every existing webhook
  admission, routing, retry, persistence, and wake decision.

## Success criteria

- The planner is materially simpler under the same AST complexity measure used
  for the baseline.
- Focused hosted-onboarding and Linq tests prove unchanged behavior at the
  extracted seams, including duplicate, retry, membership, routing, group, and
  delivery-result paths.
- Hosted Web lint/typecheck and focused tests pass, or any unrelated baseline
  blocker is recorded precisely.
- The final diff adds no dependency, state owner, compatibility path, or policy
  duplication and passes privacy and identifier review.
- A scoped commit is pushed and a draft pull request records verification and
  deployment concerns.

## Scope

- In scope: `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`,
  directly owned pure helpers, and focused tests required to prove the refactor.
- Out of scope: product behavior changes, schema changes, provider contract
  changes, new services or queues, broad Linq cleanup, and unrelated complexity
  hotspots.

## Constraints

- Technical constraints: preserve signature and admission trust, route/member/
  line authority, group setup and retry behavior, transaction and lock order,
  KMS/crypto lifetime, source correlation, idempotency, mailbox/outbox/wake
  decisions, error mapping, data minimization, and deploy skew.
- Product/process constraints: obtain the required implementation ReviewGPT
  patch first; treat it as untrusted; inspect every proposed path and hunk; use
  the smallest accepted behavior-preserving decomposition; keep the pull request
  draft and do not launch final completion gates from this lane.

## Risks and mitigations

1. Risk: helper extraction silently changes statement order or transaction
   boundaries.
   Mitigation: keep orchestration order explicit, extract pure decisions before
   effectful boundaries, and compare focused behavior tests before and after.
2. Risk: decomposing provider events duplicates authorization or retry policy.
   Mitigation: keep canonical checks at their existing owners and pass explicit
   already-validated data into helpers.
3. Risk: a broad generated patch creates architecture churn.
   Mitigation: review each proposed hunk, reject unrelated or speculative work,
   and implement accepted pieces manually with a narrow diff.

## Tasks

1. [x] Read repository workflow, architecture, security, reliability, and Linq
   onboarding contracts; inspect existing Frog entries.
2. [x] Preserve and inspect the inherited implementation-lane patch. The task
   handoff explicitly excluded further ReviewGPT or specialist passes.
3. [x] Map the planner's current branches, effects, tests, and baseline complexity.
4. [x] Extract cohesive planning helpers without changing behavior or authority.
5. [x] Reuse the existing direct planner suites; no additional seam fixture was
   needed because they already exercise the moved family, active-member,
   first-contact, duplicate, retry, group, and delivery-result branches.
6. [x] Run focused tests, Web lint/typecheck, complexity measurement, and final
   diff/privacy review.
7. [x] Prepare the completed plan, scoped commit inputs, and complete draft pull
   request evidence. External branch and pull-request delivery follows the
   archived commit.

## Decisions

- This is an internal behavior-preserving refactor, so Product UX is unchanged;
  the relevant affected people are direct-message members, group participants,
  pending group owners, and retrying provider deliveries.
- Keep the exported planner signature and effect owners intact. Prefer pure
  event-specific decision helpers over a replacement dispatcher or new state
  machine.
- Keep the branch-local family, active-member direct, and first-contact
  planners in this module. They share the existing transaction and prepared
  authority lifetime and do not introduce another dispatcher, service, state
  owner, or compatibility layer.
- Restore the original explicit-null family-token decision instead of using a
  truthiness shortcut, preserving the exact prior input classification.

## Verification

- Commands to run: focused Vitest files discovered from the planner import
  graph; Web lint/typecheck commands from repository guidance; the baseline
  complexity script or equivalent AST measure; `git diff --check`; privacy and
  identifier scans over the final diff.
- Expected outcomes: focused behavior remains green; type/lint checks pass;
  complexity falls materially; only the planner, directly owned tests, and this
  completed plan change.

## Results

- The exact AST counter reduced `planHostedOnboardingLinqWebhook` from 222 to
  94. The largest extracted helper is the first-contact planner at 76; the
  family and active-member helpers measure 31 and 25 respectively.
- An AST effect-site comparison found the same 55 awaited call sites and callee
  counts before and after extraction. The 165 string literals in the planner
  composition also match exactly.
- Focused hosted Web Vitest proof passed 5 files and 395 tests covering direct
  dispatch, thread/group routing, mailbox-root preparation, read-receipt
  authority, duplicates, retries, and home-route recovery.
- Hosted Web typecheck, focused ESLint, `git diff --check`, and the final
  identifier/privacy scan passed.
- Product UX, frontend rendering, changelog, schema, provider-input, and
  cross-deploy compatibility are unchanged. Exact-head CI remains the broad
  PR verification owner; the requested diff-aware Web lane is reported
  separately from this focused local proof.
Completed: 2026-08-30
