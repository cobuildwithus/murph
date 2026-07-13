# Managed Auth Handoff Diagnostics And Fallback

## Goal

Make hosted Managed Auth failures observable without exposing browser capabilities or provider payloads, and automatically hand the member to the existing live-browser login flow when Managed Auth cannot start but the task browser can be restored.

## Evidence

- Production requests reached the Managed Auth continuation route twice and returned to the handoff page after roughly 16–17 seconds.
- The same production sequence emitted `HOSTED_COMPUTER_LIVE_VIEW_ORIGIN_NOT_ALLOWED` before a later browser start succeeded.
- The continuation route currently collapses retryable computer errors into one retry page without recording the error code.
- The Managed Auth start recovery path restores the task browser and then throws a generic retryable error instead of swapping to the existing live-browser fallback handoff.

## Constraints

- Keep `apps/web` as the sole Kernel credential and browser-capability owner.
- Never log handoff tokens, Managed Auth URLs, live-view URLs, connection ids, domains, provider bodies, credentials, or browser secrets.
- Preserve exact member ownership, short-lived hashed handoff tokens, strict Kernel Hosted UI origin checks, and single profile-writing-browser ownership.
- Reuse the existing `login` handoff and runtime-log owners; add no queue, scheduler, persisted state, or fallback service.
- Preserve unrelated working-tree and coordination-ledger work.

## Plan

1. Add focused failing tests for Managed Auth startup recovery and redacted route diagnostics.
2. Route recoverable Managed Auth startup failure through the existing live-browser fallback handoff instead of returning the managed retry loop.
3. Record the final retryable Managed Auth failure through the existing bounded hosted computer runtime-log path, with fixed-vocabulary stage/error metadata only.
4. Add metadata-only live-view origin validation diagnostics so production can distinguish parse, scheme, host-suffix, and port mismatches without logging the URL.
5. Run focused tests, truthful diff coverage, direct scenario proof, required security/privacy and coverage audits, and parent final review.
6. Finish the scoped commit, open a PR, start ReviewGPT concurrently with CI, and resolve all accepted findings.

## Verification

- Focused Vitest coverage for Managed Auth service, route, runtime log, and live-view origin validation.
- `pnpm test:diff` for all touched `apps/web` files.
- Direct scenario proof that a Managed Auth start failure redirects to a new member-bound live-browser handoff and that persisted diagnostics contain no raw URLs/tokens/provider details.

## State

Completed. Production evidence isolated the failure to the Managed Auth recovery
path: the task browser could be restored, but the service then returned a generic
retry instead of replacing the managed handoff with the existing Live View
handoff. The route also discarded the underlying safe error classification.

The service now swaps recoverable startup failures to a fresh member-bound
`login` handoff, final failures pass through the existing redacted runtime-log
owner, and rejected live-view URLs expose only validation booleans. Focused
tests, owner typecheck, diff-aware web verification, dev smoke, lint, the full
web test suite, and the production build passed. The required security/privacy
review found no medium-or-higher findings; the coverage-write pass strengthened
token, URL, connection, session, and provider-error omission proof and the full
verification lane passed again.
Status: completed
Updated: 2026-07-12
Completed: 2026-07-12
