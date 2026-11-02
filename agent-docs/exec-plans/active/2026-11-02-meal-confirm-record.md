# Preserve photo meal identity through confirmation

Status: active
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariant

A member's answer about a captured dish completes the same canonical meal with
a short dish name and supported nutrition. Photo linkage and capture time remain
stable; no duplicate meal is created. Existing numeric-safety preferences apply.

## Owners and investigation

The runtime photo importer creates the meal. The assistant's manual estimation
builder, food-journal guidance and CLI edit contract own enrichment. Browser Vault
publishes the canonical meal to companion list/detail. No new store is needed.
Read-only, account-scoped receipt inspection proved the original meal was edited
successfully with a name and nutrition, without a duplicate. The companion reader
served an older projection while the runtime waited for its conversation idle
checkpoint. Private content and identifiers remain outside repository artifacts.
CLI name editing already exists and needs no contract expansion.

## Product UX

Outcome: confirming a photo meal fixes its displayed dish and nutrition.
Reaches: manual photo submission, clarification reply, and ordinary projection.
Proof: deterministic import/edit/projection and a two-turn synthetic live journey.
Preserve nonnumeric capture and unrelated meals. Review replies as Ready or Hold.

## Tasks

1. Prove the original import, confirmation target, receipt and projection outcome.
2. Correct only the failing existing boundary and its durable guidance.
3. Run focused deterministic tests, typechecks and the production-derived live
   journey with gpt-6.1-sol through the local subscription.
4. Review privacy, complexity, prompt size and deployment compatibility; add a
   member-visible changelog entry. Reconcile concurrent changes on main.
5. Commit, open PR, start ReviewGPT alongside exact-head CI, merge and deploy Web
   followed by the runtime. Verify the deployed revisions.
6. Check whether the existing product refresh repairs the member's record;
   otherwise provide a precise conversation recovery instruction. No direct SQL
   writes or operator-initiated member messages.

## State and compatibility

Canonical meal events remain authoritative; companion data remains a projection.
Prefer existing title and nutrition fields and edit commands without a migration.
Any projection change must stay off the foreground reply path and preserve
ordinary interruption/retry ownership. Deployment skew proof follows final scope.

## Verification

Import/edit/reimport/projection regression passed with one renamed meal and
photo linkage preserved. Runtime publication regression and existing preemption/
continuation suites passed (50 tests); publication follows reply then durable
checkpoint without the ten-minute wait. Focused live journey passed on
gpt-6.1-sol via local subscription: one edit, one meal, dish name and all five
nutrition totals, with a nutrition card. Reply review: Ready.
Both affected package typechecks pass. Runtime tests cover 63 import/publication/
preemption/continuation cases and 22 focused canonical receipt cases. Complexity
debt and maxima are unchanged. Initial provider instructions/tool descriptions
are unchanged; only the on-demand food-journal skill body changed.
The publication regression fails against the previous scheduler after reply
delivery with no replica publication, and passes with the fix. The final
production-derived live journey passed again after reconciling main. Changelog
generation and archive rendering pass. Review, exact-head CI and deployment
remain pending on PR #4450.
