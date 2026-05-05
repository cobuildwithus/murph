# Junction Public Source Identity

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

Fix user-facing wearable reads so Garmin data imported through Junction is presented and filtered as Garmin, while Junction remains internal runtime/provenance plumbing.

Success criteria:

- `vault-cli wearables ... --provider garmin` includes Garmin data imported through Junction.
- Wearable latest/day/metric/source-health output shows Garmin for Junction-backed Garmin data.
- Assistant overview inherits Garmin from wearable source health.
- Existing synced records work without rewriting canonical vault data.
- Internal selection, ranking, dedupe, and direct-vs-Junction duplicate behavior stays stable.

## Simple Model

There are two identities:

```txt
internal provider: runtime/provenance provider, e.g. junction
public source: wearable source shown to users, e.g. garmin
```

Keep internal provider semantics inside candidate construction, ranking, dedupe, source selection, and summary assembly.

Resolve the public source only at two boundaries:

1. provider filters, before deciding whether an already-built candidate belongs in a public query result
2. public summary/source-health output, after internal summary assembly is complete

This avoids changing the meaning of `candidate.provider` or low-level `resolveMetric` internals.

## Non-Goals

- Do not rewrite canonical vault records.
- Do not add pseudo-providers such as `junction_garmin`.
- Do not change `externalRef.system = "junction"` for Junction-imported records.
- Do not change `vault-cli device account list`.
- Do not add a new hosted bridge, source-status command, runtime snapshot field, schema migration, or persisted state in this pass.
- Do not add assistant-specific string replacement logic.
- Do not mutate low-level `resolveMetric` / `resolveSleepWindowSelection` behavior just to change display names.

## Proposed Implementation

1. Add one query-owned public source helper in the wearable origin layer.

   Contract:

   ```txt
   dataOrigin.sourceProviderSlug, if present and not junction
   else source inferred from Junction resource type such as junction-garmin-*
   else externalRef.system / internal provider, if present and not junction
   else unknown
   ```

   Keep Junction resource-type inference in one place. The current candidate builder already performs this fallback for `dataOrigin`; avoid duplicating the parsing logic in multiple files.

   If a Junction upstream source slug is present but there is no known public descriptor for it, preserve the normalized raw source slug in public output. Use `unknown` only when no upstream source can be identified.

2. Use the helper for wearable provider filters.

   `collectWearableDataset` should still build candidates with internal `provider`, but `filters.providers` should compare against the resolved public source provider.

   Apply the same filter rule to `collectCanonicalWearableDataset`, so canonical wearable records with `source.provider = "junction"` and `source.origin.sourceProviderSlug = "garmin"` behave the same way.

3. Add a public projection step for returned summaries and source health.

   Build summaries internally exactly as today. After that, project user-facing provider fields and notes to public source identity before returning from public wearable query surfaces.

   Public projection scope:

   - metric `selection.provider`
   - metric `confidence.conflictingProviders` and provider names inside confidence reasons
   - summary-confidence `selectedProviders` and provider names inside summary notes
   - sleep `provider` / `sleepWindowProvider`
   - metric latest/trend `provider`
   - day/latest `providers`
   - source-health row grouping, `provider`, `providerDisplayName`, notes, selected counts, conflict counts, and provenance-diagnostic notes
   - derived public titles such as sleep-stage/activity aggregate titles

   Important guardrail: do not feed projected public provider values back into internal joins. Internal code that needs to match a selected metric back to a candidate should use record IDs or run before projection, not rely on public provider labels.

4. Keep CLI and assistant as consumers.

   Do not change `packages/cli/src/commands/wearables.ts` unless implementation proves the command layer itself is leaking Junction. It should inherit query output.

   Do not change assistant overview logic unless a focused test shows it does not inherit corrected source-health output.

5. Add one brief assistant system-prompt guardrail.

   State that Junction is a device-sync bridge/aggregator, not the user-facing wearable source. The assistant should prefer the upstream source name such as Garmin/Oura/WHOOP/Strava and should mention Junction only when explicitly debugging low-level connection/runtime state.

## Conflict Rule

Do not simply string-replace `junction` with `garmin` in conflict arrays.

When publicizing conflicts:

- conflicts across different public sources remain provider conflicts
- conflicts where direct Garmin and Junction-backed Garmin disagree should not produce "Garmin conflicts with Garmin"
- if we preserve a note for same-public-source disagreement, phrase it as duplicate evidence from the same source disagreeing, without exposing Junction

## Tests

Add the smallest regression suite that proves the boundary:

- Query-level fixture with Junction-backed Garmin using `dataOrigin.sourceProviderSlug = "garmin"`.
- Query-level fixture with legacy Junction-backed Garmin using only `externalRef.resourceType = "junction-garmin-..."`.
- Public query with `providers: ["garmin"]` includes the records and returns public provider `garmin`.
- Query-layer `providers: ["junction"]` excludes Garmin-through-Junction data; do not add a CLI Junction test unless the CLI contract changes.
- Source health groups Junction-backed Garmin under one Garmin row and does not include Junction in provider names or notes.
- Public notes/confidence/conflict text for Junction-backed Garmin does not contain `junction`.
- Same-public-source direct-vs-Junction disagreement does not render "Garmin conflicts with Garmin".
- Junction records with no source identity resolve publicly to `unknown`, not Junction.
- Existing internal direct-vs-Junction duplicate selection tests continue to pass; do not duplicate them unless selection internals are touched.
- Assistant overview can be covered by one focused fixture only if the inherited source-health behavior is not already proven.
- Assistant prompt includes the brief Junction-as-aggregator guardrail without adding assistant-specific query output rewriting.

## Verification

Expected implementation verification:

- `pnpm typecheck`
- `pnpm test:diff <touched files>` when truthful for the touched query/assistant files
- Otherwise, `pnpm --dir packages/query test:coverage`
- Add `pnpm --dir packages/assistant-engine test:coverage` only if assistant prompt or overview tests are touched.
- Add `pnpm --dir packages/cli verify:coverage` only if wearable CLI command behavior or generated command contracts change.

For this plan-only edit, read back the touched docs and run `git diff --check`.

## State

Done:

- Traced the leak to public query surfaces using internal provider identity as the user-facing wearable source.
- Confirmed Junction-backed records already carry or can infer public source identity through `DeviceDataOrigin` or Junction resource types.
- Rejected the broader account-list/source-status/hosted-bridge work for this first pass as unnecessary complexity.
- Stress-tested the simplified plan with three independent reviewers and incorporated the shared finding: keep internal selection raw, publicize only at boundaries.

Now:

- Implement this final public-boundary projection shape.

Next:

- Implement the helper, filter usage, and public projection.
- Add focused regressions.
- Run the verification lane above.

## Decisions

- Low-level `vault-cli device account list` may still show the runtime account provider `junction` for now.
- Add a brief assistant system-prompt note that Junction is an aggregator/bridge, so the assistant does not confuse it with the wearable source.
- Preserve raw upstream source slugs when Junction identifies a source that lacks a polished public descriptor. Use `unknown` only when the upstream source cannot be identified.

## Working Set

- `packages/query/src/wearables/origin.ts`
- `packages/query/src/wearables/candidates.ts`
- `packages/query/src/wearables/canonical-records.ts`
- `packages/query/src/wearables/source-health.ts`
- `packages/query/src/wearables.ts`
- `packages/query/src/metrics/projection.ts` if public projection changes selected-provider matching assumptions
- `packages/query/test/**`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/test/**` only if adding the inherited overview regression
Completed: 2026-05-05
