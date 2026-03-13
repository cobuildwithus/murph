Goal (incl. success criteria):
- Replace the public “payload-first with exceptions” framing for command nouns with explicit capability bundles and noun compositions.
- Encode the capability taxonomy in shared metadata so command-surface docs and CLI descriptors can reference one concrete model.
- Preserve the existing command grammar and behaviors; this is a model/documentation cleanup, not a command rename or behavior change.

Constraints/Assumptions:
- Preserve adjacent edits in `README.md` and `docs/contracts/03-command-surface.md`, which are already owned by active CLI/doc lanes.
- Avoid broad CLI implementation changes while the expansion lanes are in flight; keep code changes limited to shared descriptor/contract metadata unless a narrow integration adjustment is required.
- Do not touch unrelated active lanes under inbox, parser, importer, core, or query ownership.

Key decisions:
- Put noun capability metadata in shared contract definitions first, then project it into CLI descriptor metadata instead of inventing another CLI-only registry.
- Treat `provider` and `event` as payload-CRUD nouns even though they are not part of the existing `HealthEntityKind` union.
- Model `document`, `meal`, `intake`, `samples`, `experiment`, `journal`, `vault`, `export`, `audit`, and `inbox` as command nouns composed from reusable capability bundles in docs and shared metadata.

State:
- completed

Done:
- Reviewed repo instructions, verification/runtime docs, completion workflow, and active ownership ledger.
- Inspected the current command-surface docs, CLI health descriptor layer, and shared health entity definitions.
- Added a shared command-capability taxonomy in `packages/contracts/src/command-capabilities.ts` and projected health-noun capability metadata into the CLI descriptor layer.

Now:
- Closed: implementation, manual simplify pass, manual coverage audit, and manual final review are complete.

Next:
- Remove the coordination-ledger row, commit scoped files, and hand off verification results plus the unrelated repo blockers.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether `history` should remain documented as a frozen health noun alongside the new capability framing, or be folded into `event` entirely in a later command-surface pass.

Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-03-13-command-capability-model.md`
- `packages/contracts/src/command-capabilities.ts`
- `packages/contracts/src/index.ts`
- `packages/cli/src/health-cli-descriptors.ts`
- `docs/contracts/03-command-surface.md`
- `README.md`
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, `pnpm --dir packages/contracts test`, `TSX_TSCONFIG_PATH=tsconfig.base.json pnpm exec tsx -e ...health-cli-descriptors...`
