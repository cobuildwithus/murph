# Hosted CLI Bridge Return Target

## Goal

Preserve hosted messaging-return behavior for `vault-cli device connect` when it runs through the hosted CLI bridge. Device connect links created from hosted iMessage/Linq or Telegram assistant turns should carry a server-owned `messagingReturnTarget` to the hosted web connect-link route.

## Constraints

- Keep rejecting CLI/model-supplied return metadata.
- Do not expose raw provider payloads, contact ids, message bodies, secrets, local paths, or OAuth URLs in logs or docs.
- Keep the change scoped to hosted runtime bridge wiring and directly coupled tests.

## State

In progress.

## Done

- Read routing, verification, security, and completion workflow docs.
- Located the hosted CLI bridge, hosted helper path, web connect-link route, and focused bridge tests.

## Now

- Thread server-owned messaging return metadata into the bridge from hosted conversation wake metadata.

## Next

- Add focused tests for bridge propagation and model-supplied metadata rejection.
- Run focused verification, required audit passes, and commit if the worktree allows a safe scoped commit.

## Open Questions

- None.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/cli-runtime-bridge.ts`
- `packages/assistant-runtime/src/hosted-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts`
- `apps/cloudflare/src/runtime-bridge-workspace.ts`
- `packages/assistant-runtime/test/hosted-runtime-cli-runtime-bridge.test.ts`
- Focused runtime/bridge tests
Status: completed
Updated: 2026-05-03
Completed: 2026-05-03
