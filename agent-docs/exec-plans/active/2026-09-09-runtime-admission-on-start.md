# Check runtime admission once per session

Status: active
Created: 2026-09-09
Updated: 2026-09-09

## Goal and scope

Remove the repeated signed Web admission callback from active runtime wakes.
Check at the existing fresh/replacement session boundary, before preparation
and allocation. Delete obsolete admission work for compatibility prewarm hints.
No new cache, persisted state, token, dependency, or service.

## Authority and failure boundaries

The current write fence identifies an admitted session; replacement always
rechecks the Web-owned member and consent facts. Explicit withdrawal remains
serialized behind ensures, reads current consent, clears the fence, and stops
the exact runner before success. A failed stop keeps the fence cleared and the
pending target available for cleanup retry. Unavailable admission cannot launch
a new session. Web ingress, AI, usage, and other live consent gates remain owned
by their existing boundaries. A failed withdrawal RPC is not an acknowledged
stop; this change adds no alternate revocation authority.

## Product UX

Patch. Active messages avoid one serial callback. New and replacement sessions
retain admission. Revoked, missing, or suspended members cannot create sessions;
a missing legacy consent grant remains allowed. Expired commands cannot launch
late after waiting behind withdrawal. Legacy prewarm hints have no effects.
Result Ready after focused proof; external review and CI pending. No prompt, tool, or reply-input
surface changes for either private or group conversations.

## Tasks and verification

- Move admission into fresh-session startup and remove no-op hint machinery.
- Prove one startup read, zero reads on warm wakes, denied/unavailable replacement,
  withdrawal ordering and failed-stop recovery, and the original command budget.
- Run focused Cloudflare tests and typecheck, changelog render proof, complexity
  diff, parent review, exact-head CI, and ReviewGPT on the pushed candidate.
- Close this plan after review, then verify final-head CI and mergeability.

## Evidence

- Cloudflare focused UserRunner, container-identity, and fleet lifecycle suites:
  305 tests pass. Includes real state-store/fleet composition and withdrawal.
- Web consent admission, withdrawal, and changelog rendering: 22 tests pass.
- Cloudflare typecheck and complexity diff pass; controller debt stays 5,
  with its unchanged existing-session decision function at 25. Startup remains
  within the threshold after deleting unnecessary null-spread fallbacks.
- The late-response deadline regression failed before restoring the post-read
  deadline check and passes afterward. No allocation can follow that deadline.
- Two clock-sensitive tests failed during a slow run; both passed in isolation
  and the complete final focused run. No production workaround was added.
- Parent review: 96 net runtime source lines removed; existing callback, write
  fence, revocation lock, and command budget remain the sole owners. No new
  dependencies, state, cache, services, or alternate admission authority.
- Web typecheck passes. Exact-head CI and ReviewGPT pending.
