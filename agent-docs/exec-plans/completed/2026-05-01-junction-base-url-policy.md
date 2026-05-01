# Junction base URL override policy

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

Make Junction base URL configuration use one explicit policy: env and region choose the normal URL, while `JUNCTION_BASE_URL` overrides are allowed only when `JUNCTION_ALLOW_CUSTOM_BASE_URL=true`, only for documented HTTPS Junction/Vital API hosts.

## Scope

In scope:

- Junction provider env keys and config parsing.
- Junction client base URL validation.
- Serializable hosted runtime provider config support needed for the gated override flag.
- Hosted Cloudflare deploy variable binding and operator docs for the new override flag.
- Focused device-syncd tests for default URLs, legacy Vital URLs, and rejected unsafe overrides.

Out of scope:

- Changing Junction API paths or data import behavior.
- Adding arbitrary custom staging hosts.
- Broader provider base URL policies for Garmin, Oura, WHOOP, or Strava.

## Decisions

- Use the flexible policy with an explicit opt-in flag.
- Preserve the existing env/region API key prefix validation.
- Accept only HTTPS base URLs for the selected Junction environment/region from the documented `junction.com` and legacy `tryvital.io` API host matrix.
- Reject any explicit `JUNCTION_BASE_URL` unless `JUNCTION_ALLOW_CUSTOM_BASE_URL=true`.

## State

Now:

- Junction docs list four `junction.com` API base URLs and state that `*.tryvital.io` base URLs remain supported.
- The flexible gated policy is implemented in the active checkout.
- Focused tests cover the explicit opt-in gate, documented `junction.com` and legacy `tryvital.io` aliases, mismatched region rejection, arbitrary host rejection, HTTP rejection, query/fragment rejection, and serialized runtime config round-trip.
- Required coverage and security/privacy reviews found no high/medium blockers.
- Final review found the hosted Cloudflare deploy surface also needs the new flag. The workflow binding is present in the current checkout and the operator docs now describe the flag.
- Focused device-syncd proof, Cloudflare deploy automation proof, package typecheck, smoke, and scoped diff whitespace checks pass.

Verification:

- Passed: `pnpm --dir packages/device-syncd exec vitest run test/provider-manifests.test.ts test/config.test.ts test/junction-provider.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/device-syncd typecheck`
- Passed: `pnpm exec vitest run apps/cloudflare/test/deploy-automation.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
- Passed: `pnpm test:smoke`
- Passed: scoped `git diff --check` on task files.
- Blocked: `pnpm --dir packages/device-syncd test:coverage` and scoped `bash scripts/workspace-verify.sh test:diff <task files>` stop on the unrelated existing `packages/device-syncd/test/store.test.ts` webhook trace retention failure.
- Blocked: `pnpm typecheck` stops on unrelated existing `packages/vault-usecases` public seam test import resolution failures for `@murphai/vault-usecases/vault-services` and `@murphai/vault-usecases/helpers`.

Next:

- No follow-up in this lane. The plan is closed without a scoped commit because overlapping dirty Junction and Cloudflare files make an exact task-only commit unsafe in this checkout.

## Working Set

```txt
packages/device-syncd/src/config/provider-config-helpers.ts
packages/device-syncd/src/config/provider-env.ts
packages/device-syncd/src/config/provider-manifests.ts
packages/device-syncd/src/config/serializable-provider-configs.ts
packages/device-syncd/src/providers/junction.ts
packages/device-syncd/src/providers/junction-client.ts
packages/device-syncd/test/config.test.ts
packages/device-syncd/test/provider-manifests.test.ts
.github/workflows/deploy-cloudflare-hosted.yml
apps/cloudflare/DEPLOY.md
agent-docs/exec-plans/completed/2026-05-01-junction-base-url-policy.md
agent-docs/exec-plans/active/COORDINATION_LEDGER.md
```
Completed: 2026-05-01
