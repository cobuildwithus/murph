Goal (incl. success criteria):
- Preserve importer Zod validation details across the TypeError boundary so device-sync failure logs can include sanitized issue paths/metadata.
- Success: importer validation wrappers retain the ZodError as `cause`; device-sync summarization can read it; focused tests pass.

Constraints/Assumptions:
- Do not log raw provider payloads, tokens, direct identifiers, filesystem paths, or credentials.
- Preserve unrelated dirty work in the checkout.
- Keep diagnostics bounded by the existing device-sync sanitizer.

Key decisions:
- Preserve the ZodError as `cause` instead of changing public thrown error class/message.

State:
- Complete; ready for scoped commit/plan close.

Done:
- Confirmed the latest WHOOP reconnect landed locally but the first sync still logged only the first validation message.
- Identified importer `parseValue` as a boundary that drops Zod issue details by throwing a new `TypeError`.
- Patched `parseValue` to preserve the original ZodError as `cause` while keeping the existing TypeError message/class.
- Added importer regression coverage for missing top-level snapshot validation details.
- Verified package importer/device-sync tests, package typecheck, raw log guard, and diff-scoped workspace verification.
- Cross-checked WHOOP docs and local WHOOP normalization against scored and scoreless cycle/recovery/sleep/workout payload shapes.

Now:
- Close plan and create scoped commit.

Next:
- Handoff parser findings.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/importers/src/shared.ts`
- `packages/importers/test/device-provider-snapshot-validation.test.ts`
- `packages/device-syncd/test/service.test.ts`
Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
