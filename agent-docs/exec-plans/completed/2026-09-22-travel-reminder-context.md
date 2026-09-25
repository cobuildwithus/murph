# Resolve reminder location from current canonical context

## Outcome and ownership

Outdoor reminders must not treat an incidental saved city as permanently current.
Journal notes remain the travel owner; automation instructions remain the behavior
owner. Extend existing prompt and connected-context skill policy only. No schema,
projection retention, scheduler, location memory, or provider integration is added.

## Evidence and implementation

The outdoor setup prompt stores a city without a freshness rule. Upcoming plans
expire at arrival, and the capture skill does not repair inherited reminder text.
Resolve location at each occurrence, retrieving bounded recent canonical travel
when needed. The morning pass repairs affected instructions with existing inspect
and versioned patch, including after a previous partial pass. Preserve explicit
fixed destinations, schedules, routes, clinical support, opt-outs, and corrections.

## Verification

- Deterministic assembled prompt and skill boundaries before live proof.
- Live Codex: travel capture repairs one stale reminder; contextual reminder uses
  newer travel, member correction wins, uncertainty omits stale weather, fixed venue
  stays fixed. Use synthetic state, production builders/tools, and isolated ports.
- Relevant typecheck, diff/complexity review, and changelog.

## Failure and rollout

Morning failures cannot bypass runtime location policy. Missing evidence falls
back to the ordinary cue without invented city or weather. This is prompt/skill
behavior in the existing runner bundle; no migration or coordinated protocol
change. Local evidence does not establish deployment or live-member repair.

## Completed evidence

- Existing prompt/skill owners and managed morning seed updated. Runtime policy
  remains available even when automation editing is unavailable.
- `pnpm test:assistant:live -- --test "resolves travel reminder location at execution: <scenario>"`
  passed separately for `past-arrival`, `member-correction`, `conflicting`, and
  `fixed-destination` on gpt-5.6-terra through local subscription. Ready: canonical
  travel list/show precedes destination weather after arrival; corrections win;
  uncertainty omits city/weather; fixed venues stay fixed. Plans are conditional,
  reminders still deliver, and canonical records remain unchanged.
- `pnpm test:assistant:live -- --test "captures travel and repairs stale reminder location without changing timing or fixed destinations" --model gpt-5.6-luna`
  passed through local subscription with the production seed's high reasoning.
  Ready: one trip, one version-checked contextual reminder repair, no timing or
  fixed/unrelated reminder changes. A second fresh pass stays silent and creates
  no duplicate trip, follow-up, or repair.
- Focused `model-behavior`, `connected-apps-prompt`, and `managed-automations`
  suites passed (165 tests). The final skill assertions passed separately after
  tightening canonical detail reads. Assistant and web typechecks passed.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/changelog-page.test.tsx`
  passed (10 tests). The documented app-directory command finds no tests; reused
  the existing documented-changelog-test Frog finding and root invocation.
- Docs drift, diff whitespace, privacy, and complexity checks passed; source
  complexity debt and maxima are unchanged. Parent review found no additional
  state owner, migration, dependency, or scheduler behavior. This is prompt-primary
  work without an independent backend change requiring external review.
- No production records changed; deployment and production-member verification
  remain separate. Stochastic passes prove these journeys, not every future sample.
Status: completed
Updated: 2026-09-22
Completed: 2026-09-22
