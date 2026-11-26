# Health wins data-model optimizations

## Accepted changes

1. Check access to the parent before reading a comment page. Bind its poster to the existing comment policy and keep eligibility lookups local to each candidate author. After opening content, recheck the session, parent and selected comments. Keep the identity recheck on the hide list.
2. Give the game owner one SQL definition of partnership based on joined, present seats in a live or settled game. Health and Progress apply their own visibility rules. Cancellation writes the event and void status together. Progress departures and game home still inspect cancellation events because they include void history.
3. Share the request's exact-root unwrap cache across native authentication, the Health rollout check and handler work. Retain live authority checks and the existing viewer-bound cursor.
4. Keep the newest three stored candidate days for each member. Prune at successful publication under the profile lock and clean up existing excess rows after older writers drain. Keep sparse-day fallback and revision and check-time fences. Account data service lists candidate sets for deletion coverage. Settings exports recorded activity summaries.
5. Remove the global Health post ordering index through the transactional postdeploy cleanup lane. Feed and profile reads retain the author-prefixed index. Detail reads can seek by primary key.

## Deferred decisions

- Revisit a per-game partner projection keyed by member, partner and game after measuring the shared query at representative cardinalities. The proposed refresh can invert game and member locks during account deletion. PostgreSQL transition tables require separate trigger events and preclude column-specific UPDATE triggers. Paged anonymization must remove obsolete links at each commit. If justified, the projection would replace the game's shared SQL derivation.
- Measure route-level unwraps by exact root and generation, including authentication and profile names, before considering cross-request caching or a Health content-key hierarchy. Either decision requires a security-policy review.
- Keep feed fan-out on read. Defer inbox fan-out, read replicas, partitioning, published post retention and UUIDv7.
- Inspect native cheer and hide retries across devices before considering server-side ordering. The current work adds no CRDT.

## Verification

Use synthetic data on fresh loopback PostgreSQL. Check plan shape and executor work for parent denial, long poster-only runs and post pagination. Exercise both rollout forms and populated billing and group branches. Test committed cancellation events and void status, departure and deletion behavior, request-scoped crypto reuse, session revocation, retention, timezone reversals and concurrent replacement. Run focused Vitest suites, Web typecheck, Prisma validation, lint, complexity and documentation drift.
