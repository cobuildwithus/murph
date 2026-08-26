# Bind Junction ECG voltage to summary identity

Status: completed
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Import compact Junction ECG voltage features using the stable UUID on the ECG
  summary instead of requiring an identifier that the official grouped voltage
  response does not contain.
- Keep waveform bytes transient and make provider-consistency failures
  retryable, bounded, and diagnosable without provider IDs or sample values.

## Success criteria

- The official id-less grouped voltage shape succeeds when one stable summary
  unambiguously owns the exact source and time window.
- Multiple recordings from the same source retain distinct summary UUIDs, and
  deprecated numeric sample IDs are never treated as recording identity.
- Ambiguous overlaps, source/window mismatches, invalid summaries, and sample or
  recording caps fail retryably before canonical import.
- Focused device-sync tests and typecheck pass; the PR receives required
  ReviewGPT and exact-head CI proof.

## Scope

- In scope: Junction ECG summary selection, exact serial voltage requests,
  grouped-response validation, stable UUID attachment before reduction, focused
  provider tests, matching live device-sync docs, and enforcement of the
  collection attempt/timeout bound already supplied to timeseries requests.
- Out of scope: persisting waveforms, inventing IDs, changing ECG clinical
  interpretation, resubmitting already-dead production jobs, or changing other
  timeseries and summary normalization.

## Constraints

- Technical constraints: at most 64 recordings and 100,000 samples per window;
  summary and voltage requests stay source-scoped and serial; only stable summary
  UUIDs may cross into the existing feature reducer.
- Product/process constraints: keep raw waveform/sample payloads out of logs,
  snapshots, job state, and canonical evidence; preserve ordinary job retry and
  dead-letter ownership.

## Risks and mitigations

1. Risk: two recordings from the same source overlap, so timestamp-only binding
   would invent identity.
   Mitigation: reject overlapping summary intervals retryably before voltage
   fetches.
2. Risk: provider eventual consistency returns samples outside the selected
   summary or an incomplete count.
   Mitigation: require exact source/window membership and summary-count
   agreement before attaching the UUID.

## Tasks

1. Replace the fabricated group-ID fixture with the official id-less contract
   and add failing summary-binding scenarios.
2. Add the dedicated summary-bound ECG fetch path and keep generic grouped
   timeseries from accepting unbound ECG voltage.
3. Update device-sync documentation, run focused tests/typecheck, and inspect
   the final diff.
4. Commit, push, open the PR, then run preliminary and final ReviewGPT alongside
   required exact-head CI.

## Decisions

- Current Junction docs and SDK 1.2.0 define grouped voltage entries as only
  `source` plus `data`; the stable UUID, session bounds, source, and sample count
  live on the ECG summary.
- SDK 1.2.0 deserializes voltage timestamps to `Date` objects while the compact
  reducer accepts strings or numbers, so the dedicated transient parser also
  normalizes each validated timestamp to ISO before reduction.
- When a summary supplies device/app or source-type identity, the voltage group
  must supply the same identity. Provider-only, missing, or different source
  identity is filtered out and the summary count check fails retryably rather
  than attaching an ambiguous group.
- Production evidence showed deterministic terminal failure before persistence,
  so this is a provider-contract bug rather than a corrupt-data recovery case.

## Verification

- Commands: focused Junction client/provider tests, device-sync typecheck,
  `git diff --check`, ReviewGPT, and required PR checks.
- Expected outcomes: official id-less groups reduce successfully under one
  summary UUID; every ambiguous or inconsistent binding fails with a retryable
  provider-consistency error; no waveform or raw identifier enters diagnostics.
- Local proof: the dedicated client suite passed 11/11; the three focused ECG
  provider scenarios passed; device-sync typecheck and `git diff --check`
  passed. The combined provider/client regression suite passed 339/339.
Completed: 2026-08-25
