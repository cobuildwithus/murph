# Separate Generated-Delivery Cleanup From Shutdown Handoff

Status: active
Updated: 2026-08-24

## Goal

Make PR 2231 independently mergeable beside PR 2235 by retaining only the
generated-delivery cleanup and bounded checkpoint diagnostics in PR 2231.
PR 2235 exclusively owns shutdown wake handoff behavior.

## Evidence

- Both PRs currently change the runner wake classification and the same hosted
  shutdown scenario through different strategies.
- PR 2231 also fixes an independent cleanup invariant: one already-missing
  active staging reference must not retain unrelated completed files.
- The cleanup fix and typed diagnostics live below the Cloudflare wake protocol
  and do not require a new retry reason or response header.

## Product UX Patch

- Completed generated files no longer add avoidable weight to later hosted
  checkpoints when a trusted active reference is already absent.
- Active files remain protected, malformed state remains fail-closed, and
  diagnostics remain metadata-only.
- Shutdown handoff latency and its public release note are left to PR 2235.

## Plan

1. Delete PR 2231's shutdown header, retry reason, one-second retry, docs, and
   focused wake tests.
2. Keep the production-shaped generated-delivery cleanup proof while avoiding
   a latency assertion or wake-owner claim that belongs to PR 2235.
3. Narrow PR 2231's changelog item and PR body to the cleanup-only performance
   outcome.
4. Run focused cleanup, snapshot, Cloudflare, changelog, and typecheck proof.
5. Push an exact candidate, complete the required review and CI gates, merge
   PR 2231, and leave PR 2235 independently mergeable.

## Constraints

- Do not edit, rebase, close, or otherwise co-author PR 2235.
- Preserve the completed historical plan as an immutable snapshot.
- Do not weaken shutdown fencing, generated-delivery ownership checks, or
  structural fail-closed behavior.
