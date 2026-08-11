# Hosted deploy gate contract recovery

Status: completed
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Restore the protected Cloudflare deployment path by making active hosted test
  members carry the Starter or paid entitlement required by the shipped usage
  model and aligning the Linq tool-advertisement assertion with response cards
  that the production-like runtime intentionally exposes.

## Success criteria

- Active hosted test members without a paid plan receive Starter usage through
  the production ledger owner before any runtime wake is exercised.
- Paid hosted test members continue to use their explicit billing reference.
- Linq scheduled-reminder, Codex cache-prefix, and ordinary Linq delivery
  hosted-local gates pass on the same exact candidate.
- The ordinary Linq delivery assertion requires the response-card tool while
  retaining every other dynamic-tool availability check.
- Focused runtime tests, typecheck, exact-head CI, preliminary specialist
  review, final ReviewGPT, mergeability proof, deploy, and postdeploy smoke
  complete without unresolved accepted findings.

## Scope

- In scope: the hosted Web test seed lifecycle, the Linq E2E response-card
  availability contract, and direct protected-journey proof.
- Out of scope: a new scheduler, queue, mailbox cursor, Web product-state owner,
  Temporal workflow, or Cloudflare Durable Object recovery ledger.

## Constraints

- Reuse the production Starter grant transaction owner rather than inserting
  ledger rows in test support.
- Do not change production entitlement, runtime, Temporal, or Cloudflare code.

## Risks and mitigations

1. Risk: hand-written test ledger state drifts from production enrollment.
   Mitigation: call the existing idempotent Starter grant owner.
2. Risk: paid fixtures receive conflicting access state.
   Mitigation: grant Starter only when no explicit paid plan was requested.
3. Risk: the runtime failure is hidden instead of fixed.
   Mitigation: retain the strict handled-through completion predicate and rerun
   every protected hosted-local journey that failed in deployment.
4. Risk: relaxing the dynamic-tool assertion hides an unexpected tool.
   Mitigation: enable only the already-shipped response-card capability in the
   scenario's exact expected set; equality remains strict.

## Tasks

1. Reproduce and trace the first activation checkpoint on current main.
2. Prove Web denied the follow-up execution because the synthetic active member
   had no usage entitlement.
3. Compose the active-member seed with the existing Starter grant owner when no
   paid billing plan is requested.
4. Run focused tests, typecheck, and the three protected hosted-local journeys.
5. Commit and push the exact candidate, open the PR, run preliminary specialist
   review and final ReviewGPT concurrently with CI, resolve accepted findings,
   merge, deploy Vercel then Cloudflare, and verify production.

## Decisions

- Treat the dual protected-gate failure as a deterministic test-fixture
  regression, not a flaky deploy. Both independent journeys reached the same
  imported-but-unhandled activation checkpoint because Web correctly denied a
  second execution without usage entitlement.
- Keep the hosted completion predicate strict because zero import lag is not
  proof that an imported system item was handled.
- Keep production runtime code unchanged: local tracing proved it requested an
  immediate recheck and the owner-release callback succeeded.
- Treat `attach_response_card` as expected in the ordinary Linq scenario. The
  runtime already exposes it for that direct conversation, and sibling media
  and Telegram E2Es declare the same capability explicitly.

## Verification

- Hosted Web typecheck and focused support-boundary tests.
- Hosted-local Linq scheduled-reminder, Codex cache-prefix, and Linq delivery
  journeys.
- Exact-head GitHub CI, preliminary specialist review, final ReviewGPT, and
  non-mutating merge-tree proof.
- Vercel exact-SHA proof followed by protected Cloudflare immediate rollout,
  runner fingerprint/model smoke, and bounded postdeploy runtime-log checks.

## Verification log

- Protected Cloudflare run 31443316197 failed both the scheduled-reminder and
  cache-prefix gates with system sequence 1 imported, handled-through 0, and a
  committed already-due assistant wake. The worker and runner smoke gate passed,
  so the deploy correctly stopped before production mutation.
- The exact local Codex Gateway journey reproduced the timeout. Runtime tracing
  showed a successful immediate-recheck handoff; Web reconciliation then
  returned `ai_usage_denied` for the active synthetic member, which had no paid
  billing reference and no Starter ledger grant.
- A bounded read-only production aggregate found zero active, unsponsored,
  non-paid members missing a Starter grant. The defect is isolated to synthetic
  seed state; production enrollment and migrated member state remain aligned.
- After entitlement recovery, the Linq delivery journey advanced through nine
  tests before its strict dynamic-tool assertion found one missing expectation:
  `attach_response_card`. The observed tool is shipped behavior; the scenario
  was the only response-card-capable call site that did not opt into it.
- Hosted Web typecheck, Cloudflare typecheck, targeted lint, the hosted source
  boundary tests, and all 22 hosted-local E2E-support unit tests passed.
- The protected journeys passed on the corrected candidate: Codex cache-prefix
  1/1, Linq delivery 10/10 active tests, and scheduled reminders 2/2. One
  concurrent local reminder attempt collided with a shared sidecar and one
  isolated attempt lost its local runner container before import; neither
  repeated in the final sequential runs.
- While the long journeys ran, PR #1601 independently landed the same
  production-owner Starter fixture composition on `main`. Rebase preserved the
  landed implementation and kept this branch scoped to the remaining strict
  response-card expectation plus this investigation record.
Completed: 2026-08-10
