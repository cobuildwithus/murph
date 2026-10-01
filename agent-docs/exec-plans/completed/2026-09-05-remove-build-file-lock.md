# Remove workspace build-file locking

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal

Remove the checkout-wide build-file mutex and all launch wrappers so local dev startup does not queue behind an unrelated verification command.

## Scope and decisions

Delete the lock implementation, reentrant environment plumbing, and lock-only tests. Call existing verification, preparation, and runner assembly owners directly. Preserve their prerequisite ordering, retries, exit propagation, shared-host capacity admission, and remote-worker execution ownership. No replacement lock or dependency. Historical completed plans remain unchanged.

## Risk

Concurrent commands that rebuild identical outputs in one checkout are no longer serialized. Separate worktrees provide independent build outputs. This is an explicit operator workflow change; no application auth, data, or runtime protocol changes.

## Product UX and changelog

Internal tooling only; no member-facing change or public changelog entry.

## Tasks

1. Remove lock implementation and callers.
2. Update affected tests and live workflow documentation.
3. Run focused tests, syntax checks, relevant typechecks, and parent diff review.
4. Commit the scoped deletion and prepare the normal PR lane.

## Verification

Passed: 64 tooling tests, 11 runner-image contract tests, 69 Web verification/migration contract tests, and the focused CLI escalation test. Tooling and Cloudflare TypeScript checks, shell/Node syntax, and complexity guard passed (no hotspots above 20). Parent review confirmed prerequisite ordering, existing exit propagation, and remote candidate isolation. Doc drift and gardening passed after updating the owner index. Existing Frog issue #2495 records artifact-lock blocking; no duplicate report.
Completed: 2026-09-05
