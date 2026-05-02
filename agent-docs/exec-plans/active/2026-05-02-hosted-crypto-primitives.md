# Land greenfield hosted crypto primitives

Status: active
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land greenfield hosted crypto primitives from the supplied patch intent: env-backed hosted crypto keyrings, browser-vault data-key envelopes, and runtime crypto context version/TTL handling.

## Success criteria

- Hosted runtime/web crypto can read configured keyrings without weakening current fail-closed behavior.
- Browser-vault replica encryption uses an explicit wrapped data-key envelope on new writes, with route/client validation aligned to current root-id architecture.
- Hosted runtime crypto context carries version/TTL metadata and Cloudflare refreshes stale context instead of holding roots indefinitely.
- Focused crypto/browser-vault tests and required typecheck/diff checks pass or only fail for named unrelated dirty work.

## Scope

- In scope: `runtime-state` crypto helper primitives, hosted-execution browser-vault ref contracts/parsers, Cloudflare runtime crypto context and browser-vault store/session behavior, hosted platform env forwarding, focused tests.
- Out of scope: full DB recipient registry, broad root migration workflow, unrelated Health Commons/content/UI dirty work, unrelated hosted onboarding changes.

## Constraints

- Technical constraints: treat this as greenfield current architecture; preserve privacy/security fail-closed boundaries; avoid exposing root keys or raw private vault data; keep keyring parsing strict.
- Product/process constraints: preserve unrelated worktree edits and active ledger rows; do not land personal identifiers or local paths in generated files.

## Risks and mitigations

1. Risk: crypto fallback paths accidentally disclose state distinctions or keep stale root authority too long.
   Mitigation: use typed unavailable-root handling, explicit TTL checks, and focused route/store tests.
2. Risk: malformed supplied patch diverges from current source.
   Mitigation: inspect patch intent and port manually with focused verification.

## Tasks

1. Inspect malformed patch and map intended hunks to current files.
2. Add runtime-state keyring and data-key envelope primitives.
3. Wire browser-vault ref/store/session/client behavior to data-key envelopes.
4. Add crypto-context version/TTL and Cloudflare refresh checks.
5. Run focused verification and required audits.

## Decisions

- Treat task as greenfield per user instruction; do not preserve legacy behavior unless still required by current code/tests.

## Verification

- Commands to run: focused runtime-state/hosted-execution/Cloudflare/web crypto tests, `pnpm typecheck`, diff-scoped verification.
- Expected outcomes: focused checks pass; any app-wide failures must be unrelated and named with evidence.
