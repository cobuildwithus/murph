# Hosted Working Delta Diagnostics

Status: completed
Last reviewed: 2026-05-08

## Goal

Explain why hosted working commits are emitting thousands of files before changing checkpoint semantics further.

Success criteria:

- Working checkpoint logs summarize delta upserts and tombstones by reason and safe path class.
- Logs stay metadata-only: no raw paths, file contents, message contents, user identifiers, or secrets.
- Diagnostics preserve the working-commit invariants from the hosted workspace checkpoint plan.
- Focused Cloudflare tests cover the new diagnostic fields.

## Constraints

- Do not create a new persistence system, queue, or journal.
- Do not weaken the durable working commit checkpoint path.
- Do not make browser-vault or optional side work part of foreground durability.
- Do not switch branches or use a helper worktree.

## Current Hypothesis

Live latency is dominated by foreground working commits emitting a large replacement delta. We need to distinguish:

- real content changes since the base snapshot
- new portable files
- deleted portable files
- representation churn, such as legacy inline raw files becoming artifact refs
- base staleness that causes every checkpoint to re-emit the same broad overlay

## Verification

- Focused runtime-bridge workspace test for redacted working delta diagnostics.
- Cloudflare typecheck if production code changes.
Updated: 2026-05-08
Completed: 2026-05-08
