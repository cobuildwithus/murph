## Goal

Land the returned package-architecture patch on top of the newer owner-package split so npm publication is reduced to five public packages while workspace-private runtime packages remain installable through bundled tarball payloads.

## Success Criteria

- `scripts/release-manifest.json` publishes only `@murphai/contracts`, `@murphai/hosted-execution`, `@murphai/gateway-core`, `@murphai/murph`, and `@murphai/openclaw-plugin`.
- Every other workspace package under `packages/*` is `private: true` and no longer claims standalone npm publication.
- Public tarballs that still rely on private workspace packages declare and bundle those private deps so npm installs stay functional without publishing the internals.
- Release validation fails closed when a public package depends on a private workspace package that is not bundled correctly.
- Durable docs describe the five-package public surface and the private-owner-package policy accurately for the current post-`assistant-core` layout.

## Scope

- `scripts/{release-manifest.json,release-helpers.mjs,pack-publishables.mjs,verify-release-target.mjs}`
- `packages/*/package.json`
- release/package READMEs that describe publishability
- `ARCHITECTURE.md`
- `README.md`
- `agent-docs/operations/verification-and-runtime.md`

## Constraints

- Treat the returned patch as behavioral intent, not overwrite authority; it predates the `assistant-core` hard cut and the vault-upgrade lane, so port its packaging semantics onto the current package graph.
- Preserve unrelated dirty-tree edits, especially the active hosted-web onboarding files already in progress.
- Keep workspace package dependencies acyclic and import boundaries unchanged; this is a release-surface change, not an ownership reshuffle.
- Verification must include the release helper syntax/validation checks from the returned patch plus the repo baseline required for this cross-cutting release-manifest change.

## Verification

- `node --check scripts/release-helpers.mjs`
- `node --check scripts/pack-publishables.mjs`
- `node --check scripts/verify-release-target.mjs`
- `node scripts/verify-release-target.mjs`
- `pnpm typecheck`
- `pnpm test:coverage`

## Notes

- High-risk cross-cutting patch landing because it changes published package boundaries, release validation, and pack behavior.
- The current repo already uses `@murphai/assistant-engine`, `@murphai/vault-inbox`, and `@murphai/operator-config`, so any older `assistant-core` references from the patch must be mapped to the new owner packages rather than restored.
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
