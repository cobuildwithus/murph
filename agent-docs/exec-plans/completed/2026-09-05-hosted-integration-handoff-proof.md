# Restore hosted integration fixture and handoff diagnostics

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal and scope

Correct demonstrated hosted integration fixture mismatches and expose checkpoint barrier progress so the remaining Environment handoff timeout can be diagnosed. This follow-up is part of the authorized unified runner merge and deployment; it does not complete the rollout.

## Changes

- Synchronize the Linq-first concurrency fixture after the real member-row lock and before mailbox writes. Unchanged home routing correctly skips its upsert.
- Accept an exact replacement fence using either the same member-bound native-warm target or an observed pristine slot. Retained warmth must leave both observed pristine slots ready.
- Emit test-only checkpoint release/resume metadata, including whether the paused request was aborted. The signed foreground reply, canonical progress, and checkpoint ownership assertions remain unchanged.

## Verification

- Four PostgreSQL Telegram/Linq planner concurrency cases passed on a separate local test database.
- All 24 hosted-local test-container control tests passed.
- Cloudflare typecheck and Web prepared typecheck passed.
- Docs drift, complexity, and diff checks passed; source complexity maximum remains 15 with no hotspots above 20.
- Local container E2E cannot start because the native init requires an unavailable platform capability. Linux integration remains necessary; this follow-up does not claim to fix or pass the Environment reply timeout.

## Review and remaining rollout gate

Parent review traced the real route-lock and retained-target owners. Final ReviewGPT is exempt under the low-risk tests/tooling route; only the test-only container subclass module gains metadata. No production auth, runtime, schema, configuration, or provider behavior changes.

After this PR merges, rerun the private integration against the updated public revision, resolve any demonstrated timeout cause, then merge the companion and use the protected production deployment workflow. Production settings have not been changed by this task.
Completed: 2026-09-05
