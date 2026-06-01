# Junction stress level data support

Status: completed
Created: 2026-06-01
Updated: 2026-06-01

## Goal

- Support Junction `daily.data.stress_level.*` events as first-class
  Junction-backed wearable stress observations, preserving raw evidence and
  emitting the existing `stress-level` metric without adding a new ingestion
  abstraction.

## Success criteria

- Junction webhook parsing classifies `daily.data.stress_level.created` as an
  enabled resource job rather than falling back to generic reconcile.
- Junction direct webhook payloads and REST resource jobs import
  `stress_level` records through the existing Junction snapshot path.
- The Junction importer emits existing `stress-level` observation metrics from
  plausible Junction stress payload field names while keeping raw artifacts.
- Focused device-syncd and importer tests prove webhook classification,
  allowlist/default resource behavior, and metric normalization.

## Scope

- In scope:
  - Junction resource registry and aliasing for `stress_level`.
  - Junction importer metric mapping to existing `stress-level`.
  - Focused tests in device-syncd/importers.
- Out of scope:
  - New tables, queues, handoff semantics, or runtime scheduling changes.
  - Broad Junction resource expansion beyond stress-level.
  - Product UI changes or new metric taxonomy.

## Constraints

- Technical constraints:
  - Reuse the current Junction resource, dirty-resource, snapshot, and importer
    seams.
  - Do not log raw provider payloads, provider ids, tokens, or raw webhook
    bodies.
  - Keep dense raw retention policy explicit; stress-level should be
    day/display-grade data, not a generic firehose sample stream.
- Product/process constraints:
  - Keep the change small and composable.
  - Preserve foreground runtime priority; webhook handling remains dirty-state
    acceptance plus background recovery.

## Risks and mitigations

1. Risk: Junction payload shape differs from guessed field names.
   Mitigation: accept a small set of common stress-level field names and retain
   raw artifacts for replay; do not invent precision beyond supplied numeric
   values.
2. Risk: Treating stress as dense temporary timeseries would prune useful
   daily stress facts.
   Mitigation: model `stress_level` as a summary resource and normalize only
   compact observation metrics.

## Tasks

1. Trace current Junction webhook, resource allowlist, runtime job, and importer
   paths.
2. Add minimal `stress_level` resource and metric mapping.
3. Add focused webhook/resource/importer regression tests.
4. Run scoped verification, required audits, and privacy/diff checks.

## Decisions

- Use the existing `stress-level` metric key and Junction summary resource path.
- Do not introduce a provider-specific Garmin bridge for Junction-backed Garmin
  stress in this slice.

## Verification

- Passed:
  - `pnpm --dir packages/importers test -- device-providers-junction.test.ts provider-descriptors.test.ts`
  - `pnpm --dir packages/device-syncd test -- junction-resource-aliases.test.ts`
  - `pnpm --dir packages/importers typecheck`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/importers/src/device-providers/junction-resources.ts packages/importers/src/device-providers/junction.ts packages/importers/src/device-providers/provider-descriptors.ts packages/importers/test/device-providers-junction.test.ts packages/device-syncd/src/providers/junction.ts packages/device-syncd/test/junction-resource-aliases.test.ts`
  - `pnpm test:smoke`
  - `git diff --check -- <touched Junction files and active plan files>`
- Completion audits:
  - `security-privacy-review`: no findings.
  - `coverage-write`: no findings; low residual risk for live Junction payload
    shape and explicit environment overrides.
  - `task-finish-review`: no findings; same operational note that explicit
    `JUNCTION_SUMMARY_RESOURCES` overrides must include `stress_level`.
Completed: 2026-06-01
