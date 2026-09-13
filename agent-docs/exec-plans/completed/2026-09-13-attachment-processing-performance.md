# Reduce redundant GIF frame encoding

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal and scope

Remove unnecessary compression of temporary GIF storyboard frames. The returned Pro patch identified this small safe optimization; it does not address the broader JPEG/audio latency. Download concurrency, transcription, evidence admission and typing remain unchanged.

## Product UX

- Outcome: Less work preparing animated GIFs, with identical final attachment evidence.
- Reaches: Existing bounded animated GIF storyboard conversion across inbox channels. Static images and audio are unchanged.
- Proof: Native Sharp tests compare final bytes for opaque and transparent animation. Existing GIF/image tests protect frames, metadata, budgets, invalid input and persistence. Ready after focused proof.

## Design and risks

The existing storyboard builder uses PNG buffers as temporary lossless frames before WebP publication. Disable only their PNG compression. No new owner, state, dependency, configuration or abstraction. At most six 320-pixel-edge frames remain bounded; uncompressed intermediates may retain approximately 2.35 MiB of RGBA pixels plus encoding overhead. Final WebP settings and bytes are unchanged.

## Decisions

- Accepted one production option change from Pro; removed its duplicate static-image test and corrected the spy type for the pinned toolchain.
- Preserve all JPEG and transcription quality and lifecycle contracts. Broader improvements lack sufficient evidence in this patch.
- Final external review is not required: this single-owner, lossless intermediate-encoding option changes no protocol, persisted output, authority, state ownership, ordering or external effect. Parent review and exact-head CI remain required.

## Verification

- Focused inbox image suites: 18/18 passing with repository-pinned Sharp.
- Inbox typecheck: passed after correcting the test spy type.
- Complexity: passed; debt 0 to 0, maximum 10 to 10, no hotspots above 20.
- Alternating local synthetic benchmark, five measured samples after warmup: textured eight-frame GIF median 112.88 to 85.36 ms; transparent four-frame GIF 66.83 to 49.74 ms. Final bytes identical. These are local synthetic results, not production speedup claims.
- Changelog rendering: 10/10 passed. Web typecheck passed. The documented app-directory changelog command selected no files; the existing root-level command passed (known Frog entry 20260912202546).
- Parent final review: production option and bounded-buffer tradeoff accepted; no further simplification is justified. Draft PR #3396 created. Exact-head CI and final mergeability remain delivery gates.
Completed: 2026-09-13
