# Goal (incl. success criteria):
- Land the watched `murph_target_area_port_shutdown_fix.patch` follow-up only where it still applies in the assistantd/device-syncd listener startup seam.
- Success means shared listener-port validation, fail-closed decimal parsing for the touched device-syncd env integers, and shutdown cleanup coalescing are implemented with focused tests and required scoped verification.

# Constraints/Assumptions:
- Keep scope limited to the downloaded patch seam; do not broaden into other control-plane or hosted surfaces.
- Preserve the already-landed listener-host and startup-rollback changes in this area.
- Preserve unrelated work and use only the exact touched paths in any commit.

# Key decisions:
- Treat the downloaded patch as behavioral intent, not overwrite authority, and integrate only the still-missing hunks.
- Reuse the shared runtime-state owner seam for listener port validation instead of duplicating numeric guard logic in assistantd/device-syncd.
- Keep verification scoped to the touched owners unless a truthful diff-aware lane expands further.

# State:
- in_progress

# Done:
- Read the watched thread export and inspected `murph_target_area_port_shutdown_fix.patch`.
- Compared the patch against the current tree and confirmed the earlier host-validation/rollback work is already present while the port-validation and shutdown-follow-up changes are still missing.

# Now:
- Register the lane and land the still-applicable code/test changes from the watched patch.

# Next:
- Run the required scoped verification and completion-workflow audit passes, then commit the exact touched paths.

# Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether `pnpm test:diff packages/runtime-state packages/assistantd packages/device-syncd` remains fully green in the current branch after the patch lands.

# Working set (files/ids/commands):
- Files: `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, this plan, `packages/runtime-state/{src/loopback-control-plane.ts,test/loopback-control-plane.test.ts}`, `packages/assistantd/{src/{config.ts,http.ts},test/{config.test.ts,http-startup.test.ts}}`, `packages/device-syncd/{src/{bin.ts,config.ts,http.ts},test/{bin.test.ts,config.test.ts,http-startup.test.ts}}`
- Commands: `git status --short`, `pnpm typecheck`, `pnpm test:diff packages/runtime-state packages/assistantd packages/device-syncd`, `pnpm test:smoke`
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
