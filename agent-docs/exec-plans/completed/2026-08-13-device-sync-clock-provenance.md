# Separate device-sync provider cadence from local execution clocks

Status: completed
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make the provider-owned canonical reconciliation cadence visibly distinct
  from runner-local execution, mailbox-continuation, and checkpoint retry
  clocks at the narrow control-plane write boundary.

## Success criteria

- The private hosted canonical publication helper accepts provider account
  state plus the existing Web baseline, not an unconstrained raw timestamp.
- Local job availability, lease expiry, workspace wake, mailbox continuation,
  and checkpoint retry timestamps remain ordinary values under their existing
  owners and cannot be passed accidentally through that typed boundary.
- Wire/database schemas remain unchanged and no migration or compatibility
  layer is introduced.
- The change stays narrow, composable, and self-explanatory without branding
  every timestamp in the repository.
- Focused tests, typecheck, exact-head CI, required ReviewGPT stages, and parent
  final review pass.

## Scope

- In scope: the smallest internal type/constructor boundary around hosted
  provider-cadence publication, direct compile/runtime proof, and matching
  durable architecture wording only if the existing owner contract needs a
  precise update.
- Out of scope: wire-format changes, database changes, new scheduling logic,
  recovery behavior, new services, global timestamp refactors, production
  rollout guards, or the closed-loop scenario in the companion PR.

## Constraints

- Technical constraints: no as-any or double assertions, no sibling-internal
  imports, no dependency, and no broad value-object hierarchy. Keep conversion
  at the semantic owner boundary.
- Product/process constraints: ReviewGPT authors the patch; the parent treats
  it as untrusted intent, inspects every hunk, verifies it, and lands it as its
  own PR.

## Risks and mitigations

1. Risk: a brand that can be constructed from any string provides ceremony but
   no provenance.
   Mitigation: expose only a narrow constructor or derivation that accepts the
   provider-owned account/scheduling output.
2. Risk: branding serialized values causes repository-wide churn.
   Mitigation: unwrap at the existing control-plane wire boundary and keep
   persistence/contracts unchanged.

## Tasks

1. [x] Ask ReviewGPT for the smallest maintainable patch against the exact base.
2. [x] Inspect and apply the returned patch deliberately.
3. [x] Run focused proof and candidate review; remove unnecessary abstraction.
4. [ ] Commit, push, open the PR, and run required specialist/final gates and CI.
5. [ ] Resolve findings, perform parent final review, and merge when authorized
   and green.

## Decisions

- This PR is independent of the quiescence-contract PR.
- The boundary is deliberately local to canonical publication rather than a
  general timestamp type system.
- ReviewGPT selected deletion/dataflow narrowing: the private builder no longer
  receives `nextReconcileAt: string | null`. It derives ordinary publication
  from the provider-owned account and completion-fence deferral from the
  already-observed baseline.

## Verification

- `pnpm --filter @murphai/assistant-runtime typecheck`
  - Passed.
- `pnpm --filter @murphai/assistant-runtime test -- test/hosted-device-sync-runtime.test.ts -t "reconciliation keeps local continuation clocks out of canonical cadence publication"`
  - Passed. The package runner selected all 86 files; 2,286 tests passed and 4
    were skipped.
- `git diff --check`
  - Passed.
- Required exact-head GitHub Actions and routed ReviewGPT gates run after the
  candidate commit is pushed.
Completed: 2026-08-13
