# Deploy Smoke WebSocket Egress

## Goal

Fix the production Cloudflare deploy smoke failure where the managed runner
live model turn exits nonzero after Codex attempts the Responses WebSocket
transport.

Success criteria:

- Reproduce the failing Codex command shape locally without real secrets.
- Keep the deploy-smoke egress grant narrow to the deploy-smoke container,
  active live-turn fence, injected credential placeholder, and body-inspected
  OpenAI Responses HTTPS `POST /v1/responses`.
- Remove the noisy stdin warning from the smoke command.
- Run focused Cloudflare tests, typecheck, and required completion audits.
- Commit, push, and open a PR.

## Constraints

- Do not expose secrets, raw provider headers, local user identifiers, home
  paths, prompts, or response bodies in committed artifacts or handoff.
- Do not widen production OpenAI egress authority for normal hosted turns.
- Preserve the one-request deploy-smoke fence consumption invariant.
- Keep changes scoped to `apps/cloudflare` smoke/runtime tests and docs only
  if needed.

## Working Set

- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/src/runner-egress-intercept.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`
- `apps/cloudflare/test/runner-egress-intercept.test.ts`

## Verification Plan

- Local fake-key repro for current Codex command behavior.
- Focused Vitest for container entrypoint and runner egress intercept.
- `pnpm typecheck`
- `pnpm test:diff` for the touched Cloudflare files if install state allows.
- Required `security-privacy-review`, `coverage-write`, `deep-review`, and
  local final review for the Cloudflare trust-boundary change.

## State

Implementation and local verification complete. Final completion audit reruns
are running after the deep-review auth-env finding was fixed.

## Notes

- Local fake-key repro matched the production stderr prefix: prompt-as-argument
  with ignored stdin makes Codex print `Reading additional input from stdin...`.
- Local fake-key repro also showed Codex CLI 0.140 attempts
  `wss://api.openai.com/v1/responses`, while the deploy-smoke grant only
  authorized model-inspected `POST /v1/responses`.
- `pnpm --dir apps/cloudflare typecheck` passed.
- Focused Cloudflare Vitest passed: 3 files, 211 tests.
- A first `pnpm typecheck` attempt in the isolated worktree failed on missing
  ignored package export artifacts. After `pnpm build:test-runtime:prepared`,
  `pnpm typecheck` passed.
- Initial security audit found that authorizing deploy-smoke WebSocket egress
  would not preserve the model-bound invariant because the model is not visible
  in the WebSocket handshake. The fix now forces the deploy smoke through a
  custom Codex provider with `supports_websockets=false`, preserving the
  existing body-inspected HTTPS `POST /v1/responses` grant.
- Local fake-key repro with that custom provider went directly to HTTPS
  `/v1/responses` and did not attempt `wss://`.
- Deep review found the custom provider also needed `request_max_retries=0`
  and `stream_max_retries=0` so a retryable upstream failure cannot consume the
  one-use fence and then fail on retry. Added both caps and test coverage.
- Final deep review found the custom provider also needed
  `env_key="OPENAI_API_KEY"` so Codex attaches the injected sentinel
  credential before the Worker swaps in the real provider secret. Added the
  env key and test coverage.
- Local fake-key capture with the installed Codex CLI and final provider config
  produced one HTTPS `POST /v1/responses` with sentinel auth, model
  `gpt-5.4-nano`, and no WebSocket stderr.
- Focused Cloudflare Vitest now passes with 3 files and 212 tests.
- Root `pnpm typecheck` passed after the retry-cap fix.
- Scoped `test:diff` passed for the touched Cloudflare files and plan/ledger,
  including `apps/cloudflare verify` with 91 files and 1431 tests.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
