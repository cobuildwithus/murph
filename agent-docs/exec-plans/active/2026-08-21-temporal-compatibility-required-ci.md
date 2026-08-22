# Require Temporal compatibility before merge

Status: active
Created: 2026-08-21
Updated: 2026-08-22

## Goal

- Make independently deployed Web-to-Temporal contract compatibility a loud,
  required pre-merge result while preserving the private worker as the sole
  integration and deployment owner.

## Success criteria

- A public pull request cannot merge a relevant hosted orchestration contract
  change without an exact-public-SHA compatibility result.
- The result exercises the supported private Temporal worker contract rather
  than pairing a new producer with only its same-checkout parser.
- The gate remains valid while blue and green worker deployments overlap: it
  protects compatibility with every still-supported reader revision, not a
  Render color or mutable deployment label.
- Missing dispatch, stale head, cancellation, timeout, or private integration
  failure stays visibly red or pending rather than becoming a skipped success.
- The implementation reuses the repository's existing trusted cross-repo CI
  patterns and adds no new service, queue, database state, or runtime owner.

## Scope

- In scope: the public CI/controller boundary, exact-SHA and result validation,
  focused deterministic tests, and matching verification/deployment docs.
- In scope when strictly required by the owner boundary: the smallest paired
  private-workflow contract needed to return an authenticated exact-SHA result.
- Out of scope: changing Temporal Workflow behavior, Render blue/green routing,
  production task queues, worker deployment policy, or the open blue/green PR.
- Out of scope: modifying the separately owned reconciliation wire-schema test
  PR; this task may rely on it after merge but must not co-author its branch.

## Constraints

- Keep the design contract-oriented and color-agnostic. Blue/green is a deploy
  mechanism; the compatibility set is the current and any retained supported
  Temporal reader revision that may still poll during rollout or rollback.
- Do not expose private repository contents, credentials, user data, health
  data, or raw integration logs through the public check.
- Use immutable public and private revision identities. Do not trust branch
  names, mutable tags, check names from arbitrary sources, or stale run results.
- Prefer one required aggregate result and existing GitHub App/controller
  machinery over another orchestration layer.

## Risks and mitigations

1. Risk: a same-checkout test repeats the original blind spot.
   Mitigation: execute the public candidate against the supported private reader
   revision set, including the still-live previous revision during blue/green
   overlap.
2. Risk: a path-filtered or canceled workflow reports success.
   Mitigation: keep one always-present aggregate check that explicitly validates
   selection, dispatch receipt, immutable run identity, and terminal success.
3. Risk: cross-repository credentials become available to pull-request code.
   Mitigation: reuse trusted default-branch controller code and a protected,
   least-privilege GitHub App/environment boundary; never run credentials in the
   untrusted PR checkout.
4. Risk: CI learns Render-specific state and becomes coupled to deployment
   implementation.
   Mitigation: pass immutable supported worker revisions from the private owner;
   colors and traffic percentages stay inside the private deployment system.

## Tasks

1. Inspect the current public/private integration and trusted cross-repository
   controller patterns, plus the open blue/green deployment contract.
2. Have ReviewGPT implement the smallest scoped patch and return an attachment.
3. Parent-review every hunk, integrate only the minimal maintainable design, and
   add or adjust focused tests and durable docs.
4. Run focused workflow, controller, and contract proof; inspect the final diff.
5. Commit, push, open the PR, then complete preliminary specialists, final
   ReviewGPT, exact-head CI, and mergeability proof.

## Decisions

- Product UX is not applicable: this changes internal verification and deploy
  safety, not member-visible behavior.
- A public exact-response-key test is useful local proof but is not the whole
  gate; independently deployed workers require an exact cross-repository check.
- Blue/green compatibility is modeled as a supported-reader set. CI must not
  infer safety from which color is currently named blue or green.
- Final ReviewGPT is required because this changes a cross-repository trust
  boundary and the pre-merge/deployment gate.

## Verification

- Focused workflow syntax and controller tests for selection, stale heads,
  missing credentials, dispatch receipt, private revision binding, timeout,
  cancellation, failed integration, and non-applicable changes.
- Exact test proving one public producer candidate is checked against every
  declared supported reader revision.
- Relevant typecheck/lint or `test:diff` surface when it remains the smallest
  truthful umbrella.
- Exact-head public CI, the private integration result, preliminary specialists,
  and final ReviewGPT with zero unresolved accepted findings.

## Progress

- ReviewGPT returned a concrete two-repository contract but no downloadable
  patch. The public controller, stable status workflow, focused contract tests,
  and durable owner docs were reconstructed from that retained response.
- The paired private compatibility-only workflow and immutable supported-reader
  tag remain a rollout prerequisite owned by private Murph Cloud; this public
  branch neither edits nor weakens that owner boundary.
- Focused controller tests, Node syntax, workflow YAML/action validation,
  provider-request boundaries, Temporal architecture guards, and docs drift
  pass locally. `pnpm test:diff` reaches repo-tools and then fails in pre-existing
  Frog autofix fixtures because their synthetic non-noreply Git identity is
  rejected by the installed privacy hook; the narrow failing test reproduces
  without touching this task's files.

## Completion

- Pending.
