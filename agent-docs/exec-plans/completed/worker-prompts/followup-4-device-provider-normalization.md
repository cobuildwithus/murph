You are Codex Worker F4 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker F4` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch to the device-provider normalization helpers under `packages/importers/src/device-providers/**`.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Deduplicate the provider-external-ref and normalized-batch boilerplate across Garmin/Oura/Whoop using the existing shared-normalization area.

Best-guess fix:
- Add a tiny helper in `packages/importers/src/device-providers/shared-normalization.ts`, e.g. `makeProviderExternalRef(system, resourceType, resourceId, version?, facet?)`.
- Optionally add a similarly tiny helper for final `DeviceBatchImportPayload` assembly if it stays obviously small/local.
- Rewire Oura and Whoop to use the shared helper.
- For Garmin, prefer keeping `makeGarminExternalRef(...)` as a wrapper around the new shared helper if that avoids broad churn.

Guardrails:
- Preserve exact provider strings, facet names, version handling, and `stripUndefined` behavior.
- Do not change normalized payload shapes.
- Do not invent a broader provider framework.

Regression anchor:
- `packages/importers/test/device-providers.test.ts`

