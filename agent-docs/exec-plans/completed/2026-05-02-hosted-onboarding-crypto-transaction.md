# Fix hosted onboarding crypto transaction visibility

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Fix hosted Linq onboarding first-contact failures where private-field encryption
  attempts to create `hosted_user_crypto_envelope` rows before the just-created
  `hosted_member` row is visible outside the current transaction.

## Success criteria

- A new hosted member created inside `ensureHostedMemberForPhoneTx` can encrypt
  identity/routing private fields without a foreign-key failure.
- Hosted member private-field encryption/decryption uses the caller's Prisma
  transaction when one exists.
- Focused hosted-web tests cover the transaction-scoped crypto path.
- Required hosted-web verification and completion reviews are run or any
  unrelated blocker is documented precisely.

## Scope

- In scope:
  - `apps/web` hosted crypto secure-box helpers.
  - Hosted member private-field codecs and stores that encrypt/decrypt inside
    onboarding transactions.
  - Focused tests for transaction propagation and the Linq onboarding path.
- Out of scope:
  - Cloudflare runner or mailbox wake contract changes.
  - Prisma schema/migration changes.
  - Hosted crypto envelope format or key-rotation semantics.

## Constraints

- Technical constraints:
  - Keep the existing lazy domain-root provisioning behavior, but bind it to the
    transaction that owns the member mutation when available.
  - Do not weaken crypto fail-closed checks or persist plaintext private fields.
- Product/process constraints:
  - Preserve overlapping hosted Linq/onboarding active work.
  - Do not expose phone numbers, raw message bodies, secrets, or local paths in
    docs, logs, tests, or handoff.

## Risks and mitigations

1. Risk: Broadening the encryption API accidentally lets unrelated callers skip
   transaction handling.
   Mitigation: Add optional Prisma plumbing only; default behavior remains
   unchanged for non-transaction callers.
2. Risk: Tests pass only because the global Vitest test codec bypasses real
   domain-root provisioning.
   Mitigation: Add a focused test that disables the test codec and exercises
   secure-box encryption with a supplied transaction.

## Tasks

1. Thread optional Prisma clients through hosted secure-box and hosted web
   encryption helpers.
2. Pass the current transaction through hosted member identity/routing/billing
   private-field builders and projectors.
3. Add focused coverage for transaction-scoped secure-box envelope provisioning.
4. Run focused hosted-web tests, typecheck, and required completion reviews.

## Decisions

- Treat this as a transaction propagation bug. The member row is created, but
  encryption used the default Prisma client and therefore could not see the
  uncommitted parent row.
- Private-field encryption for identity/routing/billing now runs sequentially
  within each builder so first-use domain-root provisioning cannot race itself
  inside one transaction.
- Follow-up Privy completion failures were caused by identity private-field
  writes before activation-time `control` root provisioning. The store now owns
  that invariant: hosted member identity writes provision the `control` root in
  the caller transaction before encrypting private identity columns. Suspended
  phone members are rejected before provisioning or identity rewrites.

## Verification

- Commands to run:
  - `pnpm exec vitest run apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --config apps/web/vitest.config.ts --no-coverage`
  - `pnpm --dir apps/web typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched apps/web paths>`
  - `git diff --check`
- Expected outcomes:
  - Focused tests and typecheck pass, or any unrelated red lane is documented.

Latest:

```txt
2026-05-02 follow-up:
pnpm exec vitest run apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-privy-complete-route.test.ts apps/web/test/hosted-onboarding-routes.test.ts --config apps/web/vitest.config.ts --no-coverage
pnpm exec vitest run apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts --config apps/web/vitest.config.ts --no-coverage
pnpm --dir apps/web typecheck
git diff --check -- apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts apps/web/src/lib/hosted-onboarding/member-identity-service.ts apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts
```

All passed. The production follow-up centralizes `control` domain root
provisioning in `hosted-member-identity-store.ts` before private identity
columns are encrypted. Focused real-secure-box coverage proves new Privy member
creation provisions the control root using the caller transaction before writing
encrypted identity fields. Unit tests that use the hosted secure-box test codec
mock only the provisioning side effect explicitly.

```txt
bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts apps/web/src/lib/hosted-onboarding/member-identity-service.ts apps/web/test/hosted-crypto-domain-root-store.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-member-identity-service.test.ts apps/web/test/hosted-onboarding-member-service.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts
```

Reached `apps/web verify`; dependency policy, workspace boundary checks,
stale-name guard, raw-log guard, legal PDF generation, Prisma generation, dev
smoke, lint, and `next build` passed. An intermediate run also exposed a missing
mock in `apps/web/test/hosted-onboarding-member-store.test.ts`; that harness is
now fixed and the focused store/onboarding tests pass. The full app test substep
remains red only on the unrelated pre-existing homepage assertion in
`apps/web/test/page.test.ts`, where dirty landing-page edits changed the hero H1
class from
`text-[clamp(2.5rem,5.2vw,4.5rem)] ... lg:text-balance` to
`text-[clamp(2.25rem,5.2vw,4.5rem)] ... text-balance`.

Prior run:

```txt
pnpm exec vitest run apps/web/test/hosted-crypto-domain-root-store.test.ts --config apps/web/vitest.config.ts --no-coverage
pnpm exec vitest run apps/web/test/hosted-onboarding-linq-dispatch.test.ts --config apps/web/vitest.config.ts --no-coverage
pnpm --dir apps/web typecheck
git diff --check
```

All passed.

```txt
bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-crypto/secure-box.ts apps/web/src/lib/hosted-web/encryption.ts apps/web/src/lib/hosted-mailbox/encryption.ts apps/web/src/lib/hosted-mailbox/store.ts apps/web/src/lib/hosted-onboarding/member-private-codecs.ts apps/web/src/lib/hosted-onboarding/hosted-member-identity-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-state.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-linq.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-telegram.ts apps/web/src/lib/hosted-onboarding/hosted-member-billing-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-store.ts apps/web/src/lib/hosted-onboarding/invite-service.ts apps/web/src/lib/hosted-onboarding/billing-service.ts apps/web/test/hosted-crypto-domain-root-store.test.ts
```

Reached `apps/web verify`; dependency, boundary, stale-name, raw-log guard,
hosted-web lint, dev smoke, and `next build` passed. The hosted-web test
substep remains red on unrelated existing expectations in migration snapshots,
Health Commons generated copy/projection tests, device-sync random-id mocks, and
a Junction connect-target fixture.
Completed: 2026-05-02
