# vault-cli startup import hygiene

## Problem

Every hosted assistant turn shells out to `vault-cli` multiple times; production turn profiles (2026-06-11) show ~1.9s per invocation in the runner container, multiplying into 30–85s of tool time per turn. Local profiling found the dominant cost is an import-graph leak that defeats the CLI's existing scoped lazy-loading design:

- `vault-cli-llms-normalizer.ts` (installed on every invocation, scoped and full) statically imports `vault-cli-command-manifest.ts`, which statically imports every command-registration module, including the interactive assistant chat UI.
- `assistant-cli/commands/assistant.ts` statically imports `assertAssistantInkInteractiveInputAvailable` from the ink chat surface, dragging `ink` → React → `yoga-layout` WASM into the eager graph (~337ms of ~510ms local startup; ink/react/yoga load on a `wearables day` read that never renders UI).
- `meal` is missing from `lazyRootCommands`, so meal reads (now the recommended intake surface in the assistant system prompt) always take the full-registration path.

Measured locally: stubbing the manifest leak alone cuts scoped invocations from 0.51s to 0.36s user CPU and drops ink/react/yoga from the module graph (145 → 60 modules).

Bundling with esbuild was evaluated and rejected for now: the eager ink graph contains top-level-await WASM loading (`yoga-layout`) that deadlocks a single-file bundle (silent exit-0 failures observed), and bundling would paper over the import leak instead of fixing it. Fixing the leak removes the blocker if bundling is ever revisited.

## Changes

1. `packages/cli/src/vault-cli-llms-normalizer.ts` — load the command manifest lazily, only when an `--llms` normalization request is actually being served.
2. `packages/assistant-cli/src/commands/assistant.ts` — import the ink interactive-input assertion lazily inside the chat command handler (mirrors the existing lazy `runAssistantChatWithInk` import in `assistant-runtime.ts:93`).
3. `packages/cli/src/vault-cli-routing.ts` + `packages/cli/src/vault-cli-command-routing.ts` — add `meal` as a scoped lazy root.
4. `packages/cli/src/commands/model.ts` — make the default setup-assistant wizard dependency a lazy wrapper so the ink-based setup wizard no longer loads at full-path command registration.
5. `packages/cli/test/vault-cli-startup-imports.test.ts` (new) — regression guard: hot-path modules are imported with the manifest/chat-ink/wizard modules mocked to throw, so re-introducing any of the removed static imports fails CI (non-vacuousness proven by temporarily re-adding each import).
6. `packages/cli/test/assistant-cli.test.ts` — `runInProcessCliWithTty` now scopes its `fs.openSync` stub to `/dev/tty`; the previous blanket stub broke Node's own module-file reads once the chat command lazy-imports its ink surface.

Note for the hosted runner bundle dependency prune lane: `ink` is now startup-unused but must remain installed in the runner bundle — hosted `chat`'s curated fail-closed error loads it lazily.

## Measured results (local, user CPU)

- scoped `wearables day`: 0.51s → 0.32s; `meal totals`: 0.54s (full path) → 0.32s (scoped); full `--help`: 0.61s → 0.46s.
- ink/react/yoga-layout: zero resolutions in the runtime module graph on scoped and full paths (loader-hook trace).
- `--llms` and `--llms-full --format json` outputs byte-identical to pre-change baseline, hints still injected.

## Verification

- `pnpm test:diff` over the touched files (owner coverage for `packages/cli` and `packages/assistant-cli`).
- Module-graph proof: a loader-hook trace of `vault-cli wearables day`, `vault-cli meal totals`, and `vault-cli list` confirms no `ink`/`yoga-layout` resolution.
- Timing proof: user-CPU comparison before/after for scoped and full invocations.

## Status

Active.
Status: completed
Updated: 2026-06-11
Completed: 2026-06-11
