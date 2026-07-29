Goal (incl. success criteria):
- Resolve PR 966 ReviewGPT round-seven's accepted account-deletion race and obsolete Images-contract finding without disabling private group avatars.
- Success means private-media staging and user deletion linearize under the existing per-user UserRunner owner; deletion cannot finish before an admitted stage is either swept or rejected; a stage queued behind deletion returns no capability; and the cross-runtime publisher carries only bytes plus content type.

Constraints/Assumptions:
- Keep the vault as the sole durable media owner and the existing private R2 lifecycle as fallback retention.
- Add no receipt table, alarm, cron, callback, queue, replay path, or second deletion owner.
- Preserve the fresh runtime write fence, generated/reused avatar behavior, deterministic encrypted R2 identity, capability validation, and rolling URL compatibility.
- Treat the one-day R2 rule as an eligibility threshold followed by asynchronous deletion, not a physical-retention upper bound.

State:
- Implementation and scoped verification complete; ready for commit and exact-head review.

Done:
- Read the complete round-seven artifact and accepted both substantive findings.
- Proved the deletion race statically: the current Worker validates the fence outside the UserRunner, while staging writes R2 independently of the UserRunner-owned one-pass deletion sweep.
- Confirmed the existing `withSerializedLock` helper and per-user UserRunner RPC boundary can own both operations without new persisted coordination.
- Confirmed filename, metadata, and source are parsed and validated after their sole Cloudflare Images consumer was removed.
- Moved private-media staging into the existing per-user UserRunner and serialized it with account deletion under one in-memory mutation lock.
- Revalidated the runtime write fence inside the serialized staging operation so deletion-first ordering returns no capability.
- Reduced the cross-runtime publisher request to image bytes plus allowlisted content type.
- Added controlled staging-first and deletion-first race tests and updated publisher/group-tool contract coverage.
- Updated architecture, security, and deployment docs to state the serialization invariant and distinguish lifecycle eligibility from physical deletion.
- Passed assistant-engine and Cloudflare typechecks; focused publisher, group-tool, and UserRunner suites; the full affected package portion of `pnpm test:diff`; the complete Cloudflare Node suite (2,002 tests); and the Cloudflare Workers suite (2 tests).
- Attempted both canonical app verification within `pnpm test:diff` and `pnpm verify:acceptance`; each remained queued behind unrelated shared-host verification until the session-owned waiting process was cancelled.

Now:
- Close this plan through the normal scoped commit path.

Next:
- Push, update the PR retrospective, monitor CI, and run ReviewGPT round eight against the exact pushed head.

Open questions:
- None.

Working set:
- `packages/assistant-engine/src/assistant/{execution-context,assistant-codex/dynamic-tools}.ts`
- `apps/cloudflare/src/{runner-effects-contract,runtime-platform/private-image-url-publisher,runner-outbound/private-image-urls}.ts`
- `apps/cloudflare/src/{worker-contracts,worker/user-runner-durable-object,user-runner/hosted-user-runner}.ts`
- focused assistant, Cloudflare publisher, UserRunner deletion, and contract tests
- current security/deploy docs and PR body

Status: completed
Updated: 2026-07-27
Completed: 2026-07-27
