# Deploy smoke live model shrink

## Goal

Shrink PR 162 back to the minimal production-faithful proof that deployed
Codex can make one live OpenAI Responses request with `gpt-5.4-nano` through
the Worker egress credential path.

Success criteria:

- Keep the smoke path on `codex exec`, not a direct container-side OpenAI call.
- Keep a one-shot deploy-smoke egress fence and exact Codex final output check.
- Delete request-envelope validation and special live-smoke retry/status
  machinery that is not required for the proof.
- Preserve metadata-only diagnostics and no raw secret/prompt/body logging.
- Run focused Cloudflare verification for the touched surfaces.

## Constraints

- Prefer deletion and simpler primitives over defensive request-shape coupling.
- Keep Cloudflare as a thin execution adapter.
- Preserve unrelated active work in the runner-container lane.
- Do not expose local user identifiers, home paths, secrets, or raw provider
  credentials in committed artifacts or handoff text.

## Approach

1. Replace strict deploy-smoke OpenAI request parsing with a tiny top-level
   model reader plus existing fence authorization.
2. Remove expected runner bundle query and special pre-live error handling from
   the route, runner, and deploy script.
3. Keep the container endpoint invoking `codex exec --json` in a scratch
   workspace and checking final output exactly `OK`.
4. Prune tests to the smaller invariant.
5. Run focused tests/typecheck and final diff review.

## State

Complete.

## Notes

- This intentionally does not validate Codex's full internal OpenAI request
  envelope. The accepted residual risk is one bounded `gpt-5.4-nano` request
  during an explicitly opened deploy-smoke fence.
- Security/privacy, coverage, and deep-review passes found no unresolved
  actionable issues after making live-model smoke failures non-retryable.
- Verification passed: focused deploy-smoke Vitest set, Cloudflare typecheck,
  and `apps/cloudflare verify`.
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
