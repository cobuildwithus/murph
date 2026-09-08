# Diagnose post-checkpoint lease version drift

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Distinguish whether a lease-version mismatch after a Web checkpoint reflects the returned workspace version or different workspace progress. Preserve checkpoint acceptance, validation, retry, and delivery behavior exactly.

## Evidence and ownership

A production conversation canary timed out waiting for a reply that was eventually delivered. Its foreground import failed at post-Web checkpoint lease validation. Existing diagnostics identify the stage and stale workspace version, but omit the returned checkpoint outcome and the live lease's relation to that returned version. The cause remains unresolved; no functional correction is justified yet.

The runtime checkpoint bridge owns lease validation. The existing foreground mailbox failure event owns this observation. No new event, network call, persistence owner, or monitoring service is needed. Existing runtime progress and hot-admission PRs do not change this boundary or answer this question.

## Scope and constraints

- ReviewGPT implements a narrowly typed, bounded diagnostic projection into the existing failure pipeline, plus focused synthetic tests and required owner documentation.
- Record only booleans or bounded enums needed to distinguish these outcomes. Never record raw versions, identities, credentials, payloads, or member content.
- Preserve all success paths, error codes and stages, throws, lease reads, callback counts, retries, and checkpoint semantics.
- No functional fix, schema, dependency, access, retention, or deployment-policy change.
- Old readers must accept the optional fields and old writers may omit them.

## Tasks

1. Completed: obtained and inspected ReviewGPT's implementation patch; production source matches that patch.
2. Completed: verified both diagnostic outcomes, absent diagnostics on unrelated failures, sensitive-value exclusion, and unchanged checkpoint outcomes through focused tests and typecheck.
3. Completed: parent reviewed the complete candidate; complexity and documentation checks passed; candidate committed and published as PR #2932.
4. Final ReviewGPT round 1 passed on commit 63b54a07a0abac620e6d44a92dc42c02062b9eb1 with no qualifying finding; required CI continues separately.
5. Operational follow-up: merge and deploy only after final-head CI and every canonical gate pass. The automation retains this condition and the exact natural-traffic query; no rollout is claimed here.
6. Operational follow-up: verify the deployed revision and aggregate natural failures by the two boolean fields. Absence of recurrence means unexercised telemetry, not a resolved underlying issue.

## Verification

- ReviewGPT implementation completed with verified model identity. Local inspection confirms two booleans only on the existing foreground failure event; no new effect, validation ordering, success semantics, or shared parser change.
- New diagnostic cases: 30 passed, covering accepted/conflict responses, both version relations, unchanged checks/effect counts, successful and unrelated outcomes, and hostile metadata exclusion through the actual foreground log seam and existing parser.
- Runtime semantic typecheck passed after three local test-only corrections: explicit return types on two synthetic error factories and removal of a checkpoint reason from a no-progress test result. Production source remains ReviewGPT-authored.
- Complexity passed: checkpoint bridge maximum 6 to 8, zero debt; workspace runner maximum 71 and debt 59 unchanged. Its three existing hotspots are unchanged orchestration functions; this observation does not justify refactoring them.
- Log privacy guard, documentation drift, and diff whitespace checks passed. Documentation gardening passed with zero issues. Full affected suites passed 209/210; the sole failure is the same pre-existing 250 ms queued-log assertion proved on the unchanged base. All 30 new cases pass in both the focused and full runs.
- Before implementation, the bridge suite passed 53/54, and the existing 250 ms queued-log independence assertion failed both in the full file and alone. The public-safe Frog entry records that reproducible baseline gap without claiming its cause or applying a workaround.
- Final ReviewGPT round 1: PASS on the pushed candidate above, with verified gpt-6-pro model identity. Independent review exercised 76 base/head bridge scenarios and the projection/privacy cases; it did not claim full Vitest reruns. No finding was accepted or left unresolved.
- Parent final review confirms production source remains telemetry-only. The parser and structured sanitizer match the previously observed ready Web revision, supporting old-reader compatibility without a coordinated release.
- This implementation plan closes with the reviewed code and proof recorded. Final-head CI, merge, canonical protected rollout, and read-only observation remain operational follow-ups owned by the same automation. No merge or deployment is claimed, and no runtime behavior or test assertion was changed to bypass the baseline gap.

## Decisions

- One telemetry improvement selected for this sweep.
- Internal-only observation; no member-visible changelog or product-flow change.
- Diagnostic overhead must be constant and restricted to an existing failure path.
Completed: 2026-09-05
