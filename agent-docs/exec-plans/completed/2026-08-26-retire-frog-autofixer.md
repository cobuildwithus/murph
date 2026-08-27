# Retire the legacy Frog autofixer

## Goal

Remove the operator-owned launchd and nested-agent Frog autofixer now that
ChatGPT desktop scheduled tasks own the intended automation workflow. Preserve
the ordinary Frog friction logger, its skill, and historical audit records.

## Tasks

1. [x] Disable the installed LaunchAgent and close the obsolete repair PR.
2. [x] Remove the executable autofixer, dedicated tests, package entrypoints,
       ReviewGPT packaging extensions, and live owner documentation from Murph.
3. [x] Remove the canonical autofixer package and its dedicated review preset
       from `cobuild-agents`.
4. [x] Run focused verification and repository typecheck gates.
5. [x] Prepare coordinated branches for publication. Keep their worktrees until
       the replacement pull requests merge.

Status: completed
Updated: 2026-08-26
Completed: 2026-08-26
