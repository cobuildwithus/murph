# Reuse the Junction sandbox safely for native iOS E2E

Status: active
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Allow the hosted native iOS E2E lane to reuse the existing Junction sandbox
  without deleting or otherwise treating unrelated sandbox users as lane-owned
  state. Cleanup reads only the bounded identifier fields needed to separate
  namespaces and validate team ownership.
- Restore the required GitHub status on ordinary Web pull requests by finishing
  the protected GitHub, Vercel, database, Privy, Junction, and exact-iOS-revision
  configuration and proving the first live candidate sweep.

## Success criteria

- Production and ordinary development keep the existing `murph_` Junction
  client-user-id contract when no E2E namespace is configured.
- The native lane identifies and cleans up only users in its explicit E2E
  namespace, tolerates unrelated users on the same sandbox team, fails closed
  on multiple matching lane-owned users, and proves the namespace empty after
  cleanup.
- Focused controller, device-sync configuration, type, and contract checks pass.
- The protected GitHub environments contain every required variable and secret
  name, with values transferred without displaying or downloading them.
- The isolated Vercel project/custom environment and dedicated database are
  provisioned, an exact reviewed iOS revision is pinned, and the first live PR
  sweep plus required CI and ReviewGPT gates pass.

## Scope

- In scope:
  - Web controller cleanup and validation for a shared Junction sandbox.
  - The smallest explicit runtime configuration seam needed to emit an E2E-only
    Junction client-user-id prefix while preserving the default.
  - Focused tests and live owner documentation for the revised ownership rule.
  - Protected GitHub environment, Vercel, PlanetScale, Privy, Junction, and iOS
    revision setup needed by the candidate lane.
- Out of scope:
  - Production data mutation or production cleanup.
  - Junction team creation or alteration of unrelated sandbox users.
  - Enabling the read-only production canary before its separate production
    Privy test identity and post-deploy prerequisites are ready.

## Constraints

- Technical constraints:
  - Junction provides one shared sandbox team, so ownership must be encoded in
    a collision-resistant, enumerable client-user-id namespace.
  - Cleanup must remain deterministic after an isolated database reset; it
    cannot depend on reconstructing a deleted member id.
  - Test configuration must not weaken production runtime, auth, or provider
    invariants.
- Product/process constraints:
  - Secrets may move only through process environment/stdin or provider APIs;
    their values must not enter logs, files, command output, or review context.
  - Repository changes use the isolated worktree/PR path, focused local proof,
    preliminary specialist ReviewGPT, final cross-cutting ReviewGPT, and exact-
    head CI.

## Risks and mitigations

1. Risk: cleanup deletes another developer's Junction sandbox user.
   Mitigation: require an explicit normalized E2E prefix, request one bounded
   complete team inventory and fail closed if it is incomplete, select only
   exact prefix matches, and reject ambiguous lane-owned state.
2. Risk: an E2E-only configuration changes ordinary or production identities.
   Mitigation: keep the existing prefix as the default and cover both default
   and explicit-prefix behavior in focused tests.
3. Risk: credentials leak during environment provisioning.
   Mitigation: use names-only status reads and direct subprocess/API transfer;
   never pull, echo, serialize, or inspect provider secret values.
4. Risk: Web and iOS revisions drift during the sweep.
   Mitigation: dispatch the private workflow by immutable tag and verify its
   expected commit SHA before Web hands over the candidate URL.

## Tasks

1. Trace Junction client-user-id construction and controller cleanup ownership,
   then add failing focused tests for shared-team namespacing.
2. Implement the smallest explicit namespace seam and namespace-only cleanup;
   update the live CI/security/reliability contract documentation.
3. Run focused tests and type checks, inspect the complete diff, and commit the
   exact candidate.
4. Provision the isolated database and Vercel project/custom environment, wire
   protected GitHub names, and pin an immutable iOS revision without exposing
   secret values.
5. Push a PR, run the preliminary and final ReviewGPT gates with CI, remediate
   accepted findings, and merge only after the exact-head gates are green.
6. Run the first live candidate sweep, confirm the fleet-wide status is
   unblocked, and retire the worktree after merge.

## Decisions

- The existing Junction sandbox team is reused; lane ownership moves from the
  whole team to one explicit client-user-id namespace.
- The namespace is configuration, not persisted product state. The current
  device-sync owner remains responsible for constructing provider identities.
- Recovery deletes only the namespace-owned orphan. Unrelated team state is
  neither a blocker nor an admissible cleanup target.

## Verification

- Commands to run:
  - `node --test scripts/native-ios-hosted-e2e.test.mjs`
  - Focused device-sync configuration/provider tests selected from the touched
    paths.
  - The owning package typecheck selected from the repository verification map.
  - Names-only GitHub/Vercel configuration checks and an exact-revision live
    workflow dispatch.
- Expected outcomes:
  - Shared-team fixtures preserve unrelated users and clean the sole E2E user.
  - Default and explicit Junction prefixes are validated and deterministic.
  - No secret value appears in the diff, logs, plan, PR body, or tool output.
  - ReviewGPT gates, required CI, and the first live candidate sweep pass.
