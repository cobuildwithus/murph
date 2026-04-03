# Cloudflare Hosted Sizing Baseline

## Goal

Ship the hosted Cloudflare runner with `standard-1` as the checked-in baseline, a `1m` container idle timeout, and a `120000` ms runner timeout so the default deploy surface matches the chosen production recommendation for voice-note-heavy traffic.

## Scope

- Update the checked-in Wrangler scaffold defaults.
- Update deploy automation defaults and coverage.
- Update runtime idle fallback coverage.
- Update durable deploy/runtime docs to match the new baseline.
- Attempt a live Wrangler settings update if the local environment is already authenticated and targeted.

## Constraints

- Preserve unrelated in-flight hosted-runtime and web-tools edits.
- Keep the change scoped to hosted Cloudflare sizing/timeout defaults.
- Run the Cloudflare validation lane after edits.

## Plan

1. Update the baseline defaults in code and checked-in config.
2. Refresh tests and durable docs so they assert the new defaults.
3. Verify the Cloudflare app locally.
4. Apply the same values live with Wrangler if account context is available.

## Outcome

- Updated the checked-in hosted baseline to `standard-1`, `HOSTED_EXECUTION_CONTAINER_SLEEP_AFTER=1m`, and `HOSTED_EXECUTION_RUNNER_TIMEOUT_MS=120000`.
- Updated deploy automation defaults, runtime idle fallback, tests, and hosted docs to match.
- `pnpm --dir apps/cloudflare verify` passed.
- Wrangler authentication was present and `murph-hosted` resolved as a real Worker, but live `wrangler deploy --dry-run --config wrangler.jsonc` failed before deploy on an existing unrelated bundle error: `Could not resolve "bun:sqlite"` from `@photon-ai/imessage-kit`.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
