Goal (incl. success criteria):
- Land accepted ReviewGPT round 3 fix for PR 209 clinical import CLI surfaces.
- Success means social-history payloads reject duplicate per-entry externalRef identities before batch import, with focused tests and a pushed branch ready for the next ReviewGPT round.

Constraints/Assumptions:
- Keep ReviewGPT response artifacts in `audit-packages/` uncommitted.
- Keep changes scoped to social-history duplicate identity validation and tests.
- Match core import reconciliation identity: `system`, `resourceType`, `resourceId`, and `facet`; ignore `version`.

Key decisions:
- Accept the ReviewGPT round 3 finding as real: duplicate social-history externalRef identities can collapse distinct facts during batch reconciliation.

State:
- In progress.

Done:
- Ran ReviewGPT round 3 on the pushed PR head.
- Verified the core reconciliation identity in `eventExternalRefKey`.
- Added duplicate externalRef identity validation to the social-history payload schema.
- Added focused usecase coverage for duplicate refs that differ only by `version`.
- Documented the social-history uniqueness rule.

Now:
- Run focused verification.

Next:
- Run focused verification, commit/push, and start ReviewGPT round 4.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/vault-usecases/src/usecases/clinical-imports.ts
- packages/vault-usecases/test/clinical-imports.test.ts
- docs/contracts/03-command-surface.md
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
