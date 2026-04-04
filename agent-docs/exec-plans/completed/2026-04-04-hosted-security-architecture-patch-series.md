# Hosted Security Architecture Patch Series

## Goal

Land the supplied five-patch hosted security architecture series safely on the current repo snapshot, preserving the intended security model while avoiding unrelated regressions.

## Scope

- Apply or port the five supplied patches across hosted Cloudflare, shared hosted execution/runtime, web control helpers, and any required durable docs.
- Keep the series aligned with the repo's current hosted execution architecture and trust-boundary rules.
- Run the required verification and final audit workflow before handoff.

## Constraints

- Treat the supplied patches as behavioral intent, not overwrite authority.
- Preserve any unrelated current-tree intent if patch drift appears.
- Do not expose secrets or personal identifiers in code, logs, docs, or commit metadata.
- Keep the implementation shaped around per-user envelopes and signed control flows, not a new global decrypt shortcut.

## Verification

- `git apply --check` for each supplied patch before landing
- Required repo checks for touched scopes after the landing
- At least one direct scenario proof for the changed hosted control/key-envelope flow

## Status

- In progress

## Notes

- This is a high-risk supplied patch landing because it changes auth, trust boundaries, runtime entrypoints, and hosted operational flow.
- If the patches apply cleanly in order, prefer preserving their commit boundaries with `git am`; otherwise port only the intended deltas manually and keep the resulting diff scoped.
Status: completed
Updated: 2026-04-04
Completed: 2026-04-04
