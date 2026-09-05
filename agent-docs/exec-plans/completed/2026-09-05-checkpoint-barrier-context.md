# Keep checkpoint barriers in the waiting request context

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal and cause

Fix the demonstrated test-only checkpoint hang that prevents unified runner integration and rollout proof. The barrier created its deferred promise in an idle control Durable Object. After that context hibernated, workerd canceled its continuations even though release succeeded and a separate runner remained busy.

## Implementation

Each waiting checkpoint request now creates its own wait. Shared test state contains a released flag and callbacks owned by those live requests. Release resumes all registered waiters. The original abort check, explicit-release semantics, real checkpoint handler, and foreground reply requirement remain intact. No production compatibility flag or runtime behavior changes.

The normal Workers Vitest pool forces `no_handle_cross_request_promise_resolution`, so it cannot reproduce this behavior. The new regression launches an ordinary local Worker with the existing Wrangler dependency, imports the actual barrier implementation, and lets the separate control object pass the native hibernation window while two checkpoint requests remain active. The fixture rejects unexpected external-state access and uses no remote bindings or credentials.

## Verification

- Before the fix, the ordinary Worker regression failed: release returned true but the real checkpoint request did not resume.
- After the fix, the regression passed, including two waiting requests after a 22-second control-owner idle interval.
- All 24 existing hosted-local test-container control tests passed.
- Cloudflare typecheck passed. The earlier Web typecheck and four PostgreSQL concurrency cases cover the unchanged companion fixture corrections in this PR.
- Docs drift, complexity, and diff checks passed before final commit; source maximum remains below the hotspot threshold.

## Review and remaining rollout gate

Parent review verified that promises originate in the waiting request, releases are synchronous and exhaustive, and release-before-wait and the existing abort check remain valid. Final ReviewGPT is exempt for this test-only fixture/tooling change. The original control-object promise failure was demonstrated in real workerd, rather than inferred from mocks.

Update PR #2963 and rerun exact-head public CI. After merge, rerun private integration, then merge the companion and complete the authorized protected production rollout. This plan records the completed test fix and does not claim deployment or full Linux integration success.
Completed: 2026-09-05
