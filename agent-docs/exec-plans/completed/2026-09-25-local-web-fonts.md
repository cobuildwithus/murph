# Bundle Web fonts for deterministic builds

Status: completed
Created: 2026-09-25
Updated: 2026-09-25

## Goal and invariant

Remove Google font fetching from Web compilation while preserving Fraunces
400/600, variable DM Sans 100–1000, DM Mono 400, and the existing CSS variables.

## Evidence and decision

The production failure reaches Next's Google font loader extension parser,
which dereferences a failed regex match on a downloaded font URL. The existing
`app/font-assets.ts` is the font owner. Replace its remote loaders with
`next/font/local` and committed, licensed WOFF2 files. Keep OG font assets intact.
No dependency, retry, framework patch, or deployment configuration is needed.

## Tasks and proof

1. Bundle fonts with provenance and licenses; preserve weights and glyph coverage.
2. Update the layout test mock and run focused Web tests, lint, and typecheck.
3. Compile the real font module with the production loader and unavailable Google
   responses, then inspect rendered typography.
4. Review privacy and diff, run complexity guard, and commit the scoped fix.

## Compatibility and product review

Asset-only change with content-hashed URLs; old and new deployments are independent.
No protocol, state, auth, or foreground reply changes. Existing typography remains
the product contract; verify all three families and DM Sans weight range.
No member changelog: this is build reliability maintenance.

## Verification

- Web layout tests: 4 passed; OG asset and pinned card metric tests: 8 passed.
- `pnpm --dir apps/web typecheck`: passed.
- Focused ESLint and `pnpm complexity:diff`: passed; no complexity hotspots.
- Exact production exception reproduced through Next 16.3.0 Google loader with
  a synthetic extensionless font URL.
- Temporary Next production fixture compiled the real `font-assets.ts` and
  bundled files with `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` unavailable: passed.
  All four WOFF2 files total 134,524 bytes; font metadata preserves glyph mappings.
- Real homepage Playwright smoke with external browser requests blocked: passed.
  All four font requests returned 200; all families loaded and DM Sans exposed
  the 100–1000 weight range. Desktop 1280×900 and phone 390×844 inspected.
  Local database-backed counters were unavailable; public rendering degraded
  normally, independently of the font proof. Temporary proof spec removed.
- Product UX: Ready; existing typography and responsive presentation preserved.
- Parent review: scoped frontend asset-loading change; no deployment configuration,
  backend, state, or trust boundary changes. Final ReviewGPT exemption applies.
- Full application build and broad suites remain owned by required PR CI.

Completed: 2026-09-25
