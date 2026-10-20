# Guard latest Worker secret inheritance

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal and invariant

Use the supported latest-upload secret inheritance shape while retiring only
`VENICE_API_KEY` and `VERCEL_AI_API_KEY`. Preserve every retained secret and
synchronized rotation; do not activate a candidate whose inheritance source
cannot be confirmed from the version history.

## Owner and evidence

The existing deployment CLI owns stage and promotion uploads. Its release
provider already owns bounded metadata reads, and the existing secret helper
owns the complete expected inventory. Wrangler 4.93 dry-run serializes unsafe
binding metadata without validating server support for an explicit version
selector. The raw Cloudflare versions API returns newest first, including
inactive uploads; Wrangler list instead filters deployable versions and sorts
oldest first. Use the raw API through the existing provider.

## Scope and decisions

- Omit `version_id` from inherit bindings. Preserve temporary config handling,
  required-secret validation, payload partitioning and canonical artifacts.
- Read only the newest two version IDs before/after each upload. Require the
  initial live version as stage source and the verified stage as final source;
  require the uploaded version immediately before its source in history.
- Retain inventory readback, live identity checks, protected workflow serialization
  and activation/smoke/receipt ownership. No locks, durable state, dependencies,
  recovery machine, external mutation or local secret access.
- History checks detect drift; they are not atomic compare-and-swap. An unknown
  inactive latest version requires operational resolution. An upload may persist
  when a later guard fails, but that candidate is not activated by the failed call.
- Original baseline plus unchanged synchronized payload remains the expected
  inventory for both uploads after the verified stage chain.

## Tasks

1. Update helper, bounded provider read, and stage/final guards.
2. Exercise real Wrangler serialization in four synchronization modes; cover
   malformed history, inactive drift, upload interleaving, final chaining and
   worker-only operation through focused owner tests.
3. Update the deployment contract and public-safe Frog fixture-gap record.
4. Run focused tests, Cloudflare typecheck, docs and complexity checks; inspect
   the complete diff, close this plan, commit and push a draft PR.

## Verification

- Focused provider, deployment CLI and secret helper suites: 152 tests passed,
  including real Wrangler dry-run in disabled, empty, partial and full payload modes.
- `pnpm --dir apps/cloudflare typecheck`: passed after the standard local
  `pnpm --dir apps/web prisma:generate` prerequisite in this fresh checkout.
- `pnpm complexity:diff`: passed across three source files, no hotspots above 20.
- `pnpm docs:drift` and `git diff --check`: passed.
- Parent candidate source/test review passed. PR remains draft for the parent's
  final review and required exact-head CI.
Dry-run evidence covers serialization only. Protected deployment remains the
external API acceptance gate, owned by the parent after review and merge.

## Handoff boundary

Internal deploy tooling only: no member-visible UX or changelog item. Parent
owns final candidate review, ReviewGPT, CI completion, merge and deployment.
Completed: 2026-10-07
