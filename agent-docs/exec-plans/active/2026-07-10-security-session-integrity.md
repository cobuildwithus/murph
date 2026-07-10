# Bind hosted web sessions to server-held authority

Status: active
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make a writable Postgres row insufficient to forge a hosted browser session or obtain a member's browser-vault replica.
- Preserve the existing first-party app-session flow while binding each accepted token to server-held signing authority outside Postgres.

## Success criteria

- Session issuance produces a strict v2 cookie containing the session id plus a random bearer, while the row stores an HMAC that binds that bearer to immutable authorization claims.
- Resolution rejects unsigned, malformed, non-canonical, wrong-member, wrong-provider, wrong-time, and field-mutated session rows before member or browser-vault data is returned.
- Expiry, revocation, cookie behavior, and per-member session caps continue to work.
- The dedicated signing secret is validated fail-closed and documented for web/local test environments without exposing secret values.
- Focused regressions, full acceptance, required security/privacy and coverage audits, parent final review, PR ReviewGPT, and PR CI all pass.

## Scope

- In scope: `apps/web` hosted app-session issuance/resolution, browser-vault rejection proof, env/config documentation and deterministic tests.
- Out of scope: stateless sessions, a new database column, provider-identity storage migration, step-up authentication redesign, TEE/key-authority work, and unrelated browser UI.

## Constraints

- Technical constraints: resolve the strict v2 token by session id, then verify a canonical HMAC over domain/version, session id, bearer, member id, provider identity, and expiry before trusting the row; compare in constant time and do not reuse an unrelated encryption or contact-lookup secret.
- Product/process constraints: this is a deliberate web hard cut after secret provisioning; existing unsigned sessions log out. Preserve authorized login and browser-vault success paths.

## Risks and mitigations

1. Risk: token/row canonicalization drift could reject valid sessions or permit claim substitution.
   Mitigation: one token codec and one canonical MAC payload owner with mutation regressions for every bound claim.
2. Risk: deploy without the new secret could break login.
   Mitigation: fail startup/issuance clearly, document provisioning and deployment order, and add env contract tests.

## Tasks

1. Reconfirm all app-session issuance/resolution call paths and the browser-vault sink on current `main`.
2. Implement the minimal v2 session-id/bearer codec, claim-bound HMAC storage/verification, authenticated revocation, and strict signing-secret reader in the app-session owner.
3. Add focused forgery, mutation, malformed-token, hard-cut, and preserved-success-path tests.
4. Update the matching architecture/security/env documentation for the new authority and rollout.
5. Run acceptance, security/privacy review, coverage-write, direct scenario proof, parent final review, and resolve findings.
6. Finish the plan, commit, push, open the draft PR, and complete ReviewGPT/CI/mergeability gates.

## Decisions

- Encode only version, session id, and random bearer in the opaque browser token; store an HMAC binding domain/version, session id, bearer, member id, provider identity, and expiry in the existing `tokenHash` column.
- Resolve by primary-key session id, verify the claim-bound HMAC before reading member state, and require the verified row/tag pair for revocation.
- Reject legacy unsigned tokens rather than adding compatibility state or a second resolver.

## Verification

- Commands to run: focused hosted app-session and browser-vault Vitest; `pnpm test:diff` for the touched `apps/web` slice; `pnpm verify:acceptance`; `git diff --check`; required completion audits; PR ReviewGPT and CI.
- Expected outcomes: synthetic or mutated database rows cannot authenticate, valid newly issued sessions retain current behavior, all required gates pass, and no secret or personal identifier appears in the diff.
