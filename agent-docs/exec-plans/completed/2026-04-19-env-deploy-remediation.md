## Title

Remediate hosted web and Cloudflare env drift, rotate missing hosted-wake keys, and align deploy workflow wiring.

## Goal

Bring Vercel, GitHub Actions, and Cloudflare runtime configuration back in sync with the current hosted wake and hosted control-plane env contract without exposing secret values.

## Scope

- `.github/workflows/deploy-cloudflare-hosted.yml`
- minimal related docs/config only if the deploy contract must be corrected in-source
- remote Vercel env vars for `apps/web`
- GitHub repo/environment secrets and vars used by the Cloudflare deploy workflow
- Cloudflare worker secrets written through Wrangler after the GitHub environment is aligned

## Constraints

- Never print or persist generated secret values in repo files, logs, or handoff text.
- Preserve unrelated in-flight worktree edits and limit repo changes to deploy/env wiring.
- Remove stale env names only after the replacement name is present where the current code expects it.
- Keep Cloudflare deploy wiring aligned with the current required worker secret list.

## Verification

- `pnpm typecheck`
- focused workflow/config verification from the repo acceptance lane if needed
- direct CLI presence checks for Vercel, GitHub, and Wrangler after updates

## Notes

- Current code requires `HOSTED_EXECUTION_CONTROL_URL`, `HOSTED_WAKE_FETCH_PROOF_KEY`, and `HOSTED_WAKE_ENCRYPTION_KEY`.
- The GitHub deploy workflow currently does not wire `HOSTED_WAKE_ENCRYPTION_KEY` into the job env even though deploy preflight and Wrangler now require it.
- Production Vercel now has `HOSTED_EXECUTION_CONTROL_URL`, `HOSTED_WAKE_FETCH_PROOF_KEY`, and `HOSTED_WAKE_ENCRYPTION_KEY`; stale `HOSTED_EXECUTION_DISPATCH_URL` is removed from production, preview, and development.
- GitHub production now has `HOSTED_WAKE_ENCRYPTION_KEY` as an environment secret.
- Local `wrangler secret put HOSTED_WAKE_ENCRYPTION_KEY` failed with Cloudflare API auth error `10000`; the repo-side workflow wiring is patched so the next deploy with a token that can mutate Worker secrets can converge the live Worker state.
- `pnpm verify:acceptance` is queued behind another live workspace verify lock owned by a separate `apps/web` lane and has not produced a final result yet.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
