# Remove Legacy Requested Abort Status

Status: completed
Updated: 2026-07-15

## Goal

Delete the retired `requested` workspace-invocation abort result now that the
current container boundary always settles a missing-pointer abort to
`accepted`, `inactive`, or `stale` before returning to the Durable Object.

Success criteria:

- Remove the impossible status from the exported type and controller branch.
- Remove request-only compatibility tests and protocol prose.
- Preserve exact attempt, lease-generation, and user identity checks.
- Preserve stale retry, inactive handling, and fail-closed shell recycling.

## Constraints

- Keep the change limited to the retired `requested` result. Do not simplify
  other abort statuses or lifecycle behavior in this task.
- Do not modify or close the separate hosted runner destroy-timeout plan or its
  coordination-ledger row.
- Keep the current Cloudflare rollback floor at PR #627 or newer; this cleanup
  does not authorize an older Worker or runner rollback.
- Do not add a replacement flag, compatibility manager, or persisted state.

## Approach

1. Remove `requested` from the runner abort result type.
2. Remove the controller-only `acceptRequestedAbort` option and branch.
3. Delete or update tests whose only purpose was the old request-only result.
4. Delete the corresponding deploy-skew paragraph from the runtime protocol.
5. Run focused Cloudflare tests, stale-string checks, `git diff --check`, and
   the truthful diff-aware verification lane.

## Deployment Compatibility

This is a Cloudflare Worker/container contract cleanup with no web-side change.
Current runner code no longer produces `requested`; a stale runtime string would
fall through to retry rather than clear a fence. Deploy and rollback remain
bounded to PR #627 or newer, where the settled abort behavior is already live.

## State

Implementation and local verification are complete. The focused Cloudflare
tests, stale-string checks, diff hygiene, and diff-aware workspace verification
all pass. Commit, PR publication, CI, and ReviewGPT remain pending the parent
coordination flow.
Completed: 2026-07-15
