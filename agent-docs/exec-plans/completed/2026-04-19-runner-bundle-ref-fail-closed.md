## Title

Fail closed on corrupted hosted runner bundle refs.

## Goal

Stop the runner read path from silently clearing malformed `bundle_ref_json` values. A corrupted stored bundle ref must remain persisted as-is, surface as corrupt runner state, and block bundle reads until an explicit repair writes a valid replacement.

## Constraints

- Keep scope narrow to the runner-state read path and focused Cloudflare tests.
- Do not broaden into new repair flows or schema changes.
- Preserve unrelated in-flight hosted runtime edits in the worktree.
- Treat malformed stored bundle refs as corruption, not a warning-grade fallback.

## Planned Changes

1. Remove the read-path sanitization/persistence behavior for malformed bundle refs.
2. Surface malformed stored bundle refs as fail-closed runner state errors.
3. Add regression coverage showing the stored corruption survives reads and blocks bundle loading.

## Planned Verification

- `pnpm typecheck`
- truthful scoped Cloudflare verification via `bash scripts/workspace-verify.sh test:diff ...` or focused Vitest commands if the diff-aware lane is not isolated enough for this busy worktree

## Notes

- Required proof for this task: seed malformed `bundle_ref_json`, call `readState()` and `readBundlesForRunner()`, and verify the stored ref is preserved while execution fails closed instead of being rewritten to `null`.
