# Classify command failures in runtime issues

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Make failed Codex command issues attributable to the same finite, privacy-safe
  command families already used by hosted turn profiles, without persisting
  command text, arguments, paths, or output.

## Success criteria

- Failed direct Vault CLI commands retain their bounded command family in the
  runtime issue detail.
- Search recovery behavior remains unchanged.
- Ambiguous or executable shell shapes still fail closed to the generic
  `command` family.
- Focused tests, package typecheck, diff checks, exact-head CI, and required
  review gates pass.

## Scope

- In scope: reuse the existing command-family classifier in the runtime issue
  tracker and update focused regression coverage.
- Out of scope: raw command capture, argv or output persistence, new database
  fields, new telemetry services, and Vault CLI behavior changes.

## Constraints

- Technical constraints: one finite classifier remains the source of truth;
  search-specific recovery metadata must stay search-only.
- Product/process constraints: production evidence stays summarized and no
  private row, identifier, command, path, or output enters repository artifacts.

## Risks and mitigations

1. Risk: broader classification could accidentally retain command content.
   Mitigation: store only the existing closed union returned by
   `resolveCodexCommandFamily` and assert shell-control inputs remain generic.
2. Risk: changing the diagnostic family could alter tolerated search failures.
   Mitigation: keep the recovery branch explicitly keyed to `search` and retain
   its focused tests.

## Tasks

1. [x] Replace the local `search | unknown` classifier with the existing finite
   command-family type and resolver.
2. [x] Add focused command-failure and fail-closed tests.
3. [x] Run scoped local verification and package the exact candidate for its
   draft PR and review gates.

## Decisions

- Reuse the existing transient classifier; do not add schema or storage.

## Verification

- Commands to run: focused assistant-engine Vitest slices, assistant-engine
  typecheck, `git diff --check`, and the routed PR checks/reviews.
- Expected outcomes: Vault families are visible as bounded labels, unsafe
  display commands remain `command`, search recovery behavior is unchanged,
  and all checks pass.
- Result: assistant runtime-turn slice passed 44/44; assistant-engine typecheck
  and `git diff --check` passed. Exact-head CI and managed review remain PR
  gates.
Completed: 2026-08-26
