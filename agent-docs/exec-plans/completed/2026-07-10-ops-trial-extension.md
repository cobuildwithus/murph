# Ops-page Pulse Trial extension completion

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Finish and ship the in-process ops-page workflow for previewing and applying
  the Pulse Trial beta extension without requiring production secrets on an
  operator's local machine.

## Success criteria

- Preview and Apply are operator-only, same-origin protected, and never widen an
  invalid one-member target into an all-member operation.
- Stripe-side extension and local reconciliation remain replay-safe across
  retries and failures for the fixed one-time campaign.
- The operator UI cannot apply a stale preview to a changed target and reports
  the exact campaign/target/result it is acting on.
- All-member work is explicitly bounded to fit the hosted request runtime.
- Focused tests, the truthful app verification lane, direct scenario proof,
  required specialist audits, PR CI, and the PR ReviewGPT loop are green.
- The active plan and ledger row are closed through `scripts/finish-task`.

## Scope

- In scope: the existing Pulse Trial extension service, ops route/page/client,
  operator documentation, focused tests, and completion/PR workflow artifacts.
- Out of scope: changing Pulse Trial pricing or eligibility policy, adding a
  queue or background campaign system, changing Stripe checkout behavior, or
  creating a general-purpose billing operations framework.

## Constraints

- Technical constraints: Stripe metadata is provider-side idempotency evidence;
  local billing timestamps must reconcile after ambiguous/local failures; all
  work stays bounded and sequential where required by the existing row lock.
- Product/process constraints: default to the smallest architecture; preserve
  the existing Start-paid-Pulse lock/authority path; the user explicitly
  authorized direct completion of the UI follow-up after Fable was unavailable;
  do not expose member identifiers in logs or committed examples.

## Risks and mitigations

1. Risk: generalizing the one-time campaign key permits duplicate extension or
   marker rollback after partial failure.
   Mitigation: keep the original fixed campaign key and fail closed on foreign
   campaign markers.
2. Risk: malformed target input or stale client state applies to more members
   than the operator previewed.
   Mitigation: reject present invalid target fields and bind each preview to an
   immutable target snapshot used by Apply.
3. Risk: an all-member request exceeds the hosted function duration after
   partially mutating Stripe.
   Mitigation: preflight a single capped candidate set before mutation, process
   only that set, and use one bounded 80-second attempt for each Stripe read and
   write so four sequential candidates fit the hosted invocation budget.

## Tasks

1. Recover the interrupted Claude worktree and review output.
2. Validate each review finding against the real billing, route, and UI paths.
3. Implement the smallest accepted fixes and focused regression coverage.
4. Run truthful verification and direct scenario proof.
5. Run required security/privacy, frontend, and coverage audit passes and
   resolve accepted findings.
6. Final-review, close the plan, push the branch, open/update the PR, and run
   the PR ReviewGPT/CI loop to merge readiness.

## Decisions

- Continue in the existing `ops-trial-extension-tool` worktree/branch created by
  the interrupted Claude session; preserve the dirty primary checkout.
- Treat the recovered Codex review as advisory evidence and independently
  verify every finding before changing code.
- Keep the tool synchronous and bounded; do not introduce a queue or campaign
  manager for a low-volume operator workflow.
- Preserve the original fixed one-time campaign key. The user asked to move the
  existing campaign into the deployed ops app; UTC-dated recurring occasions
  were unrequested and created avoidable rollover/double-extension risk.
- Delete the now-redundant local production script once the deployed ops route
  owns the campaign.

## Current state

- Non-UI review fixes are implemented: fixed campaign semantics, invalid member
  scope rejection, race-free four-candidate preflight, bounded Stripe request
  attempts, 800-second route duration, identifier-free apply logs, script
  deletion, docs, and focused tests.
- Client follow-up is implemented with a preview-owned target snapshot, stale
  preview clearing, pending-input guards, fixed-campaign copy, candidate-cap
  guidance, retryable partial-result handling, accessible result status/focus,
  and focused interaction coverage.

## Verification

- `pnpm test:diff apps/web`: truthful app-scoped typecheck/test/verification lane.
- Focused Vitest for Pulse Trial service, route, and client behavior during
  iteration.
- `git diff --check origin/main...HEAD` and privacy-sensitive diff inspection.
- Focused route/client scenarios for one-member and all-member preview/apply,
  plus direct local proof for the same-origin mutation boundary.
- Required completion audits: `security-privacy-review`, `frontend-review`, and
  `coverage-write`; PR-lane ReviewGPT loop replaces the default local deep review.
- Completed interim proof: focused service/route Vitest (35 passing), hosted-web
  prepared typecheck, focused ESLint, `git diff --check`, and focused client
  Vitest (6 passing).
- `pnpm test:diff apps/web` passed the production build, dev smoke, lint,
  typecheck, and hosted-web suite (4,238 passed, 9 skipped; 10 pre-existing
  warnings and no errors).
- Direct local proof started the isolated Next dev server and confirmed a
  disallowed mutation origin receives HTTP 403 before the route can act.
  Authenticated desktop/mobile rendering remains a verification gap because
  this session has no in-app browser backend.
- `security-privacy-review` found no medium-or-higher findings.
- `frontend-review` found three medium retry/accessibility/copy issues and one
  low stale-copy issue; all were fixed, and the targeted re-audit reported no
  remaining actionable findings. Rendered desktop/mobile inspection remains
  unavailable as noted above.
- `coverage-write` reviewed the final service, route, and client boundaries and
  found no important missing stable-boundary proof; it required no edits.
- The post-frontend-audit `pnpm test:diff apps/web` rerun passed the production
  build, dev smoke, lint, typecheck, and hosted-web suite (4,239 passed, 9
  skipped; 10 pre-existing warnings and no errors).
- Parent commit-readiness review found a count/list race and an excessive
  worst-case Stripe retry budget. Both were resolved by capturing the bounded
  candidate set once before provider work and disabling automatic per-call
  retries for this manually retryable, idempotent ops campaign.
- After those bounded-runtime fixes, the 41 focused tests, focused ESLint, and
  prepared typecheck passed. The post-fix diff lane's repository guards passed;
  its parallel app phase hit unrelated 60-second import/dev/static-page
  timeouts under contention. Sequential/isolated reruns then passed the full
  hosted-web suite (4,239 passed, 9 skipped), full ESLint (the same 10
  pre-existing warnings), prepared dev smoke, and the production Next build
  including all 184 static pages.
Completed: 2026-07-10
