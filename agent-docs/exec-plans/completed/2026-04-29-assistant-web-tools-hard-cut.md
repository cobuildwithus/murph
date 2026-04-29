# Hard-cut unreachable assistant web tools

## Goal

Delete the old Murph-owned assistant `web.fetch`, `web.pdf.read`, and provider-agnostic `web.search` implementation after the Codex App Server cutover, then remove the tied dependency and hosted-env/docs residue.

## Scope

- Remove unreachable assistant-engine web fetch/search/PDF source and direct tests.
- Remove stale dependency declarations and lockfile entries only where they were carried for those tools.
- Stop forwarding Murph web-search/fetch env vars through hosted runtime/deploy config.
- Update current durable docs so Codex App Server owns web-search event behavior and Murph no longer documents its own web-read tools.
- Remove stale public subprocessor copy for the old Murph-owned search-provider surface.

## Constraints

- Preserve unrelated dirty work and existing active hard-cut rows.
- Keep Codex App Server normalized `web.search` event handling in `assistant-codex-events` intact.
- Do not edit historical completed execution-plan snapshots except for ordinary residue scans.

## Verification Plan

- Residue scans for removed source paths, exported symbols, Murph web env names, dependency names, and stale public search-provider copy.
- `pnpm install --lockfile-only` if manifests change the lockfile.
- `pnpm typecheck`.
- Truthful assistant-engine/package diff verification, or package-local coverage if `test:diff` is blocked by unrelated dirty work.
- Required completion audit passes for this standard repo change.

## State

- Created after static search found no active import path into the old modules.
- Existing working tree is heavily dirty with concurrent rows; this lane will stage only its touched files.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
