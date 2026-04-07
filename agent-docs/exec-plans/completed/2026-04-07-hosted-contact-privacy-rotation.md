# Hosted Contact-Privacy Rotation

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Unfreeze hosted contact-privacy blind-index rotation before production by adding a version-aware dual-read lookup seam, deterministic backfill tooling, and a documented cutover playbook.

## Success criteria

- Hosted contact-privacy helpers expose one current write version plus explicit allowed read versions instead of a single frozen constant.
- Hosted onboarding/member lookup paths support dual-read behavior without widening raw-identifier storage.
- Persisted lookup-key identities that are meant to stay stable across routing and activation can be backfilled to the current version deterministically.
- Durable docs describe the long-term rotation model, deployment order, and cutover constraints clearly.
- Focused tests prove versioned derivation, dual-read lookup behavior, and backfill semantics.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/prisma/**`
- `apps/web/scripts/**`
- `apps/web/test/**`
- `packages/assistant-runtime/**`
- `ARCHITECTURE.md`
- `apps/web/README.md`
- `agent-docs/index.md`
- This active plan
- Out of scope:
- Rotating the live production key in this task
- Adding open-ended key-management infrastructure beyond the hosted contact-privacy seam
- Reworking unrelated hosted privacy or billing architecture

## Constraints

- Technical constraints:
- Keep the long-term architecture simple: one current write version and a narrow previous-version read window, not an unbounded compatibility framework.
- Preserve blind-index-only Postgres lookup semantics; raw identifiers stay in the existing encrypted owner-table columns only.
- Cover both DB lookup paths and persisted lookup-key identities used outside direct Prisma queries.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Follow the repo high-risk workflow, including direct scenario proof and a required final review audit.

## Risks and mitigations

1. Risk: Rotation support sprawls into a speculative key-management system.
   Mitigation: keep the abstraction limited to versioned derivation helpers plus explicit current/legacy read candidates.
2. Risk: Only database lookups get dual-read support while persisted dispatch identities or equality checks still break on rotation.
   Mitigation: update direct comparison helpers and persisted activation/backfill seams in the same change.
3. Risk: Backfill tooling rewrites the wrong rows or misses stored lookup-key payloads.
   Mitigation: make the tool deterministic, dry-run friendly, and scoped only to known hosted-member/contact-privacy surfaces.

## Tasks

1. Add the active coordination row and keep this plan updated.
2. Refactor hosted contact-privacy helpers around explicit versions and read candidates.
3. Update hosted-member lookup/query and equality paths to dual-read safely while preserving one canonical write version.
4. Add a deterministic backfill script for stored lookup-key columns and known persisted lookup-key payloads.
5. Update tests and durable docs, then run required verification, direct scenario proof, review audit, and scoped commit.

## Decisions

- The long-term architecture is a small versioned-derivation seam inside hosted contact privacy, not a generic migration framework.
- Current writes always emit the current version only; legacy support exists only in read/backfill paths.
- Rotation readiness must include persisted lookup-key payloads such as hosted activation identities, not only unique-indexed Prisma columns.

## Verification

- Commands to run:
- `pnpm --dir apps/web prisma:generate`
- `pnpm typecheck`
- `pnpm test:coverage`
- `pnpm --dir apps/web lint`
- focused hosted-web Vitest runs for contact-privacy/member-lookup/backfill coverage
- Expected outcomes:
- Hosted onboarding/contact-privacy callers compile against the narrower versioned helper seam, focused tests prove the dual-read/backfill behavior, and durable docs describe the supported rotation process without promising unsupported compatibility.
Completed: 2026-04-07
