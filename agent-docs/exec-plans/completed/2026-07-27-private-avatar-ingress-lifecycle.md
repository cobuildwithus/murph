Goal (incl. success criteria):
- Resolve PR 966 ReviewGPT round-six's accepted private-avatar lifecycle finding without disabling group avatars or introducing a new durable media owner.
- Success means Linq receives a short-lived URL backed by one idempotent, application-encrypted R2 staging object; the vault remains canonical; retries do not multiply objects; invalid/expired capabilities fail closed; and lifecycle plus account deletion cover every staged object.

Constraints/Assumptions:
- Preserve the existing fresh interactive group preflight and final Web authority recheck.
- Keep private image bytes, user ids, R2 object keys, storage namespace ids, and capability secrets out of URLs, logs, durable assistant state, and provider payloads other than the fetched image bytes.
- Do not treat Linq request acceptance as proof that Linq fetched the image.
- Preserve legacy signed Cloudflare Images URL parsing only for rolling deployment; current code must not create new Images objects.
- Use the existing private R2 bucket, per-user runtime encryption, lifecycle configuration, and account-deletion owner instead of a new receipt table, alarm, cron, callback, or external cleanup service.

Retrospective decision:
- The vault remains the sole durable media owner.
- Linq's URL-only avatar boundary may create one transient provider-ingress copy because that copy is application-encrypted, deterministically associated with the user and image hash, bounded by the existing R2 lifecycle owner, and synchronously included in account deletion.
- A Worker capability URL may reveal only an authenticated opaque token and expiry. Its encrypted payload carries the user and storage lookup needed by the Worker; the public route decrypts, hash-verifies, and streams the image with `private, no-store`.
- Cloudflare Images is removed from the current path because signed delivery expiry does not delete the underlying object and the binding supplies no automatic retention owner.

State:
- Implementation, parent final review, and focused verification complete.
- The canonical affected-package phase passed. Its Web/Cloudflare app phase and `pnpm verify:acceptance` could not acquire the repository's non-FIFO exclusive shared-host slot after repeated waits, so those commands were stopped before their blocked phases began; direct owner tests and typechecks cover the changed Web/Cloudflare surfaces.

Done:
- Read the round-six finding and traced upload, retry, provider failure, authority-loss, and account-deletion paths.
- Confirmed from current Cloudflare documentation that R2 lifecycle rules can automatically expire a prefix, private objects can be served through a Worker, and Workers R2 objects carry metadata while the Images binding requires explicit deletion.
- Confirmed the existing bundles bucket is private, lifecycle-managed, user-prefix-deletable, and already supports application-encrypted per-user payloads.
- Rejected direct R2 presigned URLs because they would expose an R2 object key and storage namespace to a third party.
- Rejected tactical Cloudflare Images receipts/alarms because they would add a second durable lifecycle owner solely for this URL-only seam.
- Replaced the Cloudflare Images binding path with one deterministic application-encrypted R2 object and an AES-GCM capability URL on the fixed Murph Worker origin.
- Added strict public GET validation, capability-path log redaction, 24-hour lifecycle cleanup, synchronous account-deletion prefix cleanup, and retry cardinality proof.
- Kept the prior signed Images URL shape as a read-only rolling-deploy compatibility input; current code has no Images binding or upload path.
- Added focused proof for capability sealing before R2 creation, encrypted-at-rest storage, success fetch, invalid/expired/tampered capabilities, maximum URL length, retry reuse, public no-store behavior, upload failure, provider failure, final authority loss, and account deletion.
- Passed the canonical affected-package matrix, including every changed package owner and the hosted-local regression suite.
- Passed the final direct owner checks: 411 Cloudflare tests, 109 Web tests, and the Web and Cloudflare typechecks.
- Confirmed the final diff is whitespace-clean and contains no direct local identifiers.

Now:
- Close the plan in the scoped final commit.

Next:
- Push the exact head, update the PR retrospective, and run ReviewGPT round seven concurrently with CI.

Open questions:
- None.

Working set:
- `packages/runtime-state/src/hosted-storage.ts`
- `packages/hosted-execution/src/{runtime-control,parsers/runtime-control}.ts`
- `apps/cloudflare/src/{storage-paths,crypto,worker-contracts,runner-effects-contract}.ts`
- `apps/cloudflare/src/runner-outbound/private-image-urls.ts`
- `apps/cloudflare/src/worker/{public-routes,route-utils/log-details}.ts`
- `apps/cloudflare/src/user-runner/user-data-deletion.ts`
- Cloudflare deploy/lifecycle config, durable architecture/security docs, and focused tests

Status: completed
Updated: 2026-07-27
Completed: 2026-07-27
