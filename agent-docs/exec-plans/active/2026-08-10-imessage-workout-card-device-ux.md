# iMessage workout-card device remediation

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Keep the provider-rendered workout fallback compact and valid while the
  installed Messages extension opens the native workout details from its
  transcript snapshot.

## Success criteria

- New structured workout cards require `subtitle: null` while existing encoded
  cards with subtitles remain readable.
- Linq compact-table layout fields stay within the provider's 512-character
  field limit and do not repeat every set below the rendered image.
- Active workout chrome says `IN PROGRESS`, not a date-like label the payload
  cannot prove.
- Focused backend tests pass, the sibling native PR passes its Messages tests,
  and a production-identity device build is ready for another physical tap.

## Scope

- In scope: response-card authoring schema, Linq static layout, shared Web image
  state label, focused tests, and the live workout-card product spec.
- Out of scope: new state, a web workout client, app deep links, provider
  capability versioning, or changes to canonical workout mutation.

## Constraints

- Technical constraints: preserve persisted-card and native decoder
  compatibility; use the existing image and text fallback owners; every Linq
  layout field must be provably bounded.
- Product/process constraints: native reader remains the first release gate;
  backend emission does not prove App Store adoption or physical interaction.

## Risks and mitigations

1. Risk: removing verbose visible captions reduces semantics when the raster is
   unavailable.
   Mitigation: retain the complete durable text renderer and the existing
   value-free instruction to ask Murph for the card in text.
2. Risk: changing the authoring contract rejects already persisted cards.
   Mitigation: constrain only the model-facing workout authoring branch; keep
   runtime and native decoders compatible with legacy non-null subtitles.

## Tasks

1. Replace verbose compact-table Linq captions with one bounded summary.
2. Require null subtitles for newly authored structured workout cards.
3. Align the Web image state label and update the live product contract.
4. Add boundary/regression tests and run focused verification.
5. Commit, push, open the remediation PR, and run exact-head review plus CI.

## Decisions

- The static fallback remains an image card; no new website or host-app
  destination is introduced.
- Full card semantics remain in the durable text owner instead of duplicating
  them in visible provider chrome.

## Verification

- Focused operator-config lane: passed, 5 files and 20 tests. This includes
  concise exact layouts, the 512-character provider-chrome bound, smaller
  realistic V4 URLs, and the pinned legacy TypeScript-to-Swift fixture.
- Focused Web image lane: passed, 1 file and 10 tests. Synthetic desktop and
  mobile catalog captures show the subtitle-free active workout raster with
  `IN PROGRESS` and no horizontal clipping.
- Focused hosted-execution lane: passed, 1 file and 24 tests.
- Assistant authoring/skill/outbox cases: passed. The complete selected outbox
  file also passed every changed workout case but hit one unrelated 60-second
  retention-test timeout under parallel host contention.
- Package typechecks for operator-config, assistant-engine, and
  hosted-execution: passed. Full Web typecheck, scoped Web lint, and
  `pnpm docs:drift`: passed.
- Expected remote outcomes: exact-head CI and ReviewGPT confirm the same
  contract across the broad reverse-dependent surface before merge.
