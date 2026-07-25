# Protein daily vault-share projection for group challenges

## Goal

Group challenges need per-member daily protein totals. Members already log meals
(with normalized `nutrition.totals.proteinGrams`) in their own vaults; the group
side already has consented Vault Share projections, `read_shared`, and the
group-challenge skill's standings loop. Add one projection kind so protein flows
through the existing consent + projection + tally machinery. No new tool,
entity, service, or storage.

## Design (per accepted external architecture consult)

- `protein-days.v0` daily-metric projection kind in the closed registry
  (`packages/hosted-execution/src/vault-share.ts`): `protein-grams`, unit `g`
  (parser-enforced via new optional `expectedUnit` spec field), bounds 0..2000
  (corruption guard, skip not clamp), selectable on group join.
- Declarative spec `source` discriminator (`metric-series` vs
  `meal-nutrition-total`); the materializer
  (`packages/assistant-runtime/src/hosted-runtime/vault-share-projection.ts`)
  dispatches on it and sources protein from
  `readMealNutritionTotals` with a per-offer promise cache.
- Fail-closed complete-day rule: emit a day only when every meal that day
  carries the nutrient; a complete true-zero day is data; absence never ranks
  as zero.
- Day identity is the meal's canonical vault-local date; recordKey = date,
  occurredAt = UTC midnight transport identity; whole-snapshot replacement
  covers amended meals; no sourceRevision initially.
- Join-page copy in `apps/web/src/lib/hosted-groups/join-policy.ts`; challenge
  skill metric-menu entry in
  `packages/assistant-engine/skills/group-challenge/SKILL.md`.
- Frozen legacy omitted-capability list, group-chat core scope list, and
  newsletter allowlist intentionally unchanged.

## Invariants

- Cross-member data flows only through consented vault-share projections.
- Canonical truth stays in each member's vault meal events; the projection is a
  bounded derived read model.
- Closed-registry envelope unchanged: new kind = data schema + projector only.
- Deploy order: Web (Vercel) before Cloudflare runner; the runner declares
  supported scope keys to the web control plane, so web must parse the new kind
  before any runner declares or delivers it.

## Status

- Worktree `/private/tmp/murph-protein-challenge`, branch
  `agent/protein-days-projection`.
- Registry, parser, materializer, join copy, skill entry, and
  hosted-execution/runtime test scaffolding implemented; remaining web/runtime
  test coverage being produced as an external review patch.
Status: completed
Updated: 2026-07-24
Completed: 2026-07-24
