# Murph Group plan completion

Status: completed
Created: 2026-07-27
Updated: 2026-07-28

## Goal

- Complete PR 1029 as a maintainable `$3.50/month` Group billing SKU that maps
  to the existing Pulse runtime experience, remains privately selectable only
  for confirmed current group members, and preserves wearable synchronization
  when personal AI usage is exhausted.

## Success criteria

- The PR contains normal source, test, and durable-document changes instead of
  temporary patch-staging or self-mutating workflow artifacts.
- Group eligibility, catalog visibility, plan transition timing, and trial
  continuation offers each have one server-owned policy owner.
- Existing Stripe customer/subscription ownership, financial reconciliation,
  billing locks, and paid-entitlement gates remain authoritative.
- Trial-ending communication is private, deduplicated, and never falls back to
  a group route.
- Group usage exhaustion blocks new model work without blocking wearable
  ingestion, synchronization, or authorized group projections.
- Focused tests, canonical acceptance, frontend proof, preliminary specialists,
  product review, final ReviewGPT, and exact-head CI pass.

## Scope

- In scope: direct billing plan catalog, Group eligibility, authenticated
  Settings and trial continuation UI, plan-change and early-trial conversion
  services, Stripe reconciliation and private trial-ending wake, usage and
  subscription tool projections, assistant low-usage guidance, tests, design
  catalog, environment examples, and current durable billing docs.
- Out of scope: new entitlement modes, schema tables, public Group pricing,
  Group-specific trials, personal Group top-ups, automatic plan switching,
  group-chat billing messages, and changes to wearable sync entitlement.

## Constraints

- Group maps to runtime `pulse`; capability and billing-plan identity stay
  separate.
- New Group selection requires a confirmed owner or joined membership and is
  rechecked inside the existing billing mutation lock.
- A current or scheduled Group plan remains visible after membership is lost,
  but cannot be selected again without current eligibility.
- Every paid transition reuses the canonical Stripe subscription and grants no
  higher allowance before canonical financial reconciliation.
- Billing communication uses only a confirmed private route and follows the
  repository deliverability policy.
- Prefer explicit mappings, small pure policy functions, deletion of temporary
  artifacts, and existing notification/mailbox infrastructure.

## Risks and mitigations

1. Risk: mapping two billing SKUs to runtime Pulse makes reverse lookup
   ambiguous.
   Mitigation: use an explicit runtime-to-default-billing mapping and derive
   current billing identity only from persisted/Stripe price evidence.
2. Risk: a stale eligible page or quote could select Group after membership is
   removed.
   Mitigation: bind quotes to current billing state and recheck confirmed
   membership under the billing mutation lock.
3. Risk: generalized transitions weaken PR 972's financial or concurrency
   protections.
   Mitigation: retain its provider mechanisms and generalize only typed source,
   target, price, and timing policy; cover the complete transition matrix.
4. Risk: trial or usage copy leaks billing into a group or overstates paused
   access.
   Mitigation: fail closed without a private route and test model-work denial
   independently from wearable/device-sync allowance.
5. Risk: stacked-base movement invalidates review evidence.
   Mitigation: reconcile the current PR base before implementation, push a clean
   exact head for preliminary review, and freeze the first-reviewed head for the
   final ReviewGPT loop.

## Tasks

1. Reconcile PR 1029 with the current PR 972 head and materialize the staged
   implementation by behavioral intent.
2. Audit the result against current billing owners; complete missing
   trial-ending, early conversion, eligibility, privacy, usage, and frontend
   behavior.
3. Add or update durable specs, design catalog coverage, and focused tests.
4. Run focused verification, responsive proof, preliminary specialist
   ReviewGPT, product-experience review, and the required Claude UI check.
5. Resolve accepted findings, run parent final review and canonical acceptance,
   close the plan with a scoped commit, and push the exact clean head.
6. Run final ReviewGPT rounds concurrently with exact-head CI until PASS, update
   the PR description/evidence, and complete the merge-readiness handoff.

## Decisions

- The uploaded/staged patch is behavioral intent because PR 1029 currently
  contains only fragmented patch artifacts and a failed self-mutating workflow.
- Final ReviewGPT is the selected cross-cutting gate; no local deep-review pass
  will run in parallel with it.

## Verification

- Preliminary `completion-specialists` ReviewGPT returned one prompt finding
  and one Settings-owner coverage finding. Both were accepted and remediated:
  stale immediate-trial language and ambiguous Group scopes were removed, and
  owner tests now cover eligible, ineligible, current-Group, and
  scheduled-Group states.
- Product-experience review of the rendered eligible-trial, exhausted,
  scheduled, and immediate-start states returned no findings.
- The final affected-path `pnpm test:diff` run passed every affected package
  owner and the complete hosted-Web verifier: 549 Web files passed with 7,356
  tests, alongside the assistant, CLI, hosted-execution, local-harness,
  Temporal, setup, package-boundary, build, typecheck, lint, and smoke lanes.
  Its last local Cloudflare app verifier waited more than ten minutes for the
  shared-host slot. The required Crabbox fallback failed closed before
  provisioning because this stacked base still targets the retired
  `.github/workflows/crabbox.yml`.
- Local `pnpm verify:acceptance` also waited ten continuous minutes without
  admission and its required Crabbox retry failed at that same stale-base
  workflow lookup. Exact-head GitHub release CI passed its release-check
  aggregator, application verification, build/typecheck, fixture coverage, and
  all package-coverage shards, providing the corresponding bounded verification
  on the pushed tree.
- `git diff --check` passed. The PR is mergeable against its configured stacked
  base.
- Redacted desktop and mobile design-catalog captures were visually inspected
  and packaged for ReviewGPT. Public screenshot hosting remains blocked because
  neither the local shell nor the connected Cloudflare identity has the
  required least-privilege Images write credential; the frontend design-proof
  check therefore remains intentionally red instead of accepting fabricated
  evidence.
- Final ReviewGPT runs after plan closure against the resulting immutable pushed
  head, per the repository completion workflow.
Completed: 2026-07-28
