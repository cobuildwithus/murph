# Device failure diagnostic evidence

Status: completed
Created: 2026-09-14
Updated: 2026-09-15

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
- [x] Parent: apply the recovered patch unchanged; pass the focused suites and engine typecheck.
- [x] Parent: inspect the full diff and complexity impact; no additional simplification justified.

Parent-reported local validation (passed):

```bash
pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage \
  test/device-tool-failure-diagnostics.test.ts test/device-dynamic-tool-errors.test.ts \
  test/assistant-dynamic-tool-failure-boundary.test.ts test/assistant-tool-failure-diagnostics.test.ts
pnpm --dir packages/assistant-engine typecheck
```

Tests cover real dispatch and issue sanitization, exact RPCs/effect counts,
legacy acceptance, finite metadata and hostile inputs. Parent review confirmed
additive failure-only metadata at the existing issue owner, bounded own-data
reads, unchanged coarse classifications, and no new effects or provider-input,
prompt, schema or RPC changes. The complexity diff left the existing
`readHostedWebControlPlaneResponseError` hotspot and diagnostics maximum
unchanged. No live journey is needed because provider-visible behavior is
unchanged.

## Separate pending gates

- [ ] Final external PR review.
- [ ] Exact-head CI.
- [ ] Deployment, only if separately authorized.

Parent will archive this plan through `scripts/finish-task`. Plan closure records
implementation and parent local validation/review only; it does not complete
these external gates or constitute a final review verdict.
Completed: 2026-09-15
