# junction-summary-review-remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Tighten Junction sleep and menstrual-summary ingestion so only current documented facts become canonical and all retained cycle evidence is deterministic, bounded, flattened, and identifier-safe.

## Success criteria

- Period and cycle lengths derive only from documented date endpoints; legacy scalar aliases remain evidence-only.
- Each menstrual fact family uses its current documented enum set, with future, indeterminate, unspecified, and context-invalid values evidence-only.
- Canonical evidence and raw-receipt hashing use the same deterministic flattened cycle representation, capped at 64 cycles and 512 total facts, with no provider subarrays or app/device identifiers.
- Actual cycles and known canonical facts win admission before predictions and unknown evidence.
- Explicit latency-minute fields override second-valued latency fields.
- Focused replay, order-invariance, bounds, privacy, contract, provider-catalog, and changelog checks pass.

## Scope

- In scope: Junction menstrual summary admission, flattened evidence, sleep latency paths, focused tests, compatibility/changelog copy, PR verification and metadata.
- Out of scope: new event kinds, dense samples, full snapshots, query API expansion, unrelated audit items, or another ReviewGPT run.

## Constraints

- Technical constraints: preserve core as the canonical writer; keep the contracts resource-policy table authoritative; bound persisted cycles/facts response-wide; use stable hashed record identities.
- Product/process constraints: preserve existing member-visible mappings that ReviewGPT confirmed, keep evidence private and compact, and update the existing PR without launching ReviewGPT.

## Risks and mitigations

1. Risk: provider order or unknown-value floods change which facts land.
   Mitigation: sort deterministic candidates by actual/predicted and known/evidence-only priority before applying response-wide caps.
2. Risk: one generic enum map assigns the wrong clinical meaning.
   Mitigation: define resource-specific documented maps/sets and test cross-context values.
3. Risk: raw receipt hashing still reflects unbounded provider arrays.
   Mitigation: feed the same flattened evidence builder to both the evidence part and sanitized snapshot hash.

## Tasks

1. Implement deterministic menstrual cycle preparation and documented enum admission.
2. Add explicit minute-valued sleep latency precedence.
3. Add focused boundary, order, privacy, replay, and invalid-value regressions.
4. Update compatibility/changelog claims and complete scoped verification.
5. Commit, push, and update PR #1702 metadata.

## Decisions

- Keep BBT cycle entries evidence-only because the dedicated timeseries remains canonical.
- Preserve unknown/future provider values only inside the bounded flattened evidence representation.

## Verification

- Commands to run: focused importers tests/typecheck; contracts tests/typecheck; device-syncd tests/typecheck; changelog tests and Web typecheck; diff/privacy checks.
- Expected outcomes: zero samples/provider arrays, stable canonical IDs under reorder/replay, caps enforced, strict schemas green, and PR body matches the final diff.

## Completion evidence

- Importers: 388 tests passed; typecheck passed.
- Contracts: 280 tests and schema-artifact verification passed; typecheck passed.
- Device sync: 973 tests passed; typecheck passed.
- Changelog: 44 focused tests passed; Web typecheck passed.
- Diff check passed. Focused regressions prove the 64-cycle and 512-fact caps, actual/known admission priority, reordered-array stability, identifier-safe flattened evidence, zero samples, endpoint-only lengths, resource-specific enums, and explicit minute latency precedence.
Completed: 2026-08-11
