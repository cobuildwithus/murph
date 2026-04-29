# Settings Data Export POST

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Land the supplied `/settings` data export MVP patch on the current hosted web state.

## Success criteria

- `/settings` exposes a guarded Data export flow with an acknowledgement checkbox and exact `EXPORT MY DATA` phrase.
- `POST /api/settings/data-export` requires an authenticated hosted member session, same-origin mutation protection, and server-side confirmation.
- The exported JSON attachment is no-store and excludes secrets, lookup keys, token hashes, nonces, invite codes, vault pairing/agent tokens, API key env names, and encrypted vault payload blobs.
- Tests cover confirmation enforcement and the high-value export shape.
- Required security/privacy, frontend, coverage, and finish-review passes run or blockers are documented.

## Scope

- In scope: `apps/web` settings UI, route handler, hosted export service, mailbox payload decode helper, focused tests, and directly related docs if needed.
- Out of scope: account deletion semantics, Cloudflare deletion control, dependency changes, and unrelated Health Commons work.

## Constraints

- Preserve unrelated dirty-tree edits and active rows.
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Do not expose secrets, raw credentials, direct personal identifiers, local usernames, or home-directory paths in committed artifacts.
- Keep the export route POST-only for actual downloads.

## Risks and mitigations

1. Risk: Export can leak secrets or internal lookup material.
   Mitigation: Select fields explicitly, add tests for omitted fields, and run security/privacy review.
2. Risk: Current Settings already has a data privacy export/delete card.
   Mitigation: Merge the export confirmation into the existing Data & privacy surface rather than duplicating unrelated cards.
3. Risk: Repo-wide checks may be red because this checkout has active unrelated lanes.
   Mitigation: Run high-signal scoped checks and record exact blockers if full acceptance is not feasible.

## Tasks

1. Inspect current Settings/privacy export implementation and supplied patch.
2. Port the POST export flow into current files.
3. Add focused coverage for confirmation and export redaction.
4. Run required audits and verification.
5. Close plan and create a scoped commit if safe.

## Verification

- `pnpm exec vitest run apps/web/test/hosted-account-data-service.test.ts apps/web/test/settings-data-export-route.test.ts --config apps/web/vitest.config.ts --no-coverage` passed after final privacy fixes: 2 files, 18 tests.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm --dir apps/web lint` passed.
- `git diff --check` on the touched path set passed.
- `pnpm test:diff -- <touched path set>` reached `apps/web verify`; shell/node/policy/boundary/log guards passed and hosted-web build/lint completed, but the hosted-web test suite failed on unrelated dirty-tree active-lane failures: join invite copy, Settings header copy, biomarker `server-only`, Health Commons experiment/study expectations, and start-experiment unauthenticated-button expectation.
- Required coverage, frontend, security/privacy, and finish-review passes ran. Findings were addressed by redacting mailbox payload internals, omitting workspace object keys/hashes, removing legal-consent delegate coupling from this landing, replacing raw phone-code attempt IDs with a presence flag, redacting mailbox payload `identityId`, and omitting webhook trace rows from the user export until a safe user linkage exists.
Completed: 2026-04-29
