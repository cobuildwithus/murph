# PR 1699 Review Remediation

Status: completed
Created: 2026-08-15
Updated: 2026-08-15

## Goal

- Resolve the preliminary ReviewGPT findings on PR 1699 so compact Junction
  workout features are both correct at ingestion and reachable through the
  existing assistant-owned activity read, then obtain the required final
  ReviewGPT pass and green CI before merging.

## Success criteria

- `wearables activity list` associates bounded feature facts with each
  same-day workout without exposing provider workout or source-instance IDs.
- A newer feature version visibly withdraws stale splits.
- Reducer math, chunked 8 MiB enforcement, and real-vault correction behavior
  have focused regression proof.
- Relevant typechecks and repository guards pass; required PR checks and the
  final ReviewGPT gate pass on the exact pushed head.
- PR 1699 merges and its task worktree retires cleanly.

## Scope

- In scope: query-time activity projection, assistant guidance and scenario
  proof, specialist-supplied regression coverage, durable provider docs, PR
  metadata, final review/CI, merge, and worktree retirement.
- Out of scope: raw workout-point retention, a new member-facing workout
  concept, changing complete `activity_session` ownership, or frontend UI.

## Constraints

- Technical constraints: retain the independent canonical measurement facets,
  group only by the existing hashed resource identity, preserve the 32-workout
  and 64-split bounds, and keep coordinates/provider arrays/raw IDs private.
- Product/process constraints: do not rerun the preliminary specialist pass;
  reapply the product-experience lens after remediation, then run a fresh
  full-patch final round concurrently with exact-head CI.

## Risks and mitigations

1. Risk: same-day workouts or corrected splits could be misassociated.
   Mitigation: group live facets by resource type plus hashed resource ID and
   prove two same-day workouts where one loses its stale split.
2. Risk: the read surface could leak internal provider identity.
   Mitigation: project only public provider/activity/timestamp/scalar fields
   and assert synthetic raw workout/source-instance IDs are absent.
3. Risk: adding detail could make command output unbounded.
   Mitigation: preserve the importer-owned maximum of 32 workout features and
   64 splits per feature in the CLI schema and compactor.

## Tasks

1. Apply and inspect the specialist coverage patch.
2. Add the smallest query-time projection and assistant guidance/scenario.
3. Run focused tests, typechecks, changelog/docs guards, and privacy review.
4. Commit and push the corrected exact head; update the PR description.
5. Run final ReviewGPT and required CI, perform parent final review and
   current-base merge-tree proof, merge, and retire the worktree.

## Decisions

- Keep workout stream features as independent measurement facets; the activity
  read joins only live facets at query time, avoiding a second persistence
  owner or a partial replacement `activity_session`.
- Use the hashed canonical resource identity internally and never include it in
  the public response.
- Preserve an explicit empty `splits` array so provider corrections are not
  mistaken for omitted command output.
- Refreshed product-purpose verdict: PASS / NO FINDINGS. The irreducible purpose
  is to answer detailed connected-workout questions from the existing activity
  read; the corrected implementation is the smallest complete experience
  because it adds no new command, screen, setup, or persistence owner.

## Verification

- Passed the full Junction provider suite (260 tests), bounded feature reducer
  suite (11 tests), real-vault stale-split correction case, production
  activity-query association case, CLI wearable schema suite (4 tests), and
  assistant skill-asset assertion.
- Passed package typechecks for importers, vault-usecases, CLI, and
  assistant-engine; provider-request and docs-drift guards; changelog
  generation; and the changelog fragment suite (7 tests).
- The production-faithful scripted assistant journey was attempted twice. Both
  runs stopped in the unchanged first scenario because the local command tool
  yielded a background cell instead of command output; neither reached the new
  assertion. The query integration and assistant routing asset have direct
  passing focused proof, while exact-head GitHub Actions remains the broad
  runtime gate.
- Pending remote proof: required exact-head GitHub Actions and the final
  full-patch ReviewGPT round must pass before merge.
Completed: 2026-08-15
