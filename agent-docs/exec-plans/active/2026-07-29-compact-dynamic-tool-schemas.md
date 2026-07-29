# Defer Broad Dynamic Tool Schemas

## Outcome

Remove the full `murph.automation` and broad `murph.group` schemas from ordinary
hosted provider input by using Codex's native deferred dynamic-tool loading.

## Constraints

- Keep the existing direct tool names, argument shapes, validators, and result
  contracts.
- Preserve root-turn invocation authority and current-conversation route
  binding.
- Keep Vault as the automation owner and Web as the group-authority owner.
- Use the pinned Codex App Server contract rather than a Murph-owned discovery
  or execution protocol.
- Keep narrow scheduled and detached group reads direct.

## Plan

1. Carry `deferLoading` through Murph's provider dynamic-tool type.
2. Mark only the broad automation and group tools deferred.
3. Delete Murph's namespace-wide code-mode direct-tool override so explicit
   per-tool deferral remains authoritative.
4. Prove with the pinned real App Server that Terra's initial provider input
   contains generic `ALL_TOOLS` discovery guidance, not either broad schema,
   and that code-mode execution dispatches the unchanged automation contract.
5. Measure the fixed-input reduction, run canonical verification, complete the
   review gates, and close this plan with a scoped commit.

## Verification

- Real pinned Codex App Server plus scripted provider proof for native deferred
  code-mode discovery and callback execution.
- Focused schema registration and request-forwarding tests.
- `pnpm test:diff packages/assistant-engine packages/assistant-runtime`
- `pnpm verify:acceptance`
- Base/head provider-input token measurement.
- Preliminary `completion-specialists` ReviewGPT pass with coverage lens,
  followed by parent final review and the final ReviewGPT gate.

## Deployment

The dynamic-tool fingerprint changes, so a runtime using the new bundle starts
a fresh Codex thread contract instead of resuming a thread with eager schemas.
The change is runner-only and needs no Web or persisted-state migration.

## Progress

- The pinned Codex `0.145.0` protocol exposes `deferLoading` on
  `thread/start.dynamicTools`.
- Canonical Codex source maps that field to deferred tool exposure. Direct-tool
  models discover it with `tool_search`; Terra's `code_mode_only` path omits the
  schema from provider input, lists name/description metadata in `ALL_TOOLS`,
  and routes the selected call through the existing App Server callback.
- Murph's former `direct_only_tool_namespaces = ["murph"]` override promoted
  deferred tools back to direct exposure. The override is deleted rather than
  adding a second Murph discovery protocol.
- The pinned real App Server proves the deferred automation call reaches the
  unchanged Murph request callback and that the representative provider request
  is 5,748 bytes / 1,328 tokenizer tokens smaller than the prior direct
  namespace configuration.
- The earlier Murph-owned `schema | execute` candidate was rejected and removed
  before the final review baseline.
