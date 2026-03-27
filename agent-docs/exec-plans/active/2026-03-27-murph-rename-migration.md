# Healthy Bob -> murph Migration Plan

Last updated: 2026-03-27
Status: in progress

## Goal

Rename the live Healthy Bob product/repo/runtime surface to `murph` with a migration plan that is safe to execute in parallel, explicit about contract breaks, and clear about what should stay historical.

## Success Criteria

- Live product copy, package identity, install surface, and hosted/runtime surfaces stop presenting `Healthy Bob` / `healthybob` as the current brand.
- Persisted contracts and operator-home paths have an explicit migration strategy instead of a blind search/replace.
- Parallel workers can take disjoint rename slices with minimal merge conflict risk.
- Immutable historical records are left alone unless we explicitly choose to annotate or archive them.

## Frozen Implementation Assumptions

This implementation pass proceeds with the following decisions:

1. Package namespace:
   hard-cut live workspace packages and imports from `@healthybob/*` to `@murph/*`.
2. CLI install/binary surface:
   rename the primary published package/bin to `murph`, but keep `healthybob` as a compatibility alias for one release where the package shape permits it.
3. Operator-home path:
   dual-read `~/.murph` and `~/.healthybob`, migrate forward opportunistically, and write new state to the Murph path unless a legacy path must be preserved in place.
4. Persisted schema ids:
   dual-read durable user-owned ids and envelopes where practical, write new `murph.*` ids on fresh output, and hard-cut rebuildable or non-canonical artifacts that can be regenerated safely.
5. External hosted names:
   prefer neutral cookie/header/env/config names rather than inventing branded `MURPH_*` or `x-murph-*` replacements when the surface is external.
6. Historical docs:
   leave completed execution plans and other immutable historical records untouched; document the exception once instead of rewriting snapshots.

## Repo Inventory Summary

This pass found the following rename-heavy surfaces in the live tree:

- `363` files with package/import/bin identity references (`@healthybob/*`, `healthybob`, published package names, bin names).
- `43` files with persisted `healthybob.*` schema/format identifiers.
- `103` files with runtime-path/operator-home/toolchain prefixes such as `.healthybob` or `healthybob-*`.
- `32` files with hosted/external surface references such as `hb_hosted_session`, `x-healthybob-*`, `healthybob-hosted-*`, or `*.healthybob.test`.
- `74` live docs/readme/copy files with current-brand text outside completed plans.
- `78` completed execution-plan files still containing historical `murph` references; these should remain immutable unless policy changes.

Highest-density code areas from the sweep:

- `packages/cli`: `135` files
- `apps/web`: `53` files
- `packages/core`: `41` files
- `apps/cloudflare`: `29` files
- `packages/contracts`: `28` files
- `packages/query`: `16` files
- `packages/web`: `15` files
- `packages/device-syncd`: `15` files
- `packages/parsers`: `14` files

## Recommended Rollout Order

1. Freeze the naming policy.
2. Cut package/import identity and release tooling first.
3. Land runtime-path compatibility for operator home and hosted bundle restore.
4. Migrate persisted schema/format ids with explicit read/write rules.
5. Rename hosted external names and infrastructure defaults.
6. Sweep product copy/docs/UI/system prompts after the contract surface is frozen.
7. Regenerate generated artifacts and finish test/example cleanup.

## Diff Scopes

### Scope A: Workspace Identity And Package Namespace

Owner boundary:
- package manifests
- import specifiers
- TS/Vitest/Next workspace aliasing
- release manifests and package-shape checks

Primary work:

- Rename workspace packages/apps from `@healthybob/*` to the chosen `@murph/*` shape.
- Rename unscoped internal import roots such as `healthybob/...` in `packages/assistant-services`.
- Update source-resolution maps, tsconfig paths, workspace-boundary checks, Vitest aliases, and release manifests.

Representative files:

- `package.json`
- `tsconfig.base.json`
- `scripts/release-manifest.json`
- `scripts/release-helpers.mjs`
- `scripts/verify-workspace-boundaries.mjs`
- `packages/*/package.json`
- `apps/*/package.json`
- `apps/cloudflare/vitest.shared.ts`
- `packages/contracts/tsconfig.json`
- `packages/web/next.config.ts`

Notes:

- This scope is mostly mechanical, but it is high-blast-radius and should land before most downstream workers start rebasing their own imports.
- Keep `vault-cli` decisions out of this scope except where manifests/bin wiring require them.

### Scope B: CLI Package, Bin, Setup, And Shell Install Surface

Owner boundary:
- `packages/cli/**`
- setup wrappers under `scripts/`
- repo bootstrap docs that teach install/run commands

Primary work:

- Rename the published `healthybob` package/bin to the chosen `murph` surface.
- Decide whether `vault-cli` remains unchanged as the raw operator/data-plane alias.
- Update setup wizard copy, onboarding text, shell shim installation, PATH block markers, command examples, and package-shape assertions.

Representative files:

- `packages/cli/package.json`
- `packages/cli/README.md`
- `packages/cli/src/setup-cli.ts`
- `packages/cli/src/setup-wizard.ts`
- `packages/cli/src/setup-services.ts`
- `packages/cli/src/setup-services/shell.ts`
- `packages/cli/src/assistant-cli-access.ts`
- `packages/cli/scripts/verify-package-shape.ts`
- `scripts/setup-host.sh`
- `scripts/setup-macos.sh`

Notes:

- This scope owns the user-visible command rename (`healthybob chat/run/setup/onboard/...`).
- If we keep a compatibility alias for one release, implement it here and document its removal plan.

### Scope C: Operator Home, Toolchain Paths, And Local Runtime Migration

Owner boundary:
- operator config directory
- local toolchain/bootstrap directories
- hosted snapshot path allowlists
- path-sensitive scripts and local web vault resolution

Primary work:

- Rename `.healthybob` and related toolchain/bootstrap paths, or introduce a neutral replacement.
- Add migration behavior for existing operator config, toolchain installs, and hosted bundle restore expectations.
- Update Docker and Cloudflare runner assumptions that currently bake `/root/.healthybob`.

Representative files:

- `packages/cli/src/operator-config.ts`
- `packages/cli/src/setup-services/steps.ts`
- `packages/web/src/lib/vault.ts`
- `packages/runtime-state/src/hosted-bundles.ts`
- `packages/runtime-state/src/hosted-bundle.ts`
- `scripts/package-data-context.sh`
- `Dockerfile.cloudflare-hosted-runner`
- `README.md`

Notes:

- This is a migration scope, not a blind rename scope.
- Backward compatibility matters here because existing local users and hosted bundle restore tests persist these paths.

### Scope D: Persisted Schemas, Formats, And Non-Canonical Artifact IDs

Owner boundary:
- schema literals
- JSON schema `$id` values and titles
- rebuildable and non-canonical artifact formats
- assistant-state/runtime envelopes

Primary work:

- Rename or compatibility-wrap persisted ids like `healthybob.operator-config.v1`, `healthybob.assistant-session.v2`, `healthybob.hosted-bundle.v1`, `healthybob.search.v1`, and similar.
- Regenerate `packages/contracts/generated/**` after changing source schema ids/titles.
- Separate hard-cut candidates from dual-read-required candidates.

Representative files:

- `packages/cli/src/assistant-cli-contracts.ts`
- `packages/cli/src/inbox-model-contracts.ts`
- `packages/cli/src/inbox-model-harness.ts`
- `packages/cli/src/assistant/{store.ts,outbox.ts,turns.ts,diagnostics.ts,cron.ts,failover.ts,automation/artifacts.ts}`
- `packages/query/src/{model.ts,search-shared.ts,search-sqlite.ts,export-pack.ts}`
- `packages/inboxd/src/indexing/persist.ts`
- `packages/parsers/src/{contracts/parse.ts,pipelines/parse-attachment.ts,publish/writer.ts}`
- `apps/cloudflare/src/{crypto.ts,user-env.ts}`
- `packages/contracts/src/{zod.ts,shares.ts,examples.ts}`
- `packages/contracts/generated/**`

Notes:

- Treat persisted canonical-adjacent or local durable state carefully.
- `murph_search_*` SQLite tables are local and rebuildable; those are good hard-cut candidates.
- Assistant-state files, operator config, hosted bundle/user-env, and hosted cipher envelopes likely need dual-read or an explicit migration step.

### Scope E: Hosted Web, Headers, Cookies, And Infrastructure Names

Owner boundary:
- `apps/web/**`
- `apps/cloudflare/**`
- external naming defaults in examples and deploy docs

Primary work:

- Rename hosted cookie/header names and Cloudflare worker/bucket/image defaults.
- Update test hostnames and sample URLs that currently use `healthybob.test`.
- Decide where neutral names are better than rebranding, especially for headers/cookies/env/config keys.

Representative files:

- `apps/web/.env.example`
- `apps/web/src/lib/hosted-onboarding/env.ts`
- `apps/web/test/**` referencing `hb_hosted_session` or `x-healthybob-*`
- `apps/cloudflare/wrangler.jsonc`
- `apps/cloudflare/DEPLOY.md`
- `apps/cloudflare/package.json`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `packages/device-syncd/test/**` with `healthybob.test` hostnames

Notes:

- This scope should not invent branded env prefixes. Use neutral public names unless there is a strong reason not to.
- Coordinate with Scope C before changing anything tied to hosted bundle restore or runner home paths.

### Scope F: Product Copy, UI Copy, Assistant Prompts, And Live Docs

Owner boundary:
- repo readmes/docs
- assistant system prompts and onboarding text
- UI copy in web/CLI surfaces

Primary work:

- Replace live `Healthy Bob` branding in README/docs/package/app readmes, CLI prompts, setup flows, and app copy.
- Update assistant prompt language such as "You are Healthy Bob" and command-hint copy.
- Sweep command examples after Scope B settles the final CLI naming.

Representative files:

- `README.md`
- `ARCHITECTURE.md`
- `agent-docs/index.md`
- `agent-docs/{RELIABILITY.md,SECURITY.md,operations/verification-and-runtime.md}`
- `packages/web/test/{page.test.ts,route.test.ts}`
- `apps/web/app/page.tsx`
- `packages/cli/src/{assistant-cli-access.ts,setup-wizard.ts,assistant-codex.ts}`
- `packages/*/README.md`
- `apps/*/README.md`

Notes:

- Do this after command/package decisions are frozen; otherwise docs churn will be noisy and conflict-prone.
- Active execution plans can be updated opportunistically once the rename is actually underway; completed plans should stay untouched.

### Scope G: Tests, Fixtures, Examples, Temp Prefixes, And Generated Cleanup

Owner boundary:
- temp directory prefixes
- example addresses/hostnames
- generated artifacts and snapshots
- command-surface fixtures and smoke scenarios

Primary work:

- Update temp-dir prefixes like `murph-*`, sample email addresses, command snapshots, and fixture text after the owning scopes land.
- Regenerate generated JSON schemas and doc inventory/doc gardening outputs.
- Rebaseline any tests that intentionally assert brand strings or package names.

Representative files:

- `packages/*/test/**`
- `apps/*/test/**`
- `fixtures/**`
- `e2e/smoke/**`
- `agent-docs/generated/doc-inventory.md`
- `agent-docs/generated/doc-gardening-report.md`

Notes:

- This should mostly be a cleanup/integration sweep after Scopes A-F.
- Keep test-only hostnames distinct from real deployment names; do not overfit test data to production values.

### Scope H: Historical And Archival Surfaces

Owner boundary:
- immutable historical docs and archives only

Primary work:

- Decide what not to rename.
- Record explicit exceptions so future workers do not waste time reopening immutable snapshots.

Default recommendation:

- Leave `agent-docs/exec-plans/completed/**` untouched.
- Leave historical release notes untouched unless there is a product reason to annotate them.
- Do not spend implementation time rewriting audit zips, `.codex-runs`, or vault evidence/history for branding.

Scope H decision for this migration pass:

- Treat `agent-docs/exec-plans/completed/**` as permanently historical rename exceptions for this rollout; do not reopen completed snapshots just to replace legacy branding.
- Treat historical release notes and similar archival changelog material as intentionally unrenamed unless a later product-facing annotation is explicitly requested.
- Treat archived run artifacts such as audit zips and `.codex-runs/**` as historical records; leave them as-is rather than spending migration time on non-live branding cleanup.
- Treat vault evidence/history and other user-owned historical records as out of scope for branding rewrites; preserve the recorded past rather than normalizing it to the new name.
- Use this section as the single active-plan exception note so future rename workers can leave those historical references in place without opening follow-up cleanup scopes.

Notes:

- No additional top-level note is required for this pass unless a later maintainer wants a broader reader-facing archive disclaimer.

## Suggested Parallelization

Start with:

1. Scope A
2. Scope B
3. Scope C

Then in parallel, once decisions are fixed:

1. Scope D
2. Scope E
3. Scope F

Finish with:

1. Scope G
2. Scope H confirmation / exception note

## Compatibility Recommendations

- Package/bin surface: likely needs at least a short alias window unless you are comfortable with an immediate breaking publish.
- Operator-home path: should dual-read old paths initially and migrate/write the new path.
- Persisted local state ids: dual-read where the file/store is durable and user-owned.
- Rebuildable artifacts and local SQLite search tables: safe hard-cut candidates.
- Cookies/headers/env/config keys: prefer neutral names rather than introducing new branded prefixes.

## Verification Expectations For The Eventual Rename

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Regenerate contract artifacts and doc inventory/doc gardening outputs as required by the repo checks.
- Run at least one direct scenario for:
  - CLI install/setup entrypoint
  - local operator-home migration
  - hosted onboarding/session/cookie flow
  - Cloudflare deploy-config rendering or hosted runner smoke path

## Immediate Recommendation

Do not start with a repository-wide search/replace. Freeze the naming/compatibility policy first, then execute the rename as the eight scopes above so package identity, persisted state, and hosted external names do not break in different ways across parallel branches.
