# Encrypt and minimize persisted private content

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Stop writing hosted phone-call briefs and results as plaintext Postgres content, while preserving call creation, webhook consultation, final analysis, account export, and deletion.
- Establish a durable, mechanically checked invariant that new persisted private-content fields must be classified as encrypted content, keyed lookup, hashed capability, approved operational metadata, or explicit legacy debt.

## Success criteria

- Newly created or updated phone-call rows persist sensitive brief/result content only through the existing control-domain secure-box primitive with row/field-bound AAD.
- Existing plaintext rows remain readable during migration, and a bounded dry-run-default backfill can encrypt and scrub them without logging content.
- The schema migration is additive/backward compatible for the currently deployed app, with an explicit rollback floor once encrypted-only rows exist.
- A repository guard fails when a covered private-content field lacks an allowed storage classification, and the baseline invariant is documented without pretending all identifiers/status metadata are ciphertext.
- Marker tests prove representative phone/user-text content does not remain in logical stored rows and still round-trips correctly.
- Full acceptance, required security/privacy and coverage audits, parent final review, PR ReviewGPT, and PR CI pass.

## Scope

- In scope: `HostedPhoneCall` schema/migration, phone-call service/result/consult readers and writers, secure-box helper reuse, a bounded backfill/scrub command, account export/deletion coverage, privacy contract guard, and matching architecture/security/privacy docs.
- Out of scope: computer-use field encryption, group join-code hashing, hosted session provider-identity migration, broad database redesign, TEE/key authority, and deletion of legacy columns before production backfill is proven.

## Constraints

- Technical constraints: reuse the control-domain secure box; bind ciphertext to exact member, table, row, field, and scope; no plaintext logging; no new crypto dependency or key owner.
- Product/process constraints: preserve the authorized phone-call flow; use expand/read-fallback/backfill/scrub with a concrete legacy-column removal condition; keep the privacy guard evidence-based and narrowly allowlist current debt.

## Risks and mitigations

1. Risk: deploy skew or rollback could expose unreadable encrypted-only rows to old web code.
   Mitigation: additive nullable columns, encrypted-first/legacy-fallback readers, explicit deploy order and rollback floor, and no destructive contract migration in this PR.
2. Risk: backfill could corrupt or leak user content.
   Mitigation: dry-run by default, bounded batches, idempotent row-bound encryption, compare-and-set updates, metadata-only reporting, and focused fixture proof.
3. Risk: a broad privacy guard becomes an unmaintainable false-confidence catalog.
   Mitigation: classify only concrete private-content surfaces, fail on unclassified additions to covered models/patterns, and keep legacy debt explicit with owners/removal conditions.

## Tasks

1. Reconfirm current phone-call persistence/read/export/delete paths and secure-box ownership.
2. Add the backward-compatible encrypted fields and migration, then implement encrypted-only new writes with legacy read fallback.
3. Add the bounded dry-run-default backfill/scrub path and direct marker/round-trip/idempotency tests.
4. Add the persisted-private-content invariant and mechanical classification guard with explicit legacy debt.
5. Update architecture/security/account-data docs and prove deployment/rollback behavior.
6. Run acceptance, security/privacy review, coverage-write, direct scenario proof, parent final review, and resolve findings.
7. Finish the plan, commit, push, open the draft PR, and complete ReviewGPT/CI/mergeability gates.

## Decisions

- Use the existing control-domain secure box rather than adding a phone-call key or encryption service.
- New code will not dual-write sensitive plaintext; old columns become nullable and remain read-only legacy fallback until the backfill is verified and a later contract migration removes them.
- The privacy contract classifies sensitive content, lookup values, capabilities, and approved metadata explicitly; it does not assert that every database string must be encrypted.

## Verification

- Commands to run: focused phone-call, secure-box, migration, account-data, backfill, and privacy-contract Vitest; `pnpm test:diff` for touched `apps/web`/docs/tooling paths; `pnpm verify:acceptance`; dry-run fixture scenario; `git diff --check`; required audits; PR ReviewGPT and CI.
- Expected outcomes: sensitive markers occur only inside authenticated ciphertext during new writes and are removed by backfill, legacy rows still read, the guard rejects an unclassified fixture field, and all required gates pass without secret or identifier leakage.
Completed: 2026-07-11
