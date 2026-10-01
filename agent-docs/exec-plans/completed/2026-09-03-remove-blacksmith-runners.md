# Remove Blacksmith runner spend

Status: completed
Created: 2026-09-03
Updated: 2026-09-04

## Goal

- Eliminate every spending path from the owned GitHub organization to
  Blacksmith runners while preserving required CI and deploy workflows on
  GitHub-hosted runners.

## Success criteria

- The public repository no longer contains a dispatchable Blacksmith Testbox
  workflow, Blacksmith/Crabbox provider configuration, or a verification
  executor that can create paid Testboxes.
- The private cloud repository's active workflows use GitHub-hosted runner
  labels and retain their existing triggers, permissions, environments,
  conditions, and job graph.
- Current operational, security, architecture, and verification docs describe
  only the remaining local, static-SSH, and GitHub-hosted paths.
- Focused tests and workflow/config checks pass, exact-head CI and required
  review gates pass, and both changes land on their default branches.
- A fresh authenticated inventory finds no owned default-branch workflow or
  executable repository configuration referencing Blacksmith.
- The owned organization no longer grants the Blacksmith GitHub App access,
  and any remaining Blacksmith billing or data-deletion step is completed or
  handed off with the exact official control required.

## Scope

- In scope: the public Murph verification dispatcher and its tests/config/docs;
  the private Murph Cloud runner labels and runner-specific documentation; the
  Blacksmith GitHub App installation and billing/data-retention handoff.
- Out of scope: historical release notes and completed execution plans;
  repositories owned by organizations where the authenticated account is not a
  member; unrelated CI redesign or test-suite reduction.

## Constraints

- Technical constraints: keep the static macOS SSH executor intact; use
  `ubuntu-24.04` for migrated x64 Linux jobs; preserve protected-main and
  GitHub Environment gates; do not expose secrets or private identifiers.
- Product/process constraints: use isolated task worktrees and scoped commits;
  update every live owner doc affected by deleting the paid executor; run
  ReviewGPT concurrently with CI where required; do not claim account teardown
  until the GitHub App and Blacksmith-side billing state are verified.

## Risks and mitigations

1. Risk: GitHub-hosted private runners have less CPU and memory than the
   retired Blacksmith labels, which may make heavy Docker/E2E jobs slower or
   expose resource assumptions.
   Mitigation: preserve the workflow graph and resource-bounding controls, run
   focused static checks locally, then require exact-head CI before merge.
2. Risk: deleting the Testbox path could accidentally break the free static
   SSH executor because both share a sanitized verification core.
   Mitigation: delete only paid-provider selection/configuration and retain
   focused static-SSH and local dispatcher coverage.
3. Risk: workflow edits stop future runner spend but do not themselves cancel
   the vendor account or revoke its GitHub App.
   Mitigation: verify the installation before and after repository migration,
   revoke it through the organization-owner control, and use Blacksmith's
   official account/data-deletion path for any state not exposed through the
   authenticated CLI/API.

## Tasks

1. Inventory owned repositories, default-branch Blacksmith workflow content,
   active jobs, and organization app installations.
2. Remove the public paid Testbox workflow/provider/executor while preserving
   local and static-SSH verification behavior and focused tests.
3. Migrate every private cloud job from Blacksmith to GitHub-hosted Ubuntu and
   update runner-specific comments and live owner docs in both repositories.
4. Run focused verification, privacy review, diff review, and scoped commits.
5. Open draft PRs, complete required CI and ReviewGPT gates on exact heads,
   merge, and verify the default branches no longer admit Blacksmith work.
6. Revoke the Blacksmith GitHub App installation, verify its absence, and
   complete or precisely hand off vendor billing/account deletion.

## Progress

- Completed the authenticated organization and workflow inventory. Only the
  public Murph repository and the private Murph Cloud repository contained
  owned live Blacksmith spending paths, and neither had an active affected run.
- Deleted the public Testbox workflow, provider configuration, trusted paid
  entrypoint, and paid dispatcher branch while retaining local and static-SSH
  verification.
- Replaced every private-cloud Blacksmith runner label with GitHub-hosted
  Ubuntu while preserving the existing job graph and workflow controls.
- Updated live owner documentation and regression tests in both repositories;
  historical records remain unchanged.
- Local public-repository proof is green: focused dispatcher and static-core
  tests, CLI audit-packaging tests, syntax checks, `pnpm complexity:diff`, and
  full `pnpm typecheck`.
- Local private-cloud workflow parsing, contract tests, typecheck, build, and
  built-worker tests are green. The broad verification run passed all stages
  through its 646-test coverage suite, then reported two unchanged Temporal
  deploy timing failures out of 126 tests; one passed alone and one reproduced
  alone. Exact-head GitHub-hosted CI remains the merge authority.
- Public final ReviewGPT passed with no findings. Private-cloud preliminary
  review found a missing permanent runner-label invariant; the existing
  repository-wide workflow gate now covers all eleven migrated jobs and a
  deliberate negative control fails as expected. Private-cloud final round 1
  identified the smaller standard-runner resource envelope; the pull request
  now discloses that intentional cost tradeoff. Final round 2 passed with no
  findings, and no accepted review finding remains unresolved.
- Parent final review found no remaining live provider path, personal identifier
  leak, merge-tree conflict, or proof gap within either repository diff.
- Pending external completion after merge: default-branch reinventory, GitHub
  App revocation through the organization-owner control, and vendor-side billing
  or data-deletion confirmation. These controls are intentionally not encoded
  in the repository and remain part of the final operational handoff.

## Decisions

- Treat organization ownership and a visible Blacksmith installation as the
  billing scope. Do not modify `openclaw`, which is merely an accessible
  external repository and not an organization membership.
- Preserve historical records; removal applies to live workflows, executable
  configuration, current docs, and external access.
- No active affected workflow run existed at inventory time, so no run needed
  cancellation.
- Standard GitHub-hosted Ubuntu is intentionally smaller than the retired paid
  runner class. Preserve current concurrency and deadlines while exact-head
  target runs are green; change only a pressure point demonstrated by those
  runs rather than pre-allocating another paid runner class.

## Verification

- Commands to run: focused dispatcher and trusted-entrypoint tests; workflow
  YAML parsing and repository-specific policy tests; `git diff --check`;
  `pnpm complexity:diff` where authored JavaScript changes; private
  `pnpm verify`; exact-head GitHub Actions and required ReviewGPT gates.
- Expected outcomes: remaining local/static-SSH paths pass; all migrated jobs
  retain valid workflow structure; no live owned Blacksmith reference or
  runner label remains; both default branches and the app-installation
  inventory confirm the spending path is closed.
Completed: 2026-09-04
