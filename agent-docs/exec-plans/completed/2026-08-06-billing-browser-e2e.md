# Hosted Stripe billing browser regression matrix

Status: completed
Created: 2026-08-06
Updated: 2026-08-07
Completed: 2026-08-07

## Goal

- Add a production-shaped, browser-driven hosted-local billing regression lane
  that uses a dedicated Stripe sandbox and the real Murph Web, PostgreSQL,
  Stripe Checkout/Customer Portal, webhook, reconciliation, and Settings paths.
- Exercise the supported plan journey matrix, including the paused-trial resume
  parameter boundary that caused the 2026-08-06 incident, and make the lane a
  required pull-request signal wherever Stripe sandbox authority can be exposed
  safely.

## Success criteria

- ReviewGPT returns a scoped `.patch` or `.diff` implementation artifact; the
  parent inspects, path-scopes, and deliberately applies only accepted hunks.
- A real browser completes the production website-to-Stripe-to-website journey
  with no mocked Stripe client for Pulse Trial checkout, Trial to Pulse, Trial
  to Edge, paid Pulse to Edge, Edge to Pulse scheduled downgrade, individual to
  Family through both Checkout and paid same-subscription conversion, and
  Family-member invitation/activation behavior. The browser observes each real
  Stripe-hosted surface; protected final submissions use Stripe's supported
  test-mode interfaces because Stripe forbids browser automation of hosted
  payment frontends.
- A focused paused-subscription case proves a saved customer payment method is
  attached through Subscription Update before Subscription Resume, the resume
  creates the real hosted resumption invoice, and paying that exact invoice
  produces active Stripe and Murph state.
- Assertions cover both Stripe truth and Murph's webhook-reconciled Settings
  projection, with deterministic polling, isolated per-run resources, bounded
  cleanup, redacted diagnostics, and no credentials or private row data in
  artifacts.
- Pull-request automation runs the strongest safe lane on every trusted
  same-repository PR and retains a hermetic required fallback for pull requests
  where GitHub withholds secrets; it never exposes writable Stripe authority to
  untrusted fork-controlled code.
- Focused tests and typechecks pass locally, exact-head required CI is green,
  preliminary specialist ReviewGPT passes, the final ReviewGPT billing gate
  passes, the parent final review is clean, and the plan is archived in the
  final scoped commit.

## Scope

- In scope:
  - Existing hosted-local harness, hosted Web testkit, Playwright/browser
    runtime, Stripe CLI listener, real sandbox API, and PR workflow wiring.
  - Test-only seeding/inspection helpers needed to create isolated members,
    sessions, Stripe test resources, and assert final product truth.
  - The smallest production correction proved necessary by the live regression:
    preserve the effective Customer payment instrument on the Subscription via
    supported Subscription Update parameters before Resume.
  - Durable testing/verification documentation kept aligned with the new lane.
- Out of scope:
  - Live-mode Stripe, real payment credentials, real members, production data,
    visual redesign, a second hosted-local runner, or unsafe `pull_request_target`
    execution of PR-controlled code.

## Constraints

- Technical constraints:
  - Reuse the canonical hosted-local process owner and real production routes;
    fake only browser authentication setup and non-billing vendors.
  - Use Stripe sandbox/test keys and documented test payment methods only.
  - Keep every test resource tagged to an opaque run id, assert object ownership
    before cleanup, and make cleanup bounded and idempotent.
  - Do not print, persist, attach, or pass Stripe keys, webhook secrets, direct
    identifiers, raw production evidence, or private browser contents.
- Product/process constraints:
  - ReviewGPT implements and returns an attachment-based patch; it does not
    mutate, commit, or push the checkout.
  - Preserve the active incident session's separate hotfix checkout and work.
  - Use a task worktree/branch, focused local proof, exact-head PR CI, and both
    required ReviewGPT stages for this billing-sensitive test/deploy surface.

## Risks and mitigations

1. Risk: A secret-backed PR job can expose or abuse Stripe sandbox authority.
   Mitigation: run live Stripe only for trusted same-repository heads with a
   dedicated sandbox/restricted key and never evaluate fork code with secrets;
   keep hermetic coverage required everywhere else.
2. Risk: Stripe-hosted UI, event delivery, and eventual reconciliation make the
   matrix flaky or slow.
   Mitigation: use stable semantic browser locators, explicit event/state
   polling, isolated customers, no fixed sleeps as correctness proof, and a
   compact journey graph that reuses setup without coupling scenario outcomes.
3. Risk: Shared sandbox residue causes cross-run collisions or rate limits.
   Mitigation: opaque run metadata, scenario-local resources, serialized
   concurrency, bounded cleanup, and Test Clocks only where time travel is
   actually required.
4. Risk: A broad generated patch duplicates existing harness owners.
   Mitigation: parent review rejects a parallel runner, speculative services,
   production test backdoors, or unnecessary abstractions and keeps the patch
   at existing harness/testkit/workflow boundaries.

## Tasks

1. Reconstruct the incident session, verify the exact bug and hotfix boundary,
   and map current billing routes, hosted-local/testkit owners, and CI gaps.
2. Prepare a ReviewGPT implementation packet containing the journey matrix,
   security constraints, existing reuse points, product specs, and exact
   attachment requirement; launch the Pro run and retrieve its patch.
3. Inspect the returned artifact in full, reject unsafe/out-of-scope hunks,
   apply accepted intent deliberately, and reconcile it with the landed hotfix.
4. Run focused unit/type proof, hosted-local doctor/startup proof, and the live
   Stripe browser matrix when local sandbox authority is available.
5. Review scope/shape/privacy, update durable test docs, commit and push a
   candidate, open the PR, and start preliminary specialist plus final ReviewGPT
   concurrently with exact-head CI.
6. Resolve accepted findings, rerun affected proof, finish the plan/commit,
   prove mergeability, and hand off only after required gates are green.

## Decisions

- The target is a dedicated Stripe sandbox, not production test-mode data mixed
  with unrelated developer activity.
- “Every pull request” means every trusted same-repository pull request for the
  secret-backed live lane; untrusted forks cannot safely receive writable
  provider credentials and retain the hermetic required lane instead.
- The browser session may be issued by the existing hosted Web testkit so the
  test exercises billing rather than depending on Privy's external login UI.
- Stripe-hosted Checkout, Invoice, and Portal pages are real observation
  surfaces. The suite does not bypass their provider-owned Turnstile controls:
  exact Checkout Session completion uses a pinned Stripe CLI fixture, Invoice
  payment uses Stripe's test API, and Portal-equivalent mutations use the same
  test API after the browser proves the intended provider surface.
- Live evidence showed the landed Resume-parameter hotfix was incomplete for a
  Customer-inherited PaymentMethod. This task therefore includes the narrow
  supported Update-before-Resume correction while retaining a payment-required
  resumption invoice as the truthful product flow.
- The same provider proof showed the resumption invoice is initially open and
  unattempted with a hosted URL and positive balance. The product must surface
  that invoice instead of returning an indefinite `billing_pending` state.

## Verification

- Commands to run:
  - Focused ReviewGPT-returned unit and contract tests for changed harness,
    testkit, billing, and workflow owners.
  - Focused TypeScript checks for every changed package/app owner.
  - The new hosted-local Playwright/Stripe sandbox command.
  - Exact-head GitHub Actions required checks, preliminary
    `completion-specialists`, and final `pr-review` ReviewGPT loop.
- Expected outcomes:
  - All journey states converge in both Stripe and Murph Settings without raw
    secrets or private evidence in output/artifacts.
  - The paused resume scenario fails on the old unsupported resume payload and
    passes only when payment-method update precedes the supported resume call,
    the browser sees the resumption invoice, and payment opens entitlement.

## Outcome

- ReviewGPT returned an attachment-based implementation proposal. The parent
  inspected it, retained the existing hosted-local owners, and incorporated the
  accepted behavior deliberately instead of applying the artifact wholesale.
- The finished browser matrix covers eight cases and nine logical journeys:
  Pulse Trial Checkout; Trial to paid Pulse; paused Trial resumption; Trial to
  Edge; paid Pulse to Edge; Edge to Pulse scheduled downgrade; lapsed
  individual to Family Checkout; Family invite, acceptance, seat, and Settings
  state; and paid individual to Family on the same Subscription.
- Live provider proof established the incident's full root cause. Resume cannot
  accept `default_payment_method`; the effective Customer payment instrument
  must first be copied and verified through Subscription Update. Stripe can
  then create an open positive-balance resumption invoice with
  `attempted=false` and no PaymentIntent, which still must be surfaced as
  payment-required rather than indefinite billing pending.
- The production correction stays inside the existing member billing mutation
  owner: resolve the effective PaymentMethod or legacy Source, Update and
  verify the Subscription, Resume with supported-only parameters, and treat
  every open positive invoice as actionable.
- Trusted same-repository pull requests run the real Stripe sandbox matrix.
  Forks and dependency-bot pull requests receive no writable provider authority
  and run the required hermetic lane. The always-present aggregate check is
  attached to branch protection.
- Provider-protected Checkout and Portal final controls remain outside browser
  automation. The browser proves the exact real provider surface, while pinned
  Stripe test interfaces complete the exact Checkout Session, invoice payment,
  and Portal-equivalent mutation before webhooks and Settings are asserted.

## Completed review and proof

- Preliminary specialist ReviewGPT found two accepted coverage defects: plan
  assertions were not scoped to one card, and legacy Source plus Update-result
  failure paths lacked direct proof. Both were corrected and verified.
- Final ReviewGPT rounds found and resolved three authority/scope mechanisms:
  actor-only dependency-bot eligibility, an unconditional manual selected-ref
  authority path, and shared Stripe catalog values incorrectly activating the
  dedicated live lane. The first now binds both PR author and actor provenance;
  the second was deleted; the third now activates only from dedicated sandbox
  authority. Final round four returned PASS with no qualifying findings after
  rechecking the complete ledger and current full snapshot.
- `pnpm --dir packages/hosted-local-harness test` completed with 434 passing
  tests and one skip. Focused billing/support tests completed with 69 passing
  tests, the runner entrypoint proof completed with 41 passing tests, and the
  CI workflow/provider guard completed all 27 cases.
- `pnpm typecheck`, focused owner typechecks, web lint, Stripe request guards,
  diff checks, and privacy review passed.
- The local real-provider matrix completed all eight cases and nine journeys in
  224 seconds with listener-owned webhook delivery and clean teardown.
- GitHub Actions on the final behavior-bearing candidate passed the hermetic
  proof, live hosted-local Stripe browser matrix, required billing aggregate,
  release typecheck/app verification, host matrix, design and viewport gates,
  repository hygiene, runner sandbox, and deployment preview checks.
Completed: 2026-08-07
