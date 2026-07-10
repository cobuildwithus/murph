# Vestigial Repository Cleanup

## Goal

Remove only repository artifacts that have direct evidence of being obsolete, while preserving canonical product content, historical research provenance, supported compatibility surfaces, and active rollout seams.

## Constraints

- Preserve unrelated work and perform the cleanup in an isolated worktree.
- Keep `downloads/30-page-builder/**`, feature audit artifacts, public compatibility APIs, hosted-local compatibility entrypoints, and recent warm-deploy callbacks.
- Delete runtime/config files only when repository search proves there is no caller.
- Remove the direct `@radix-ui/react-dialog` declaration only; retain the shadcn Base UI Dialog and the `vaul` dependency that transitively uses Radix Dialog.
- Update the lockfile with the manifest and run dependency guards plus truthful scoped verification.
- Do not rewrite historical completed execution plans.

## Plan

1. Reconfirm each candidate has no live caller or unique canonical content.
2. Add ignore rules for repository-local worktrees and transient research PID files.
3. Delete the verified dead loader, expired shim, stale PID files, and superseded planning/migration notes.
4. Remove the redundant direct web dependency and refresh the lockfile.
5. Run reference checks, dependency checks, scoped tests/typechecks, and required completion audits.
6. Review the final diff, close the plan, and create a scoped commit.

## Verification

- `git diff --check`
- stale-reference and candidate-consumer searches
- `pnpm deps:guard`
- `pnpm deps:audit`
- `pnpm test:diff` for the touched config, Cloudflare, web manifest, lockfile, and documentation surfaces

## State

Complete and ready for the scoped commit.

- Direct stale-reference, ignore-rule, diff, and privacy-path checks passed.
- Dependency policy passed; Radix Dialog remains only through `vaul` after the direct declaration removal.
- Hosted web typecheck and full verify passed: production build, dev smoke, lint with no errors, and 4,137 tests.
- Cloudflare full verify passed: typecheck, 1,687 Node tests, and the Workers test.
- Focused repo-tool verification passed with 300 tests.
- Root typecheck passed every package except hosted web was terminated during concurrent fanout; the isolated hosted web typecheck passed.
- Dependency audit remains red on pre-existing locked transitive advisories; no package version or vulnerable resolution changed in this cleanup.
- Required coverage-write audit found the existing behavioral proof sufficient and made no edits.
- Final diff review confirmed canonical replacements and all explicit preservation boundaries.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
