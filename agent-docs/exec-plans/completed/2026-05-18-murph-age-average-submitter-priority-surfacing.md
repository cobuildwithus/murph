# Murph Age Average Submitter Priority Surfacing Plan

Status: completed
Created: 2026-05-18
Owner: Codex

## Goal

Make the current Murph Age ordinary submitter surfaces unmistakably prioritize data an average roughly 16-50-year-old can submit: bloodwork/lab exports and phone/watch/wearable activity exports first.

Success means:

- R1178 current-loop surfacing exposes a stable submission-priority object.
- R1179 objective gap audit carries the same priority object and audits it as part of the ordinary 16-50 objective.
- The first-pass minimum pair remains glycemia bloodwork/labs plus daily wearable/activity data.
- Routine context stays optional and advanced/uncommon data stays deferred until the minimum pair is confirmed.
- No row values, file paths, headers, identifiers, source text, predictions, coefficients, model parameters, small cells, product claims, or product display are emitted.

## Non-goals

- Do not accept or parse private rows.
- Do not promote model evidence or product-facing recommendations.
- Do not change the row-owner confirmation gate.
- Do not broaden the ordinary submitter scope beyond the roughly 16-50 lab/wearable path.

## Implementation

- Add an explicit average-submitter submission priority structure to R1178.
- Add the same structure to R1179 and require it when recognizing R1178.
- Keep CLI summaries pathless and safe.
- Update focused R1178/R1179 tests for the new priority fields and stale-input guards.
- Regenerate the ignored R1178/R1179 runtime artifacts.

## Verification

Planned commands:

```bash
pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/murph-age/r1178-average-submitter-current-loop-surfacing.test.ts scripts/murph-age/r1179-average-submitter-objective-gap-audit.test.ts
pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/murph-age
pnpm typecheck
bash scripts/workspace-verify.sh test:diff scripts/murph-age/r1178-average-submitter-current-loop-surfacing.ts scripts/murph-age/r1178-average-submitter-current-loop-surfacing.test.ts scripts/murph-age/r1179-average-submitter-objective-gap-audit.ts scripts/murph-age/r1179-average-submitter-objective-gap-audit.test.ts
```

Also run whitespace, privacy, and aggregate-egress scans on touched files and refreshed artifacts.
Updated: 2026-05-18
Completed: 2026-05-18
