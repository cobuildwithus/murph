# Hosted Onboarding Bootstrap-Secret Removal

## Goal

Remove dead hosted-onboarding bootstrap-secret storage from hosted member identity while preserving active hosted ciphertext surfaces such as webhook receipt side effects, hosted share payloads, and contact-privacy indexing.

## Why this plan exists

- The lane changes hosted onboarding runtime plus Prisma storage, which is high-risk and multi-file.
- The broader managed-hosted batch plan is orchestration-only; this lane needs its own plan for audit and scoped commit closure.

## Constraints

- Treat the current repo state as source of truth; preserve unrelated dirty edits.
- Do not touch hosted share or webhook payload encryption beyond keeping their existing codec surface working.
- Keep `HOSTED_CONTACT_PRIVACY_KEY` and blind-index contact privacy behavior intact.
- Drop hosted-member bootstrap-secret storage and only drop `encryptionKeyVersion` usage where it exists solely for that dead storage path.

## Intended changes

1. Remove hosted-member bootstrap-secret generation and writes from `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`.
2. Drop the dead `HostedMember.encryptedBootstrapSecret` and `HostedMember.encryptionKeyVersion` Prisma fields plus add a focused migration.
3. Update tests and durable onboarding docs so no hosted-member bootstrap-secret storage claim remains.

## Verification

- Run focused `apps/web` Vitest coverage for hosted onboarding member identity and any adjacent tests touched by the schema/type cleanup.
- Run `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`, and `pnpm --dir apps/web lint` per the high-risk `apps/web` verification baseline.
- Capture one direct scenario proof from the focused hosted-onboarding lane, using the member-identity test surface as the storage-policy check.
Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
