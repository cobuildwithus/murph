# Public wearable projection direct copy

Status: active
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Remove the per-summary `JSON.stringify`/`JSON.parse` round trip from
  `projectPublicWearableSummaryBundle()`, the last step of multi-provider
  wearable composition, without changing any public or persisted output.
- Measurable outcome: lower CPU for that projection step on the synthetic
  365-day bundle in `packages/query/bench/wearable-cpu.ts`, compared against the
  text round-trip control in alternating pairs. That measurement, local or
  parent, is synthetic only and does not establish production latency; this
  plan makes no production latency claim.

## Success criteria

- Every projected summary deep-strictly equals and byte-equals the text
  projection (`stringifyPublicWearableProjectionSummary()` then
  `parseJsonValue()`), including key order, `-0`, non-finite numbers,
  omitted `undefined`/function/symbol values and `__proto__` own properties.
- Privacy is unchanged: provenance keys are omitted and `candidates`, `paths`
  and `recordIds` are emptied at every depth, with fresh containers.
- Failure behavior is unchanged: bigint and cyclic input still throw the same
  `TypeError` from the text path.
- Parent exact-base synthetic measurement, real-Codex focused verification,
  exact-head CI and final review pass.

## Scope

- In scope: `packages/query/src/projection/wearable-summary-public-json.ts`,
  its isolated regression test, the bench case and README, the query owner note,
  one focused activity journey reusing the existing real-Codex fixture, and the
  changelog fragment.
- Out of scope: stored rows, the stored codec, the stringify function, public
  schemas/types, prompt and tool surfaces, and the fresh-global stored read.

## Constraints

- Producer boundary: the composer passes typed `WearableSummaryBundle` values
  built from plain object literals and arrays. They define no getters, proxies
  or `toJSON`; the copy relies on that and does not claim to support them.
- Values outside the plain shape (non-`Object`/`null` prototype, `toJSON`,
  bigint, depth 32 or more, cycles) fall back to the exact text path for the
  whole summary. A fallback rereads accessors; the current producer has none.
- Production schemas and types stay strict. Malformed test inputs use one
  focused `@ts-expect-error` at the intentional invalid argument.

## Risks and mitigations

1. Risk: a semantic mismatch with `JSON.stringify` changes public bytes.
   Mitigation: parity tests against the text projection on composed
   multi-provider summaries and on edge values, plus bench result equality.
2. Risk: a privacy key leaks through a new path.
   Mitigation: the copy shares `WEARABLE_SUMMARY_PROVENANCE_KEYS` and the same
   key precedence; tests check every depth and array element.
3. Risk: the provider-filtered real-Codex fixture bypasses the changed composer.
   Mitigation: a second journey on the same fixture reads without a provider
   filter, so two providers compose.

## Tasks

1. Implement the direct copy with text-path fallback. Done.
2. Add isolated regression tests and the paired bench case. Done.
3. Add the query README owner note and changelog fragment. Done.
4. Add the composed activity journey and native JSON/TOON contract case:
   `--from 2026-01-02 --to 2026-01-03 --limit 2`, no provider. Expected: two
   days; 2026-01-03 selects Garmin 12300 over conflicting Oura; 2026-01-02 is
   Oura 6200; Oura 8800 is absent. Exactly one native activity read, no dynamic
   tools, writes, outbox intents or global publication. Done; determined from
   the service output.
5. Parent: exact-base measurement, getter/fallback reachability review,
   real-Codex run, CI and final review. Pending.

## Decisions

- Changelog: updated with `2026-10-07 · multi-device-wearable-reads`, a sober
  faster cross-provider wearable lookup note with the same sources and
  readings. No numeric, production latency or broad privacy claim.
  `sourcePullRequests` stays empty until the PR number is known.

## Verification

- `pnpm complexity:diff`: passed after extracting the record copy loop into
  `copyPublicPlainRecord()` (file max 18, debt 0); no suppression or ratchet
  change.
- Run locally by the task agent:
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage test/wearable-summary-public-json.test.ts`
    in `packages/query`: 5 passed.
  - `pnpm typecheck` in `packages/query` and `packages/assistant-engine`: passed.
  - `pnpm exec vitest run --config vitest.config.ts test/assistant-codex-real-e2e.test.ts -t 'accepts only the single native activity read/help command' --no-coverage`
    in `packages/assistant-engine`: 1 passed.
- Pending parent: the native JSON/TOON contract case (needs built CLI dist),
  the live `real Codex focused wearable activity projection e2e` journeys,
  exact-base bench comparison, exact-head CI and final review.
