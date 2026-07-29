# Restore growth dashboard across mailbox content retirement

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Restore `/ops/growth` when its rolling activity windows include group-message
  rows whose private payload content was intentionally retired.

## Success criteria

- Expected mailbox content retirement does not crash the Growth dashboard.
- Missing content without a retirement marker remains an integrity failure.
- Available group sender evidence still contributes to WAU and MAU.
- Any activity window affected by retired group evidence is presented as a
  lower bound, and an incomplete prior-week window does not produce a
  misleading week-over-week rate.
- Focused tests, canonical verification, rendered proof, and required reviews
  pass.

## Scope

- In scope: hosted Growth activity aggregation, Growth scorecard copy and
  design study, focused tests, and the current architecture description.
- Out of scope: extending private message retention, restoring retired
  payloads, adding analytics storage, changing ingress, and other ops pages.

## Constraints

- Preserve the existing mailbox content-retirement policy and never decrypt a
  row after its retirement marker is set.
- Do not silently treat missing unretired payloads as expected retention.
- Keep direct-member activity exact and preserve all attributable retained
  group evidence.
- Keep the correction within the existing Growth query and scorecard owners.

## Risks and mitigations

1. Risk: skipping every missing payload hides corruption.
   Mitigation: skip only rows with a durable content-retirement marker; retain
   the existing failure for unretired missing content.
2. Risk: a partial group history is presented as an exact MAU or WAU.
   Mitigation: carry window completeness into the scorecard, mark partial
   counts as lower bounds, and suppress incomplete comparisons.
3. Risk: the fix weakens privacy to recover the metric.
   Mitigation: do not change retention, persist sender data, or restore content.

## Tasks

1. Reproduce expected retired group evidence in focused Growth coverage.
2. Partition retired rows before payload decoding and calculate completeness
   for each rolling window.
3. Render honest lower-bound and comparison-unavailable states in the real
   scorecard and design study.
4. Update the current architecture description.
5. Run focused and canonical verification, required reviews, commit, push, and
   complete the PR lane.

## Verification

- `pnpm --dir apps/web test:prepared test/hosted-ops-growth.test.ts`
- `pnpm test:diff <touched paths>`
- `pnpm verify:acceptance`
- Desktop and mobile design-catalog proof for the partial-history state.
- Required product-experience, preliminary specialist, parent final, and
  applicable cross-cutting review gates.
