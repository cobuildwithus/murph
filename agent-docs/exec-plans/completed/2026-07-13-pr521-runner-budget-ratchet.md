# PR 521 Runner Budget Ratchet

## Goal

Restore the hosted runner bundle CI gate after the reviewed device-ingest
ownership fix intentionally increased the static boot closure beyond its prior
ratchet, using the exact Linux CI measurements printed by the guard.

## Evidence

- The prior PR head measured a 6,914,486-byte static boot closure against a
  6,914,632-byte limit, leaving only 146 bytes of noise headroom.
- The corrected head measured a 1,423,217-byte entry chunk and a
  6,961,087-byte static boot closure.
- The latest `main` run independently failed the same existing entry-chunk
  limit, so the entry baseline also needs the measured current value.
- The fixed 9,300,000-byte total bundle ceiling remains unchanged.

## Plan

1. Set the entry and static-closure baselines to the exact measured CI values
   and update their dated rationale.
2. Update the exact ratchet contract test without weakening forbidden-input or
   fixed-total-ceiling guards.
3. Run the focused Cloudflare budget test and the production hosted-local
   runner assembly proof, then complete the required audits and verification.
4. Commit, push, and restart ReviewGPT and CI on the corrected exact head.

## Invariants

- The change resets reviewed baselines; it does not add speculative headroom.
- Existing 48,000-byte entry and 96,000-byte static noise bands remain fixed.
- The total bundle ceiling stays 9,300,000 bytes.
- Forbidden provider/importer inputs and boot probes remain unchanged.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts --no-coverage` — passed, 28 tests.
- `MURPH_RUNNER_BUNDLE_BUILD_CONCURRENCY=4 MURPH_RUNNER_BUNDLE_SKIP_PACK_PREFLIGHTS=1 MURPH_RUNNER_BUNDLE_TEST_PARSER_TOOLCHAIN=1 pnpm --dir apps/cloudflare runner:bundle:hosted-local` — passed; parity and boot probes completed.
- `pnpm --dir apps/cloudflare typecheck` — passed.
- `pnpm test:diff apps/cloudflare/scripts/runner-bundle/bundle-entrypoint.ts apps/cloudflare/test/runner-bundle-entrypoint-bundle.test.ts` — passed, including all 96 Cloudflare test files and 1,736 tests.
- Coverage-write audit — no additional tests required; exact baselines, tolerance boundaries, fixed total ceiling, forbidden inputs, dynamic inputs, boot probes, and missing-entry failure are already covered.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
