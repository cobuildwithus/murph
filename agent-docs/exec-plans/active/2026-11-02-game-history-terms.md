# Game history tasks and stake

Status: active
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

Pending implementation and focused proof. Native rendering is owned by the
separate iOS app; this task proves the API values it consumes.
