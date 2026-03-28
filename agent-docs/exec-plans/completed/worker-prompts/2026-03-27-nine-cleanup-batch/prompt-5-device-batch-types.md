Murph cleanup lane: simplify the device-provider normalized-batch type boundary in `packages/importers` without changing runtime behavior.

Ownership:
- Own `packages/importers/src/{core-port.ts,device-providers/types.ts,device-providers/shared-normalization.ts,device-providers/**}`.
- Own direct coverage in `packages/importers/test/{device-providers.test.ts,importers.test.ts}`.
- `packages/importers/src/device-providers/{garmin.ts,whoop.ts}` are already dirty. Read the live file state first, preserve unrelated edits, and do not revert anything you did not author.
- Do not edit outside that scope unless a direct, minimal dependency is unavoidable. If scope changes, update your ledger row first.
- Work in the shared current worktree.
- Do not create commits.

Required repo workflow:
- Read `AGENTS.md`, `agent-docs/operations/completion-workflow.md`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` before editing.
- Follow the completion workflow as far as your lane can: implement, simplify, add or adjust direct coverage, run the narrowest truthful verification, and report any remaining gaps.
- If your environment supports spawned audit subagents, run the required `simplify`, `test-coverage-audit`, and `task-finish-review` passes using the prompts under `agent-docs/prompts/`.

Relevant code:
- `packages/importers/src/core-port.ts`: `DeviceBatchImportPayload`
- `packages/importers/src/device-providers/types.ts`: `NormalizedDeviceBatch`, `DeviceProviderAdapter`, `DeviceProviderSnapshotImportPayload`
- `packages/importers/src/device-providers/shared-normalization.ts`: `NormalizedDeviceBatchOptions`, `makeNormalizedDeviceBatch`
- provider adapters under `packages/importers/src/device-providers/`

Issue:
- `NormalizedDeviceBatch` manually duplicates the canonical `DeviceBatchImportPayload` shape, differing mostly by the lack of `vaultRoot`.
- That means the provider-normalization boundary and the core import boundary can drift.
- A nearby `DeviceProviderSnapshotImportPayload` type also appears to restate the payload shape again with snapshot layered on top.

Best concrete fix:
- Prefer a type alias over a duplicate interface, for example `type NormalizedDeviceBatch = Omit<DeviceBatchImportPayload, "vaultRoot">`.
- Simplify related helper types accordingly, for example make `NormalizedDeviceBatchOptions` a narrow alias of that shape minus `source` if `makeNormalizedDeviceBatch` intentionally hardcodes `source: "device"`.
- Keep runtime behavior exactly the same. This is primarily a type and naming cleanup plus any tiny helper-signature cleanup that falls out naturally.

Risk note:
- If `DeviceProviderSnapshotImportPayload` is part of a meaningful external public API, do not remove or radically change it.
- If it appears unused internally but may still be exported for consumers, report that risk instead of deleting it blindly.

Tests to anchor:
- `packages/importers/test/device-providers.test.ts`
- `packages/importers/test/importers.test.ts`

Report back with:
- files changed
- behavior-level summary
- exact verification commands and results
- any direct scenario proof or remaining gap
