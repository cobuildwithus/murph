# 2026-03-17 Assistant iMessage Ink

## Goal

Port the incremental assistant iMessage delivery and Ink chat patch onto the current repo so `vault-cli assistant` gains outbound delivery plus the richer terminal chat UI without regressing the existing assistant runtime.

## Scope

- `packages/cli` assistant delivery/channel/runtime modules, command wiring, tests, generated incur types, and package deps
- command-surface docs that describe the new `assistant deliver` lane and `assistant ask --deliverResponse`

## Constraints

- Do not revert unrelated dirty work already in the tree.
- Keep assistant session metadata minimal and out of the canonical vault.
- Preserve the already-landed provider-backed assistant runtime behavior.
- Merge carefully with concurrent CLI/generated changes from the Telegram lane.

## Plan

1. Inspect the provided patch and diff it against the current assistant runtime.
2. Merge the outbound delivery layer and Ink-backed chat UI onto the live assistant modules.
3. Update tests, typegen, package metadata, and docs for the new command surface.
4. Run assistant-focused verification first, then repo-required checks, and commit only the assistant slice if the results are acceptable.
Status: completed
Updated: 2026-03-17
Completed: 2026-03-17
