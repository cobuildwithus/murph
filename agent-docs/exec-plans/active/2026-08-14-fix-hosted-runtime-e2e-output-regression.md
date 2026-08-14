# fix-hosted-runtime-e2e-output-regression

Status: active
Created: 2026-08-14
Updated: 2026-08-14

## Goal

- Restore the hosted-local integration scenarios that began receiving the
  Codex prompt/tool-definition payload instead of the deterministic synthetic
  scenario result, so the required Temporal orchestration gate can pass and
  the independently reviewed queue-provisioning deployment can proceed.

## Success criteria

- Identify and prove the root cause from the exact failing public merge.
- Apply the smallest owner-boundary fix without weakening scenario assertions
  or production runtime invariants.
- Pass the focused affected hosted-local scenarios locally.
- Complete the required ReviewGPT and exact-head CI gates, merge the repair,
  then refresh the private integration check that blocks murph-cloud PR #28.

## Scope

- In scope: public Murph hosted-local model/runtime harness code and focused
  tests directly responsible for the unexpected output across the nine failed
  scenario jobs.
- Out of scope: murph-cloud PR #28's already-reviewed queue provisioning logic,
  weakening required CI, production data mutation, or unrelated runtime work.

## Constraints

- Technical constraints: preserve Temporal replay compatibility and production
  provider/runtime behavior; tests must exercise the same production-shaped
  envelope instead of special-casing expected strings.
- Product/process constraints: isolated worktree/PR lane, focused local proof,
  preliminary completion-specialists review, final ReviewGPT because hosted
  execution is cross-cutting, green exact-head CI, and scoped commit/plan
  closure.

## Risks and mitigations

1. Risk: treating a model/provider symptom as a Temporal failure and changing
   orchestration unnecessarily.
   Mitigation: trace the received payload from scenario setup through the exact
   runner/model boundary before editing.
2. Risk: making tests pass through weaker assertions or a test-only production
   divergence.
   Mitigation: preserve assertions and repair the narrow deterministic harness
   owner with focused regressions.

## Tasks

1. Reproduce one representative failure on the exact current base.
2. Trace the synthetic model response selection and compare recent changes.
3. Implement the smallest root-cause correction and focused regression proof.
4. Run all nine affected scenario groups and relevant typechecks.
5. Commit, push, open the repair PR, and run required review/CI gates.
6. Merge the repair, refresh murph-cloud PR #28, then merge and deploy #28.

## Decisions

- GitHub branch protection makes the required Temporal orchestration check
  non-bypassable, so the repair must land before murph-cloud PR #28 can merge.
- Static inspection proves PR #28 cannot cause the scenario failures: its diff
  is limited to the protected deploy workflow, workflow-unit proof, and docs.
- The representative shell-output failure is caused by the production named
  permission profile entering a Wrangler-managed local Docker container whose
  outer security profile cannot host Codex's nested bubblewrap namespace.
- Keep the production permission profile unchanged. Only the already-validated
  loopback model-provider override under `NODE_ENV=test` selects the provider's
  workspace sandbox; the dedicated native runner gate remains the named-profile
  proof.
- The Junction Link scenario's provider stub returns a legacy one-field user
  payload. The pinned SDK now validates the complete user resource before the
  application adapter sees it, so the stub must return the current required
  provider fields for both resolve and create.
- The post-scenario PostgreSQL suite contains three independent crypto fixture
  mismatches: short synthetic KMS project names rejected by the production
  parser, an older current privacy key paired with a newer key, and a mock that
  does not implement the current signing and verification boundary. Repair the
  fixtures while leaving production validation unchanged.

## Verification

- Commands to run: the narrowest representative hosted-local Vitest target,
  then every affected CI scenario command discovered from the workflow map,
  plus focused typecheck/build owners for changed code.
- Expected outcomes: deterministic scenario results replace the leaked
  prompt/tool-definition payload; all affected assertions pass without test
  weakening; exact-head required CI is green.
- Completed focused proof: 309 assistant-engine/runtime tests passed; both
  changed packages typechecked; the candidate runner bundle assembled within
  budget; the shell-based cold preference recovery case passed against that
  rebuilt bundle. The Junction user stub has two focused response-contract
  tests passing and the Cloudflare package typechecks. The 33 affected
  PostgreSQL concurrency tests pass with the refreshed crypto fixtures and the
  web package typechecks. The exact combined private matrix is pending.
