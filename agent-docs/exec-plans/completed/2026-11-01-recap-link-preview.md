# Recap link preview

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Outcome and scope

Replace the homepage unfurl with one static 1200×630 recap ticket image.
Reuse the metadata helper and preserve noindex, no-referrer, ID validation
and the lookup-free handoff. Leave page body and native handoff untouched.

## Product UX

- Effort: Patch.
- Outcome: Recap links identify the recap and its app destination.
- Reaches: Every recap preview, including unknown valid game IDs.
- Proof: Metadata, PNG dimensions, real fonts, approved Paper comparison,
  full-size and chat-size rendering, and live HTML/image fetch.

## Tasks and verification

1. Export the approved Paper artboard as a static PNG with its real
   Fraunces 600 (SOFT 100, WONK 1, optical sizes 144/72), DM Sans 500
   and DM Mono 500 fonts.
2. Set both image metadata objects and approved title/description.
3. Extend existing recap tests and validate the PNG header.
4. Run focused Web tests, typecheck, lint, complexity and diff checks.
5. Attach the safe PNG to the PR; run ReviewGPT concurrently with CI.
6. Verify findings, merge with exact-head checks green, verify live
   metadata/image, and retire the worktree. Respect other review lanes.

## Decisions

- Static PNG avoids runtime fonts, rendering, params and game lookups.
- Only generic approved copy appears in the image.
- Paper export is the source asset; its local lossless PNG optimization is
  verified pixel-identical. No runtime font loading is needed.
- The existing share-preview study displays the shipped PNG directly.
- Rendering scratch and review artifacts remain ignored.

## Results

- Initial focused recap/changelog tests: 15 passed. Web typecheck passed.
- Complexity guard passed with no hotspots; page body is byte-unchanged.
- Full-size and 360px-wide image inspected; approved Paper export matched.
- Final focused tests: 15 passed across recap handoff, PNG and changelog.
- Final Web typecheck, scoped lint and diff checks passed.
- Implementation is complete. PR #4433 owns the external ReviewGPT,
  exact-head CI, merge and production verification receipts.
Completed: 2026-11-01
