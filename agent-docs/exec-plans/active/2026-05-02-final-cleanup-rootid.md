# Land final cleanup and root-id crypto patch

Status: active
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Land the supplied final hosted cleanup/root-id patch on current `main`.
- Ensure mailbox encryption/decryption and hosted runtime object decrypts resolve
  the exact crypto root by envelope `rootKeyId` instead of relying on current-root
  assumptions.

## Success criteria

- Patch intent is applied without overwriting unrelated active work.
- Sidecar mailbox AAD metadata is centralized and production append no longer
  exposes a pre-encrypted payload append path.
- Web exposes the signed internal root lookup route and Cloudflare uses it for
  root-id-specific decrypts.
- Runtime bundle/artifact/runner-secret decrypt paths accept root key resolvers.
- Device-sync local secret codec import uses the canonical package subpath and
  the old hard-cut guard exception is removed.
- Focused tests, typecheck, required completion audits, and diff checks pass or
  any unrelated blockers are documented precisely.

## Scope

- In scope:
  - `packages/hosted-execution` mailbox AAD/runtime-control helpers and route
    definitions.
  - `apps/web` hosted mailbox encryption/store code, internal crypto root route,
    and focused mailbox tests.
  - `apps/cloudflare` mailbox decrypt, runtime crypto context, R2 decrypt helper
    wiring, runner artifact/secret reads, and focused tests.
  - `packages/assistant-runtime` runtime user crypto resolver threading.
  - `packages/device-syncd` local secret codec export path and hard-cut guard.
  - The stale mailbox migration plan artifact called out by the supplied patch.
- Out of scope:
  - Redesigning hosted crypto/root rotation beyond the supplied root-id lookup
    and resolver plumbing.
  - Changing Prisma schema, deploy topology, or provider ingress behavior unless
    required to make the patch compile.

## Constraints

- Technical constraints:
  - Preserve existing fail-closed crypto behavior and authority boundaries.
  - Do not log plaintext payloads, roots, raw mailbox data, secrets, or direct
    personal identifiers.
  - Treat the uploaded patch as behavioral intent because current source has
    drifted in several Cloudflare files.
- Product/process constraints:
  - Preserve unrelated dirty work and active ledger rows in the checkout.
  - Do not write local account names or home paths into repo files, logs, docs,
    tests, or commit messages.

## Risks and mitigations

1. Risk: Root lookup expands Cloudflare's decrypt authority beyond the intended
   envelope-specific ingress/runtime roots.
   Mitigation: Keep lookup signed, scoped to `{ domain, rootKeyId }`, and review
   through the required security/privacy pass.
2. Risk: Applying a drifted patch overwrites unrelated active work.
   Mitigation: Apply with 3-way support where possible, inspect conflicts, and
   stage only scoped files.
3. Risk: Decrypt-by-root-id plumbing compiles but misses an artifact or secret
   path.
   Mitigation: Run focused mailbox/Cloudflare/runtime tests plus typecheck and
   the required coverage review.

## Tasks

1. Register the task and inspect patch conflicts.
2. Apply clean hunks and reconcile drifted Cloudflare hunks manually.
3. Run focused tests and typecheck/diff checks.
4. Run required security/privacy, coverage-write, and task-finish reviews.
5. Address findings, rerun affected checks, and create a scoped commit.

## Decisions

- Use this execution plan because the patch touches trust boundaries and multiple
  packages/apps.
- Skip the simplify audit because this is a supplied external patch landing, not
  a locally grown refactor.

## Verification

- Commands to run:
- `pnpm typecheck`
- Focused mailbox/runtime/Cloudflare tests selected after inspecting touched
  files.
- `bash scripts/workspace-verify.sh test:diff <touched paths>` if the lane is
  tractable in the dirty checkout.
- `git diff --check`
- Expected outcomes:
- Required checks pass, or unrelated pre-existing blockers are documented with
  exact command and target.
