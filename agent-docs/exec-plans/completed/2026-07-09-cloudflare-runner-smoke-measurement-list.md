# Cloudflare Runner Smoke Measurement List CI Fix

## Goal

Fix the Cloudflare hosted execution deploy gate failure from GitHub Actions run 29034746072 by making the runner Docker smoke's list proofs deterministic after writing measurement and scheduled-log records.

## Constraints

- Keep the change scoped to smoke verification code.
- Do not alter production hosted runtime behavior, vault write semantics, or query projection ownership.
- Do not print or persist vault contents, secrets, local usernames, or home-directory paths.
- Preserve existing CI proof coverage for `vault-cli measurement add`, `measurement list`, `scheduled-log save`, and `scheduled-log list`.

## Plan

1. Confirm the failing job and root-cause path from GitHub Actions logs.
2. Inspect the smoke child, measurement CLI options, and measurement read path.
3. Make the smoke query specific written records using list-safe identifiers.
4. Run the direct failed Docker smoke command plus focused Cloudflare verification.
5. Commit the scoped fix and close this active plan.

## Verification

- `pnpm --dir apps/cloudflare runner:docker:smoke:prepared-base`
- `pnpm --dir apps/cloudflare vitest run test/container-image-contract.test.ts`
- Focused Cloudflare checks covering the smoke source

## State

Active. Smoke write/list proofs now use list-safe identifiers instead of assuming compact list rows include full write payloads.
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
