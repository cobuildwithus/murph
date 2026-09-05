# Diagnose post-checkpoint lease version drift

Status: active
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
2. Verify both diagnostic outcomes, absent diagnostics on unrelated failures, sensitive-value exclusion, and unchanged checkpoint outcomes through focused tests and typecheck.
3. Review the complete candidate, run complexity and documentation checks, and create a scoped candidate commit and PR.
4. Run final ReviewGPT on the pushed candidate concurrently with required CI. Resolve findings under the current disposition policy.
5. Merge and deploy only if the final patch remains telemetry-only and every canonical gate is satisfied. Otherwise preserve the concrete blocker.
6. Verify the deployed revision and use a bounded aggregate query on natural failures. Absence of a recurrence does not prove the underlying bug resolved.

## Verification

- ReviewGPT implementation completed with verified model identity. Local inspection confirms two booleans only on the existing foreground failure event; no new effect, validation ordering, success semantics, or shared parser change.
- New diagnostic cases: 30 passed, covering accepted/conflict responses, both version relations, unchanged checks/effect counts, successful and unrelated outcomes, and hostile metadata exclusion through the actual foreground log seam and existing parser.
- Runtime semantic typecheck passed after three local test-only corrections: explicit return types on two synthetic error factories and removal of a checkpoint reason from a no-progress test result. Production source remains ReviewGPT-authored.
- Complexity passed: checkpoint bridge maximum 6 to 8, zero debt; workspace runner maximum 71 and debt 59 unchanged. Its three existing hotspots are unchanged orchestration functions; this observation does not justify refactoring them.
- Log privacy guard, documentation drift, and diff whitespace checks passed. Documentation gardening passed with zero issues. Full affected suites passed 209/210; the sole failure is the same pre-existing 250 ms queued-log assertion proved on the unchanged base. All 30 new cases pass in both the focused and full runs.
- Before implementation, the bridge suite passed 53/54, and the existing 250 ms queued-log independence assertion failed both in the full file and alone. The public-safe Frog entry records that reproducible baseline gap without claiming its cause or applying a workaround.
- Required CI, pushed-candidate final ReviewGPT, merge, and canonical protected rollout remain pending. No live replay or production mutation beyond the explicitly authorized telemetry rollout is permitted.

## Decisions

- One telemetry improvement selected for this sweep.
- Internal-only observation; no member-visible changelog or product-flow change.
- Diagnostic overhead must be constant and restricted to an existing failure path.
