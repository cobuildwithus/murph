# Device failure diagnostic evidence

Status: active; parent application and verification pending
Created: 2026-09-14
Updated: 2026-09-14

## Outcome and scope

Distinguish caught device failures using only the parsed action, exact
source-owned code and structural HTTP status at the existing diagnostic owner.
The deterministic defect is information loss: distinct typed failures collapse
to the same coarse category. No behavioral root cause is inferred.

Extend `ToolFailureDiagnostic` through the existing issue path; add no state,
transport, logger or dependency. Keep RPCs, prompts, schema acceptance, effects,
recovery, scheduling and completion counts unchanged. Optional fields preserve
old-record compatibility. Reject proxies and read only own scalar data; never
capture private content or follow contexts/causes. The durable contract and
bounded follow-up decision threshold live in `docs/hosted-runtime-log-database.md`.

## Tasks and proof

- [x] Trace the device adapter, common dispatch and issue sanitizer owners.
- [x] Add failure-only bounded evidence, focused regressions and owner guidance.
- [ ] Parent: apply patch; run device/tool-diagnostic tests and engine typecheck.
- [ ] Parent: inspect final diff and complete the normal PR workflow.

Parent checks:

```bash
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage \
  test/device-tool-failure-diagnostics.test.ts test/device-dynamic-tool-errors.test.ts \
  test/assistant-dynamic-tool-failure-boundary.test.ts test/assistant-tool-failure-diagnostics.test.ts
pnpm --dir packages/assistant-engine typecheck
```

Tests cover real dispatch and issue sanitization, exact RPCs/effect counts,
legacy acceptance, finite metadata and hostile inputs. No live-model journey is
needed: prompt, tool schema and RPC behavior remain unchanged. Completion stays
pending with the parent.
