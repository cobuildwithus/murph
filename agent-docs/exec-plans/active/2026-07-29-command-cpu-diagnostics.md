# Hosted command and CPU diagnostics

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make slow hosted Codex command actions attributable to the safe executable
  chain that actually ran.
- Make elevated container CPU attributable to the real executable when Linux
  reports an unhelpful mutable process name.
- Preserve the metadata-only observability boundary: no command arguments,
  file paths, prompts, user content, environment values, or secrets.

## Evidence

- A completed provider action lasted about 19 seconds but was persisted only
  as `cat`, even though the compound action launched another executable.
- The container CPU watchdog saw elevated CPU in the same interval, but the
  top process reported the generic Linux name `MainThread`.
- The watchdog's 20-second interval can miss short-lived child processes that
  start and exit between samples.

## Tasks

1. Persist ordered, allowlisted executable heads for compound command actions
   inside the existing turn-profile label.
2. Sample CPU on a shorter bounded interval and attach an allowlisted basename
   from `/proc/<pid>/exe` without retaining its path.
3. Add focused privacy, attribution, timing, and failure-isolation tests.
4. Run required focused verification, completion review, CI, and PR gates.

## Deployment concerns

- The turn-profile change remains compatible with the existing v1 label
  schema, so Web and Cloudflare do not require a tandem deploy.
- The CPU diagnostics activate only when the Cloudflare runner image is
  deployed; no database or alert-monitor migration is required.
