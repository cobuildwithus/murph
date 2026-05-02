## Goal

Land the supplied hosted Privy provider-boundary patch so only routes that need Privy eagerly mount the provider, while the homepage auth panel loads Privy on demand.

## Scope

- `apps/web/app/**` hosted layout/page boundaries touched by the supplied patch
- `apps/web/src/components/hosted-onboarding/**` Privy provider/auth panel boundary components
- `apps/web/test/**` coverage directly coupled to the provider-boundary change

## Constraints

- Preserve existing hosted server auth semantics and do not add `/refresh` or a Murph session cookie.
- Keep Privy app id/client id handling environment-backed and client-safe.
- Preserve unrelated active dirty-tree work and active ledger rows.
- Do not expose local identifiers, secrets, raw auth headers, or env contents in files or commit output.

## Verification

- Focused `apps/web` tests covering layout/auth boundary behavior
- Hosted-web lint/typecheck or truthful app-level verification per repo policy
- Privacy/security readback of the landed diff before commit

## Outcome

- Landed the supplied provider-boundary cut in the hosted web app.
- Focused route/auth tests passed.
- Standalone hosted-web typecheck passed.
- Full diff-aware hosted-web verification reached build/lint but remains blocked by unrelated pre-existing app test failures outside the Privy boundary slice.
