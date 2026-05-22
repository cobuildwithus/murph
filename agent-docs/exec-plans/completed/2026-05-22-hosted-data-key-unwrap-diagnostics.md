# Hosted data-key unwrap diagnostics

## Goal

Add a narrow, metadata-only Cloudflare diagnostic for hosted workspace snapshot
data-key unwrap 404s so production failures can be correlated with DB state
without logging raw user ids, snapshot ids, object keys, root key ids, wrapped
keys, or payloads.

## Scope

- `apps/cloudflare/src/runner-outbound.ts`
- `apps/cloudflare/test/runner-outbound.test.ts`

## Constraints

- Preserve fail-closed restore and crypto behavior.
- Do not expose direct identifiers, secrets, object paths, wrapped keys, or
  payload bodies.
- Use keyed fingerprints only when `HOSTED_LOG_FINGERPRINT_SECRET` is present.

## Verification

- `pnpm --dir apps/cloudflare test:node -- runner-outbound.test.ts` passed.
- `pnpm --dir apps/cloudflare typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-data-key-unwrap-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `pnpm typecheck` passed.
- `git diff --check -- apps/cloudflare/src/runner-outbound.ts apps/cloudflare/test/runner-outbound.test.ts agent-docs/exec-plans/active/2026-05-22-hosted-data-key-unwrap-diagnostics.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.

## Status

- Implemented. The data-key unwrap path now logs metadata-only diagnostics for
  AAD mismatch, wrapped-root mismatch, root-resolution errors, root misses,
  successful unwraps, and unwrap failures. Root-miss diagnostics include keyed
  fingerprints only when `HOSTED_LOG_FINGERPRINT_SECRET` is configured.
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
