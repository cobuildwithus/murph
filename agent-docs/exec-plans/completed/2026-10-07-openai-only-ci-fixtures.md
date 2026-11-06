# Align OpenAI-only CI fixtures

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Restore CI proof for the OpenAI-only assistant and the current ReviewGPT pin.

## Success criteria

- Correct the reproduced stale fixtures, pass focused tests and typechecks, and
  leave the production behavior reviewed at `3aa8ea52b4` unchanged.

## Scope

- In scope: assistant-engine provider fixtures and CLI/tooling assertions.
- Out of scope: production behavior, migrations, dependencies, and deployment.

## Constraints

- Preserve the null-provider-to-OpenAI guard and keep scripted traffic local.
- Preserve the immutable first-reviewed head and accepted round-one PASS.

## Risks and mitigations

1. A fixture could contact the real provider after losing its custom default.
   Mitigation: use the supported explicit hosted OpenAI identity with the
   existing loopback fixture; retain request-count and effect assertions.

## Tasks

1. Diagnosed exact-head coverage failures and updated only stale fixtures.
2. Passed focused tests and affected typechecks; inspected the final diff.
3. Close and commit the plan; PR evidence and final CI remain delivery gates.

## Decisions

- ReviewGPT completed a valid full-snapshot PASS with zero findings. Isolated
  fixture and explanatory documentation corrections use the review loop's
  proof-only exception; they do not create another substantive review round.

## Verification

- Assistant-engine canonical preflight and live-fixture contracts: 13 passed.
- Scripted native runtime suite: 121 passed, six existing skips.
- Opt-in synthetic reaction-input measurement: two passed without fallbacks.
- Null-provider-to-OpenAI regression: passed.
- Focused CLI schema and release-script audit: two passed.
- Assistant-engine and CLI typechecks: passed after their final fixture edits.
- Parent diff review: six test files plus this plan/index; production unchanged.
- Final exact-head CI remains the PR completion gate.
Completed: 2026-10-07
