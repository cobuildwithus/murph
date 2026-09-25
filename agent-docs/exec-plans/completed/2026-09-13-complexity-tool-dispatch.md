# Separate dynamic tool execution handlers

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and invariant

Reduce the second-largest current hotspot, dynamic-tool dispatch (189), while preserving tool results, effect authority, ordering, and provider-visible contracts. The dispatcher retains all shared image-completion authority, computer transport admission, and invalid-argument checks before routing. Existing execution owners keep all effects.

## Design

Move response-card fallback, card attachment, media attachment, device request assembly, video-analysis request assembly, and the computer operation family into private typed handlers in the same file. Pass the already-captured completion scope into media handling; never re-read mutable authority. Use narrowed request parameters without casts. Preserve existing messages, null/default behavior, and asynchronous effect ordering. No persisted state, dependency, public export, schema, or deployment protocol changes.

## Proof and completion

Run focused dynamic-tool, response-card, media, device, computer and failure-boundary tests; assistant-engine typecheck; complexity and privacy review. Run a focused production-derived real-Codex tool journey after deterministic proof. Open an isolated PR and run final ReviewGPT concurrently with exact-head CI. Internal refactoring alone needs no changelog.

## Progress

Implementation complete. Dispatcher complexity 189 → 139; file debt 483 → 433. Every new handler stays below 20. Existing shared authority and argument checks remain in the dispatcher before handlers; media receives the original captured scope.

151 focused tests passed across dynamic tool runtime, computer tools, response cards, failure boundary and device error suites. Assistant-engine typecheck and complexity guard passed. The existing real-Codex account-portal journey passed using an authenticated local subscription profile: exactly one open and one finish action, no private information entry, no unintended computer operation, and the expected member-facing setup-readiness result. No prompt or schema construction changed.

Local candidate review confirmed original branch bodies, await order, tool messages, and effect ownership are preserved. Exact-head CI and ReviewGPT remain external completion gates after PR publication.
Completed: 2026-09-13
