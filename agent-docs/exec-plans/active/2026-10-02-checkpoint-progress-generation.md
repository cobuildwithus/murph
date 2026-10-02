# Prevent checkpoint progress-generation regression

## Outcome and invariant

A dirty runtime snapshot must use progress generation from the same accepted workspace owner as its version. Web's equal-or-plus-one guard and CAS remain authoritative. No production mutation is authorized for a functional correction.

## Owners and proof

Investigate the status publication, checkpoint request builder, background system-work quiescence, and foreground snapshot publication in assistant-runtime. Reproduce a canonical status checkpoint advancing progress before the subsequent snapshot uses an older generation. Use synthetic composed runtime proof; never place private evidence in source or review packets.

## Approach

1. ReviewGPT tests the ownership hypothesis and implements only a proven minimal correction.
2. Parent independently checks a failing base reproduction, corrected tests, failure/cancellation paths, privacy, and complexity.
3. Run affected typecheck and contract proof. Update the durable owner, scoped commit and draft PR, then required exact-head CI and final ReviewGPT concurrently.
4. Leave an ordinary fix ready for human merge. Continue independent read-only sweep coverage.

Prefer deriving from the existing canonical builder after quiescence. Add no state, retry, timeout, schema, or external work. Supported mixed versions retain the existing request shape and guards.

## Status

The composed base reproduction rejects generation 7 after 8 at current workspace version 15; quiesced and no-progress controls pass. ReviewGPT removed the redundant fallback after proving the request builder is seeded from the active workspace and only advances through accepted checkpoints. The final correction passes all three local scenarios and package typecheck. Complexity passes with unchanged debt (465); the affected existing snapshot publisher remains at complexity 35. Six adjacent runtime race tests and four Web generation-guard tests pass. Parent candidate review confirms unchanged CAS, progress advancement, quiescence and dirty acknowledgment ordering. Final review and exact-head CI remain pending.

## Product UX patch

Outcome: Preserve the latest saved conversation and background progress in the full snapshot.
Reaches: Ordinary foreground work interleaved with completed background work, quiesced work, and a background pass with no progress.
Proof: Two foreground inputs finish before the real snapshot bundle is constructed; expected file contents and imported synthetic data are present, progress increments once, and dirty acknowledgment follows snapshot publication. No prompt/tool/reply policy changes; model behavior is not part of this persistence invariant. Member delivery itself is outside this test's claim.

## Ownership and privacy

Current typing and usage-efficiency PR diffs do not alter checkpoint generation selection. Device-sync investigation completed without a competing patch. This correction addresses the shared default runtime snapshot after foreground canonical writes. Fixtures are synthetic; no private production rows or messages enter this branch.
