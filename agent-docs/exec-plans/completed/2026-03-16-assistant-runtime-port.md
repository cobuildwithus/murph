# 2026-03-16 Assistant Runtime Port

## Goal

Port the assistant runtime slice from the provided archive into the current repo so `vault-cli assistant ...` exists with provider-backed session state, minimal local metadata storage, and inbox auto-routing integration.

## Scope

- `packages/cli` assistant runtime modules, command wiring, tests, and generated incur types
- Required architecture / command-surface / verification docs that describe the new assistant lane

## Constraints

- Do not revert unrelated dirty work already in the tree.
- Keep chat transcripts out of canonical Healthy Bob storage.
- Assistant session metadata belongs in `assistant-state/`, outside the canonical vault.
- Inbox model routing remains separate from local assistant chat state.

## Plan

1. Compare current assistant/inbox CLI code with the archive slice and identify merge points.
2. Port runtime/state/provider modules and wire the `assistant` command group.
3. Update tests, typegen artifacts, and docs to match the new command topology and storage boundary.
4. Run required verification and completion audit passes, then commit touched files if green or clearly blocked for unrelated reasons.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
