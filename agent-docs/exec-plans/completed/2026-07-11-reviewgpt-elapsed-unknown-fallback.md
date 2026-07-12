# ReviewGPT elapsed UNKNOWN fallback

## Goal

Preserve ReviewGPT 0.5.103's existing behavior that accepts `MODEL_CONFIRMATION: UNKNOWN` after at least ten minutes of observed generation, while retaining PR 557's exact committed-turn binding, DOM extraction, private response writes, and stale-evidence safeguards.

## Constraints

- Do not relaunch PR 562 or PR 566 while the driver is changing.
- Keep the fallback limited to one exact assistant turn produced after this run's committed user turn.
- A fallback completion may omit platform model metadata and must not claim platform-slug verification evidence.
- Existing ReviewGPT processes do not hot-reload; only newly launched processes from a proven 0.5.103 install may use the corrected driver.

## Plan

1. Thread observed generation elapsed time through the exact-turn attestation path.
2. Accept a single `UNKNOWN` confirmation only after ten minutes; retain named-model and present-slug mismatch failures.
3. Add focused below-threshold, threshold, exact-turn, and evidence regressions.
4. Regenerate the dependency patch and lock hash, then run focused tests, typecheck, frozen install, and diff checks.

## State

Complete and ready to commit.

## Verification

- Installed package and CLI version: 0.5.103.
- Exact regenerated patch applies under `pnpm install --frozen-lockfile`.
- Focused release-script coverage audit: 33/33.
- CLI typecheck passed.
- Driver syntax and diff checks passed.
- The lockfile contains exactly three references to patch SHA-256 `e531f44740ce83d10a20e1434597e5d59b1962d1410fe8d5056eec749fbb5fa1`.
Status: completed
Updated: 2026-07-11
Completed: 2026-07-11
