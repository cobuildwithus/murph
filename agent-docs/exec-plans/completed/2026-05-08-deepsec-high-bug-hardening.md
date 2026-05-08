# DeepSec High Bug Hardening

## Goal

Close the current DeepSec `HIGH_BUG` findings with small, durable fixes:

- Account deletion does not orphan hosted Cloudflare/R2 user data.
- Device-sync OAuth completion is not undone by post-commit runner handoff failures, and token refresh does not depend on long external calls inside DB transactions.
- Quarantine pruning cannot delete arbitrary persisted paths.
- CLI blood-test/workout mutations do not corrupt unrelated or existing records.
- Goal/regimen explicit links are validated before canonical writes commit.
- Garmin/raw ingest paths do not silently hash or persist non-JSON/binary-like payloads as lossy JSON.
- Document/meal/event mutations require direct target identity, not related-record lookup aliases.

## Constraints

- Preserve unrelated dirty worktree edits, especially existing device-sync fixes.
- Prefer local invariant checks over broad rewrites.
- Do not add new persistence contracts unless a minimal validation boundary closes the issue.
- Do not expose secrets, local paths, or personal identifiers in docs/tests/output.

## Verification Plan

- Focused tests around each changed owner where tests already exist.
- Touched package typechecks.
- `git diff --check` for the scoped paths.
- Repo-level checks if not blocked by unrelated dirty worktree failures.
- Required security/final audit passes before handoff.

## State

- Created from the completed DeepSec run's 13 `HIGH_BUG` findings.
- Implementation complete; focused verification and required audits ran.
- Post-audit fixes landed for Cloudflare fail-closed deletion, cross-instance token refresh serialization, metadata preservation, Garmin descriptor minimization, and mailbox-id log minimization.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
