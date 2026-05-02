Goal (incl. success criteria):
- Historical/completed handoff for the Greenfield v1 hard-cut cleanup. This file is not an active architecture source, execution plan, or current follow-up tracker.
- Success criteria are met when readers can tell the Greenfield cleanup is complete, know where current architecture lives, and do not find unresolved one-shot-vs-warm runner questions here.

Status:
- Historical/completed.
- Last verified: 2026-05-01.

Current architecture links:
- `ARCHITECTURE.md`
- `docs/architecture.md`
- `agent-docs/references/hosted-runtime-protocol.md`
- `apps/web/README.md`
- `apps/cloudflare/README.md`

Constraints/Assumptions:
- Treat this file as a point-in-time continuity artifact only.
- Use the current architecture links above for live hosted runtime, package-boundary, control-plane, and execution-plane behavior.
- Do not revive removed Greenfield compatibility or migration questions from this handoff without checking the current architecture docs first.

Key decisions:
- The Greenfield cleanup was completed as a hard cut rather than a compatibility-preserving migration.
- Current live docs own the architecture; this handoff records only resolved historical context.
- Hosted execution no longer uses the old run protocol as a live design source.

State:
- Historical/completed. No active work remains in this continuity file.

Done:
- Completed the Greenfield v1 hard-cut cleanup record.
- Reframed this file away from active implementation planning.
- Pointed readers to current architecture sources instead of embedding live architecture here.

Resolved:
- Hosted execution uses a warm per-user Cloudflare runner shell with bounded isolated workspace invocations.
- Each isolated invocation uses invocation-local writable cache and temp roots, scoped child environment, and bounded lifecycle handling inside the warm shell.
- The old run protocol is removed and is not a current extension target.
- The previous one-shot-only versus warm-runner question is resolved by the current warm-shell plus isolated-invocation architecture.

Now:
- No current work is tracked here.

Next:
- None. Use active execution plans and the coordination ledger for any new work.

Open questions (UNCONFIRMED if needed):
- None for this historical handoff.

Working set (files/ids/commands):
- Historical continuity file: `CONTINUITY_greenfield-v1-hard-cut.md`
- Current routing/architecture sources: see "Current architecture links" above.
