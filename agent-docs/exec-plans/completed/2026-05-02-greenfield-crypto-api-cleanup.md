# Greenfield crypto API cleanup

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Finish the next safe greenfield hosted-crypto cleanup slice after raw hosted
  email storage was moved off root-derived paths.
- Make root creation visibly provisioning-only, share mailbox payload secure-box
  AAD/scope construction across web and Cloudflare, and quarantine legacy
  hosted user root-key APIs from the active `runtime-state` root surface.

## Success criteria

- Normal hosted crypto read/encrypt/decrypt call paths cannot import a
  generic get-or-create root helper; the remaining exported creation helper is
  named as provisioning-only.
- Web and Cloudflare mailbox payload encryption/decryption call the same
  shared AAD/scope builders from `@murphai/hosted-execution/runtime-control`.
- Browser-session ECDH JWK parsing imports from a neutral JWK module instead
  of the legacy hosted-user-key envelope module.
- The old hosted-user root-key envelope helpers are no longer exported from
  `@murphai/runtime-state` root; legacy tests import them from a clearly named
  legacy module.
- Active hosted storage scopes no longer include old root-key envelope or
  recipient scopes.

## Scope

- In scope:
- `apps/web/src/lib/hosted-crypto/domain-root-store.ts`
- `apps/web/test/hosted-crypto-domain-root-store.test.ts`
- `packages/hosted-execution/src/runtime-control.ts`
- `apps/web/src/lib/hosted-mailbox/encryption.ts`
- `apps/cloudflare/src/hosted-mailbox-encryption.ts`
- `packages/runtime-state/src/{index,hosted-storage,hosted-browser-session-keys,hosted-user-keys}.ts`
- focused runtime-state / hosted-execution / web / Cloudflare tests directly
  coupled to those seams
- Out of scope:
- Raw hosted-email R2 storage paths; already handled in prior scoped commit.
- Broad hosted mailbox store rewrites or transaction work in dirty
  `apps/web/src/lib/hosted-mailbox/store.ts`.
- Recovery/TEE production policy changes beyond documenting residual optional
  behavior if touched docs require it.

## Constraints

- Technical constraints:
- Preserve existing envelope compatibility for legacy tests while removing the
  old helpers from the active root export.
- Do not add dependencies or weaken crypto fail-closed behavior.
- Avoid touching overlapping dirty files unless required by the focused seam.
- Product/process constraints:
- Preserve unrelated active rows and dirty work in the shared checkout.
- Use the required high-risk completion workflow before handoff.

## Risks and mitigations

1. Risk:
   Root helper rename breaks provisioning callers or tests.
   Mitigation: update only direct import/call sites and run focused hosted
   crypto tests plus typecheck.
2. Risk:
   Shared AAD builder drift changes ciphertext AAD shape.
   Mitigation: keep returned object fields and scope string identical, add
   shared builder assertions, and run web/Cloudflare mailbox encryption tests.
3. Risk:
   Legacy root-key quarantine accidentally removes JWK helpers still used by
   browser-session code.
   Mitigation: split JWK parsing into a neutral module first, then update
   imports/tests and typecheck runtime-state.

## Tasks

1. Inspect current imports and confirm target files are not overlapped by
   active dirty work.
2. Rename the exported root creation helper to provisioning-only and update
   direct callers/tests.
3. Add shared mailbox secure-box AAD/scope builders and consume them from web
   and Cloudflare.
4. Split hosted ECDH JWK helpers from legacy hosted-user root-key envelope
   helpers and remove legacy exports from the package root.
5. Remove old root-key storage scopes from the active hosted storage scope
   union/parser/tests.
6. Run focused tests/typechecks, required audit passes, and scoped verifier.

## Decisions

- Use a clearly named legacy module instead of deleting old root-key envelope
  helpers outright, so historical tests and any deliberate future migration
  fixture can still import the old model without exposing it on the active
  package root.
- Defer recovery/TEE mandatory policy changes; that is production policy, not
  a mechanical cleanup, and the current greenfield code already keeps those
  wraps optional.

## Verification

- Passed:
- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm --dir apps/web typecheck`
- `pnpm typecheck`
- Focused runtime-state Vitest for hosted storage, legacy user keys, and
  browser session keys.
- Focused hosted-execution runtime-control Vitest.
- Focused assistant-runtime mailbox payload/import/runner Vitest coverage.
- Focused Cloudflare mailbox encryption and runtime bridge Vitest coverage.
- Scoped `bash scripts/workspace-verify.sh test:diff <touched paths>`.
- `git diff --check -- <touched paths>`.
- Notes:
- Coverage-write made no edits and confirmed the sidecar bridge schema/AAD
  regression is covered by direct payload-resolution and Cloudflare bridge
  tests.
- Web build still emits the existing Turbopack NFT trace warning for
  `next.config.ts`; the verifier completed successfully.
Completed: 2026-05-02
