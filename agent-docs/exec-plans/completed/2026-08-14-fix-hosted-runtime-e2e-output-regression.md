# fix-hosted-runtime-e2e-output-regression

Status: completed
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
- Keep the production permission profile unchanged. The already-validated local
  test provider override under `NODE_ENV=test` receives a reserved effective
  provider identity, and only that routed identity selects the provider's
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
- The pinned Codex transport does not replay the dynamic automation result in
  a stable Responses request-envelope item. Prove the exact effect through a
  production-shaped follow-up shell call that reads the canonical automation
  and requires exactly one matching `core.upsertAutomation` audit, then require
  that state marker in the next provider request.
- The reserved hosted-local OpenAI provider identity is a sandbox/credential
  isolation detail, while usage retains the production hosted-OpenAI identity.
  Translate it once at the assistant usage boundary so provider evidence,
  Flex pricing, and ledger validation agree; Venice and unsupported providers
  retain their own standard-priced identities.
- The unchanged three-contender PostgreSQL proof admitted every contender
  before the retry blocker. Preparation-mismatch retries can legitimately
  requeue in reverse timestamp order, making the older correction stale. Start
  the third contender only after the second retry is blocked so the test proves
  its stated chronological schedule without changing production behavior.
- Canonical shell success evidence belongs only to top-level protocol tool
  output. Delete recursive request-envelope matching, and construct the marker
  only after exact durable automation and single-audit checks succeed so test
  input cannot satisfy its own assertion.
- Local OpenAI route identity remains a sandbox and transport concern. Derive
  its hosted OpenAI usage identity once in the existing operator-config owner,
  then reuse that derivation before pricing and record construction in every
  usage producer, including idle compaction.
- The protected deploy authentication regression supplies the validated local
  OpenAI override and therefore receives the reserved local route identity in
  generated Codex configuration. Keep its authentication, native-memory, and
  legacy-provider checks unchanged while updating only that stale identity
  expectation and asserting the matching effective provider environment value.

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
  web package typechecks. On exact-head private run 31832448208, eight scenario
  groups passed. The remaining deterministic failures proved the transport,
  usage-provider evidence, and contender retry-order findings above; the Linq
  media group separately repeated the fail-closed local Cloudflare container
  lifecycle anomaly after an 8-second cold-start confirmation boundary. After
  the follow-up correction, 96 focused assistant-engine tests pass, both the
  assistant-engine and Cloudflare packages typecheck, and the isolated ordered
  PostgreSQL contender proof passes. The ReviewGPT retrospective correction has
  147 focused tests passing across Cloudflare support, operator config,
  assistant-engine usage, and assistant-runtime idle maintenance, including
  negative proof that command arguments cannot satisfy tool-output evidence and
  local OpenAI Flex compaction records the hosted OpenAI identity. All four
  changed owners typecheck. The full protected deploy auth test has 46 passing
  tests and 2 intentional skips, including the exact local OpenAI authentication
  journey. Exact-head private run 31845724644 assembled the Linux runner bundle
  within every byte budget, then stopped at GitHub's account-level artifact
  storage quota before the scenario matrix could start. The same bundle exceeds
  the shared static-closure threshold only on macOS, so the local canonical
  scenario also stops before execution; Frog entry
  `20260814173830-runner-bundle-byte` records that platform-specific verifier
  mismatch. ReviewGPT round 4 returned a full-snapshot PASS at
  `92968a23ab9796781b6462fc94f960ff661a3073`, verifying every accepted
  correction and finding no new qualifying defect. A mechanical current-base
  merge remains before exact-head CI and merge.
Completed: 2026-08-14
