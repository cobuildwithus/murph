Goal (incl. success criteria):
- Land accepted ReviewGPT round 1 fixes for PR 209 clinical import CLI surfaces.
- Success means social-history imports have retry-safe canonical external identity, unknown social-history statuses are not stored as positive exposure events, structured social status/date fields are preserved or rejected clearly, tests prove the behavior, and the PR branch is pushed for the next ReviewGPT round.

Constraints/Assumptions:
- Keep the PR review artifacts under `audit-packages/` uncommitted.
- Keep fixes scoped to social-history import payload/usecase behavior and directly coupled docs/tests/generated schemas.
- Preserve the canonical one-batch write path for social-history imports.

Key decisions:
- Accept both ReviewGPT round 1 findings as real after code inspection.

State:
- Implementation complete; final scoped commit pending.

Done:
- Ran ReviewGPT round 1 on PR 209; response captured in local audit artifacts.
- Verified the finding shape in `packages/vault-usecases/src/usecases/clinical-imports.ts`.
- Required per-entry social-history `externalRef` values and pass them into canonical event-batch payloads.
- Changed social-history exposure routing so only `current` and `former` exposure-category entries write exposure events; `unknown` or missing statuses write tagged notes.
- Preserved structured status/substance/quantity/frequency/method/startedOn/endedOn details in bounded social-history note text, and retained available duration detail for exposure events.
- Added mocked and real-vault coverage for externalRef retry idempotency, unknown status note routing, and structured detail preservation.
- Updated CLI reviewed-input-command smoke allowlist for the new clinical import surfaces.
- Verification passed: `pnpm --dir packages/vault-usecases typecheck`, focused vault-usecases clinical tests, focused CLI clinical/allowlist tests, `pnpm --dir packages/cli typecheck`, targeted `pnpm test:diff ...`, `git diff --check`, and identifier-leak diff grep.

Now:
- Close the active plan through `scripts/finish-task` and create the scoped commit.

Next:
- Push the commit and start ReviewGPT round 2 on the updated PR head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/vault-usecases/src/usecases/clinical-imports.ts
- packages/vault-usecases/test/clinical-imports.test.ts
- packages/vault-usecases/test/clinical-imports-real.test.ts
- packages/cli/config.schema.json
- packages/cli/src/incur.generated.ts
- docs/contracts/03-command-surface.md
- docs/incur-payload-schema-migration-guide.md
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
