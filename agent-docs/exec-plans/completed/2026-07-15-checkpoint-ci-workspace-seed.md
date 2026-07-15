# Checkpoint CI workspace seed

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Restore the required runtime-checkpoint CI lane by provisioning the fixture member's hosted workspace before the test-only encrypted artifact route requests that member's runtime crypto context.

## Success criteria

- The recovery scenario uses the existing activation path before seeding encrypted artifacts.
- The focused hosted-local checkpoint E2E passes without weakening crypto-context authorization.
- Required scoped verification is green and the fix lands separately from the personality feature PR.

## Scope

- In scope: the failing checkpoint E2E setup and its focused verification.
- Out of scope: production crypto authorization, personality behavior, runtime architecture, or new harness abstractions.

## Constraints

- Technical constraints: preserve the active-member-plus-workspace crypto-context gate; reuse the scenario's established activation helper.
- Product/process constraints: keep this as a separate prerequisite PR so the already-reviewed personality patch remains unchanged.

## Risks and mitigations

1. Risk: Activation setup could add unrelated provider or delivery work.
   Mitigation: Reuse the exact activation setup already proven by the preceding scenario and capture provider/delivery baselines afterward.

## Tasks

1. Add the missing activation and workspace-completion setup to the second scenario.
2. Run the focused checkpoint E2E and required scoped checks.
3. Commit, open the prerequisite PR, and merge only after required CI passes.

## Decisions

- Preserve the production 403 for active members without a provisioned workspace; repair the test fixture ordering instead.

## Verification

- Commands to run: focused runtime checkpoint E2E, relevant typecheck/test lane, privacy scan, and required PR CI.
- Expected outcomes: fixture seeding succeeds and all checkpoint recovery assertions pass.
Completed: 2026-07-15
