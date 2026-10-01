# Reduce repeated device-sync source snapshots

Status: completed
Created: 2026-09-07

## Outcome and invariants

Reduce signed Web snapshot reads during Junction reconciliation without caching
import authority, changing sync cadence, or weakening source disconnect/reconnect
fences. Target repeated inventory projection across bounded summary continuations.
A near-half reduction in this path is not a claim about all snapshot traffic.

## Evidence and design

The provider pass executor reuses inventory for resource jobs but clears it for
every reconciliation job. Each bounded summary continuation reloads inventory and
reads sources for projection, then reads sources after the summary fetch for
import admission. Extend the existing loader to compatible reconciliation jobs.
Keep bounded and ordinary collection scopes distinct, preserve lifecycle keys,
and discard reuse after failures, history, and unrelated job kinds. Every import
retains its live post-provider source read. Web remains the source authority;
the existing worker pass owns the inventory lifetime.

Keep day-level imports, collection limits, foreground yields, retries, and durable
job formats unchanged. Add no dependency, timer, or persisted cache.

## Proof and completion

1. Reproduce repeated summary inventory and snapshot reads.
2. Prove unchanged imports with fewer reads and preserve disconnect, reconnect,
   failure, new-pass, history, and bounded collection behavior.
3. Run focused provider/service tests, typecheck, complexity and diff checks;
   update the provider owner documentation and review the candidate.
4. Commit the implementation. Deployment and equal-load production measurement
   remain separate from deterministic local proof.

Product UX: internal efficiency only; no public changelog or model-reply proof.

## Result and candidate review

Implemented at the existing provider-pass owner. A complete synthetic summary
chain produces identical canonical import payloads and continuation results:
four inventory requests become one, and eight source reads become five (37.5%
fewer). Every import retains a post-fetch source read. This does not establish a
50% endpoint-wide reduction. Production savings depend on compatible jobs sharing
a pass; separate drains and lifecycle changes still fetch fresh inventory.

Focused regression reproduced the duplicate read before the fix. Provider,
backfill, resource, admission, and service suites passed (252 tests), followed by
the expanded source-reuse suite (12 tests). Package typecheck and the expanded
suite passed again after the last test edit. Complexity debt and maximum are unchanged;
reviewed the existing execution hotspots and kept the change inside the loader.

Parent review traced hosted source reads through the service context, checked
pass lifetime and collection-policy separation, and inspected the full diff for
privacy and unrelated changes. No schema, protocol, cadence, retry boundary,
import authority, or dependency changed. Existing source imports and durable job
formats remain compatible with prior Web and worker versions. No migration or
coordinated deployment is needed; production measurement remains outstanding.

Verification commands:

- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/junction-timeseries-source-reuse.test.ts test/junction-admission-source-reads.test.ts test/junction-provider-backfill.test.ts test/junction-provider-resources.test.ts test/service.test.ts`
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --no-coverage test/junction-timeseries-source-reuse.test.ts`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm complexity:diff`
- `git diff --check`

This is a local implementation commit. PR publication, exact-head CI, and the
applicable final ReviewGPT remain part of subsequent PR completion.
Updated: 2026-09-07
Completed: 2026-09-07
