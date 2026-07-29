# Private media reply-target remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Resolve ReviewGPT round 4 by preserving an explicitly selected reply target
  when visible private-media recovery text coexists with an approved vault-file
  delivery.

## Success criteria

- The mixed reply-required and vault-owned final-action patch does not clear the
  selected reply target.
- Final assistant output retains the accepted input ref.
- Local delivery resolves that ref into a native Linq reply to the exact
  selected provider message.
- The existing vault-file owner fence and visible recovery behavior remain
  unchanged.

## Constraints

- Delete the incorrect target mutation instead of adding state or branching.
- Keep target clearing only on final actions that genuinely suppress the
  visible response.
- Add no owner, queue, persistence, compatibility path, or lifecycle.

## Tasks

1. [x] Delete reply-target clearing from the mixed visible-reply branch.
2. [x] Extend the mixed-output runtime proof with an accepted reply target.
3. [x] Make the existing local-delivery target proof exercise a Linq/iMessage
   recovery response.
4. [x] Run focused and canonical verification.
5. [ ] Complete ReviewGPT round 5, exact-head CI, merge, deployment, runtime
   proof, and worktree retirement.

## Verification

- Focused mixed-output runtime proof: 1 passed.
- Focused native Linq reply proof: 1 passed.
- Full assistant Codex runtime file: 231 passed.
- Full local-service runtime file: 96 passed with an 8 GiB Node heap after the
  default 4 GiB run exhausted its heap with 81 passing tests.
- Assistant-engine typecheck: passed.
- Local `pnpm test:diff` completed every admitted package suite; the final app
  verifier remained unadmitted for ten minutes behind unrelated shared-host
  owners and was cancelled at its admission boundary.
- Canonical `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance` passed against
  staged tree `8301f6cc597b0519cf42a07275104d245ea588dc` with 16 CPUs and 63,501 MiB
  memory. Cloudflare Node passed 2,053 tests, Cloudflare Workers passed 2 tests,
  the web verifier built successfully, and the one-shot Testbox stopped after
  success.
- `git diff --check` and the staged privacy scan passed.
Completed: 2026-07-29
