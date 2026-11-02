# Game history tasks and stake

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and invariants

Outcome: Past game cards receive each player’s task and the game’s prize or dare.
Reaches: Both seats, equal or different tasks, prize, dare, and no stake.
Proof: Pure view, HTTP route, and PostgreSQL hydration/privacy/query-count tests.
History remains viewer-only, block-filtered, bounded, and free of per-game reads.

## Owner and evidence

`GameHistoryGameView` and `buildGameHistoryView` omit the fields. History loads
terms ciphertext but `buildViewInputs` deliberately skips opening it. Reuse the
existing batch decryption and `termsView` used by live `GameView`; no new state,
query, dependency, or formatting owner is needed. Update the weekly-game iOS
contract and history architecture note. No generated history schema was found.

## Plan

1. Add the view fields and hydrate already-loaded terms in the existing batch.
2. Prove seat orientation, latest terms, stake variants, privacy and query bounds.
3. Update contract docs and changelog; run Web typecheck and focused proof.
4. Review the diff, close this plan, commit, open PR, and start ReviewGPT with CI.
5. Reconcile main if needed, merge after required checks, verify Vercel deployment.

## Deployment

Additive Web response only; no persisted schema or hosted-runtime changes.
Existing clients ignore new fields; current clients already tolerate their absence.
Rollback removes these fields and restores the previous card fallback.

## Verification

- Ready: both seats, equal/different tasks, prize/dare/none, latest terms, and
  non-player denial pass in 15 pure projection cases.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage
  apps/web/test/game-history-views.test.ts apps/web/test/game-views.test.ts
  apps/web/test/game-routes.test.ts`: 91 passed.
- Isolated local PostgreSQL history slice (`game-service-postgres.test.ts -t
  history` with `MURPH_TEST_POSTGRES_CONCURRENCY=1`): 6 passed, including the
  populated native-auth/read/signing query and KMS bounds, 50-by-50 cap,
  viewer orientation, block/report filters and existing batch decryption.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm complexity:diff`: passed; no changed source hotspots above 20.
- Native rendering is owned by the separate iOS app; this task proves the API
  values it consumes. No production member data or messages were accessed.
- Legacy kinds map to prize/dare and the first legacy stake supplies the chip;
  original wording and settlement remain unchanged.
- PR #4443 owns final ReviewGPT, exact-head CI and deployment evidence.
Completed: 2026-11-02
