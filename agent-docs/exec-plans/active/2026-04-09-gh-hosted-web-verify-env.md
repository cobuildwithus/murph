# Restore GitHub hosted-web verification env plumbing

Status: active
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Make the GitHub release/support workflows provide the minimal hosted-web environment needed for truthful `apps/web verify` execution so `pnpm release:check` can pass in CI without weakening the hosted-web boot contract.

## Success criteria

- `host-support.yml` and `release.yml` provide the same minimal non-secret hosted-web verification env.
- The CI fix keeps `apps/web verify` enabled instead of bypassing or narrowing it.
- Local verification proves the same `pnpm release:check` path that currently fails in GitHub.

## Scope

- In scope:
  - GitHub workflow env plumbing for the hosted-web verification path.
  - Narrow local verification of `apps/web verify` / `pnpm release:check` with the same placeholder env contract.
- Out of scope:
  - Broad hosted-web runtime/env refactors.
  - Vercel production env changes.
  - Release tagging, deploy triggering, or unrelated CI failures outside this hosted-web env gap.

## Constraints

- Preserve unrelated dirty worktree edits.
- Keep `apps/web verify` in GitHub rather than replacing it with a weaker check.
- Use deterministic non-secret placeholder values only for env required to boot verification paths.

## Risks and mitigations

1. Risk:
   The first missing env in CI may not be the only one required by `app/layout.tsx`.
   Mitigation:
   Trace the render path first and inject the minimal complete set instead of patching one missing key at a time.

2. Risk:
   Adding placeholder env could mask a real secret requirement.
   Mitigation:
   Limit placeholders to non-runtime verification boot requirements and keep production deploy env on the existing Vercel/GitHub environment sources.

## Tasks

1. Confirm the hosted-web boot path and the minimal env set required by GitHub verification.
2. Patch the GitHub workflows that run `pnpm release:check`.
3. Run local proof for the same release-check lane with the placeholder env.
4. Run workflow review and land the scoped commit.

## Decisions

- Keep the fix in workflow env plumbing rather than weakening hosted-web runtime requirements.
- Use a deterministic one-key contact-privacy keyring plus placeholder Privy verification key for CI-only verification boot.
- Use a deterministic placeholder Privy app id in GitHub workflows so CI keeps a valid client identifier without adding an out-of-band repo-variable dependency.

## Verification

- Commands to run:
  - `HOSTED_CONTACT_PRIVACY_KEYS=... NEXT_PUBLIC_PRIVY_APP_ID=... PRIVY_VERIFICATION_KEY=... pnpm --dir apps/web verify`
  - `HOSTED_CONTACT_PRIVACY_KEYS=... NEXT_PUBLIC_PRIVY_APP_ID=... PRIVY_VERIFICATION_KEY=... pnpm release:check`
- Expected outcomes:
  - Both commands pass on the final tree.
