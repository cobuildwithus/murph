# Greenfield Compatibility Cleanup

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Remove or simplify repo compatibility and rollout-era baggage that assumes preexisting deployed data, while preserving strict current-schema seams and a future hosted contact-privacy rotation seam.

## Success criteria

- Hosted contact-privacy keeps a future rotation seam without presenting launch-time dual-read/backfill/cutover posture in the main product path.
- Hosted email no longer rewrites legacy verified-sender route records on sync.
- Canonical event/query contracts stop documenting or normalizing compatibility projections that are no longer needed for a greenfield launch.
- Hosted Prisma docs and migration history present one clean pre-launch baseline story instead of shipping rollout cleanup history.
- Vault-upgrade docs and CLI copy describe the current fail-closed behavior accurately.
- Repo docs stop narrating the current system as an active cutover/scaffold where that language is no longer durable truth.

## Scope

- In scope:
- `apps/web` hosted contact-privacy posture, Prisma migration tree/docs, and related tests/docs
- `apps/cloudflare` hosted email verified-sender compatibility behavior and related tests/docs
- `packages/core`, `packages/contracts`, and `packages/query` canonical relation/file compatibility projections plus related docs/tests
- vault-upgrade wording in runtime/docs/CLI surfaces
- repo docs that still foreground rollout-only cutover/scaffold language for these areas
- Out of scope:
- RevNet removal or isolation
- unrelated runtime version seams that are already strict current-only parsers

## Constraints

- Preserve the future contact-privacy rotation seam, but remove active prelaunch rotation-campaign posture where it is not required.
- Treat this as a greenfield hard cut wherever the repo currently carries deploy-history baggage with no live data to preserve.
- Preserve unrelated worktree state and port changes onto the current tree rather than assuming older review snapshots still match.
- Keep docs aligned with runtime behavior in the same change.

## Risks and mitigations

1. Risk: Removing compatibility readers or migration bridges could break still-used fixtures or internal tools.
   Mitigation: Update the owning tests and docs in the same change, and keep fail-closed behavior where old shapes are intentionally unsupported.
2. Risk: Rewriting the hosted Prisma baseline story could leave migrations, tests, and docs out of sync.
   Mitigation: change the migration tree and hosted docs together, then run focused hosted verification plus repo typecheck.
3. Risk: Contact-privacy cleanup could accidentally remove the intended future rotation seam.
   Mitigation: preserve explicit versioned keyring boundaries where they support future rotation, while removing launch-time runbooks, backfill tooling, and steady-state README/index prominence.

## Tasks

1. Simplify hosted contact-privacy posture to keep a future seam without launch-time rotation/backfill machinery.
2. Remove the hosted email verified-sender legacy rewrite bridge and make the store strictly current-schema.
3. Remove canonical event/query compatibility projections and tolerant legacy normalization that are no longer needed for launch.
4. Collapse hosted Prisma rollout-history migrations/docs into a clean baseline story where still pre-launch.
5. Rewrite vault-upgrade wording to match the current fail-closed implementation.
6. Clean remaining rollout/cutover/scaffold documentation in the touched surfaces.
7. Run required verification, then the required final audit pass, and land a scoped commit.

## Decisions

- Keep strict version seams and fail-closed parsers.
- Keep a future hosted contact-privacy rotation seam, but do not keep active rotation-campaign posture as part of the current launch story.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- Expected outcomes:
- touched package/app surfaces pass their required verification and the repo/doc story matches a greenfield launch baseline.
Completed: 2026-04-09
