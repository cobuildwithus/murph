# Production Linq first-contact canary

Status: completed
Created: 2026-08-27
Updated: 2026-08-28

## Goal

- Add a repeatable production canary that proves a brand-new private Linq
  contact receives Murph's fast first reply and that the same conversation
  continues through the ordinary hosted runtime after a deployment.
- Reuse one privately configured Photon/Spectrum sender by resetting only that
  fixed canary identity through existing account-deletion, routing, delivery,
  and admission owners.

## Success criteria

- A protected post-deploy GitHub Actions job verifies the exact production Web
  deployment, resets the fixed canary identity, sends three ordered turns, and
  fails on a missing, out-of-order, or over-budget reply.
- The reset surface accepts no member or phone selector, uses a dedicated
  canary-only credential, is idempotent, and cannot widen into a general
  production deletion API.
- Reset reuses canonical account deletion and clears only the fixed contact's
  first-contact admission state and safely pre-provider Luna claim residue.
  Provider webhook dedupe, completed delivery evidence, and line/chat health
  remain intact.
- Ambiguous or provider-entered delivery state fails closed rather than being
  deleted or made retryable.
- Focused tests cover authentication, fixed-target scoping, safe reset,
  replay/concurrency, the live journey runner, and latency/order assertions.
- No new queue, service, database model, or independent state owner is
  introduced. The live runner uses only Photon's official core and iMessage SDK
  packages as pinned development dependencies.

## Scope

- In scope:
  - One internal fixed-target Web reset boundary and its narrow service logic.
  - One production post-deploy workflow and a small Photon journey runner.
  - Focused unit/integration tests and the durable deployment/security/reliability
    documentation required by the new production boundary.
  - Local deterministic coverage of the existing quiet-time onboarding
    follow-up when the current hosted-local harness can exercise it without a
    second production identity.
- Out of scope:
  - A general operator deletion/reset endpoint or caller-selected identity.
  - A new scheduler, queue, canary database, provider abstraction, or telemetry
    service.
  - Keeping the same production identity alive for a multi-hour/day follow-up
    while also resetting it independently on every deployment; those two uses
    require serialization or a second sender and are not silently conflated.

## Constraints

- Technical constraints:
  - Use the existing canonical deletion workflow, member/chat locks, Linq
    delivery ledger, route authority, first-contact admission ledger, and
    provider webhook dedupe.
  - Keep production credentials in a protected GitHub Environment and Vercel;
    never expose phone numbers, secrets, message bodies, or provider payloads in
    workflow output or committed fixtures.
  - Verify the deployment SHA and production alias before any canary mutation.
  - Keep database transactions bounded and database-only; provider/network work
    remains outside them.
- Product/process constraints:
  - This is internal production verification and does not change Murph's
    member-facing promise; Product UX effort is not applicable beyond proving
    that the existing private first-contact journey is preserved.
  - ReviewGPT authors the primary patch. The parent inspects, integrates, and
    verifies it before opening the PR.
  - Run the required preliminary specialist pass, final ReviewGPT loop, exact
    head CI, and parent final review before completion.

## Risks and mitigations

1. Risk: A reset races a real provider dispatch and creates a duplicate reply.
   Mitigation: serialize through current owners and fail closed unless every
   removable delivery claim is proven pre-provider.
2. Risk: A generic reset surface could delete the wrong member.
   Mitigation: configure one server-owned identity and accept no target input.
3. Risk: Reused provider event ids are deduplicated and fail to exercise a new
   first contact.
   Mitigation: create a fresh provider event for every send and retain the
   canonical provider-event dedupe ledger.
4. Risk: Production deploy events race or run against the wrong revision.
   Mitigation: use non-cancelling concurrency plus the existing exact Vercel
   production deployment verifier before reset or send.
5. Risk: A strict latency assertion turns transient provider transit into noisy
   failures.
   Mitigation: keep the user-requested end-to-end budget explicit—including
   Photon transit—and emit only bounded per-turn latency without private
   content.

## Tasks

1. Inspect the current deletion, first-contact admission, Luna delivery,
   production-deployment verification, Photon harness, and CI owners.
2. Give ReviewGPT a bounded implementation packet and request a complete patch
   with tests and durable docs.
3. Inspect the returned artifact for scope, privacy, architecture, and unsafe
   destructive behavior; integrate only the accepted patch.
4. Run focused tests and direct local proof, then complete the parent candidate
   review, finish the plan-bearing commit, push, and open the PR.
5. Run the preliminary completion-specialists pass and final ReviewGPT gate on
   the exact candidate head alongside required CI; disposition every finding
   and remediate only accepted issues.
6. Require a validated final pass, green required checks, clean current-base
   merge-tree proof, and a final requirement audit before handoff.

## Decisions

- Prefer one fixed-target authenticated route over a generic admin API.
- Prefer a dedicated shared canary credential over adding an OIDC/JWKS
  dependency; the credential grants only replayable deletion of the fixed test
  identity.
- Preserve provider event dedupe and completed delivery observability.
- Use the smallest official Photon runtime surface (`@spectrum-ts/core` plus
  `@spectrum-ts/imessage`) instead of the broader provider bundle. Dependency
  policy and audit-path checks confirm this adds no high or critical advisory.
- ReviewGPT implementation attempts returned no usable patch. The parent
  implemented the bounded design directly; the exact pushed candidate still
  requires the repository's preliminary and final ReviewGPT review gates.
- Use the same Photon sender for the short deployment canary. Treat the delayed
  quiet-time follow-up as a separately serialized live journey or deterministic
  hosted-local proof, because resetting the identity destroys the state that
  the delayed follow-up needs.

## Verification

- Commands to run:
  - Focused Web tests for the reset service and route.
  - Focused runner/workflow contract tests.
  - Relevant Web typecheck and repository configuration guards selected from
    the testing/CI map.
  - Exact-head required GitHub Actions, preliminary completion specialists,
    and final ReviewGPT rounds.
- Expected outcomes:
  - Unauthorized or target-bearing reset requests fail with no mutation.
  - Repeated authorized reset converges safely for the one configured canary.
  - Unsafe provider-entered delivery state blocks reset without losing evidence.
  - A simulated journey proves three ordered replies and independent latency
    measurements without logging private message text.
  - The production workflow cannot run until exact deployment verification and
    protected-environment approval/configuration succeed.

## Verification results

- Focused reset/admission/route suite: 47 tests passed.
- Workflow/runner contract suite: 3 tests passed.
- Hosted Web prepared typecheck: passed on the final source-reference
  compare-and-delete candidate.
- Exact changed-file ESLint, dependency policy, provider request boundary,
  docs drift, workflow syntax, runner import, and diff whitespace checks:
  passed.
- Repository audit baseline still contains existing advisories; the Photon SDK
  path adds one moderate telemetry advisory and no high or critical advisory.
Completed: 2026-08-28
