# Remove unused snapshot manifest persistence and correct fixture root layouts

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and accepted scope

Apply the accepted single Complexity Collapse from PR #3190 round two: delete the unused skipped-inline manifest persistence owner. Both earlier completed plans remain immutable. Keep generic inline callbacks and delta codecs, legacy ref decoding and object GC, current v2 restore, canonical receipt recovery, media decisions, and clean markers. Existing cache files remain inert and excluded by the current archive policy; add no migration or cleanup machinery.

## Decisions and risks

- Exhaustive package, app, script, and export searches found only two test consumers. Remove constants, dedicated type, persistence helpers, and exclusive imports; use the existing generic inline callback type in tests.
- Previous-head CI exposed a deterministic test adapter root mismatch: nested vault bytes were installed at the durable root. Supply the explicit nested fixture segment while retaining staged root replacement. Keep the shutdown source image outside the replaced durable root. Other nested fixture callers already supply explicit snapshot ports.
- Preserve all retention, ordering, timeout, stale-removal, and current recovery assertions. Do not change production restore behavior to accommodate test archives.
- Deployment order and rollback floors remain unchanged. No production data action or deployment is part of this correction.

## Tasks and verification

1. Remove only the obsolete manifest owner and correct stale owner-document clauses.
2. Prove stale and malformed cache manifests are untouched and excluded while durable files remain included.
3. Reproduce and correct both CI fixture failures; add flat/nested placement, restored pending-input, and stale-file removal proof.
4. Run focused tests, relevant typechecks, complexity, docs drift, privacy and whitespace checks; preserve first and previous reviewed heads in the PR body.
5. Commit and push the correction for parent-owned round-three review and exact-head CI.

## Results

- Production correction is 121 net lines deleted, with no replacement behavior. The generic skipped-inline callback and delta-preservation assertions remain.
- Runtime-state hosted-bundle: 68 passed. Cloudflare workspace-snapshot-local and runtime-bridge-workspace: 70 passed. Current v2 restore/Codex continuity and receipt suites: 35 passed.
- Runtime-state, assistant-runtime, and Cloudflare typechecks passed after the manifest deletion. All nine changed source owners pass complexity; the shared archive visitor remains 27 with debt 7 unchanged.
- The two previous-head CI failures reproduced locally with missing nested vault state. Explicit fixture layout then made both original cases pass without deadline or semantic assertion changes. The final four-case run passed both original cases and flat/nested placement proof, with no unhandled errors. Assistant-runtime typecheck passed again after the fixture correction.
- Parent reviewed the bounded production, test, and owner-document changes. Exact-head CI and same-thread round-three review remain parent-owned completion gates.
Completed: 2026-09-10
