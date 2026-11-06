# Retire member ChatGPT account linking

Status: completed
Created: 2026-10-19
Updated: 2026-10-19

## Outcome and protected boundaries

Remove member ChatGPT account-linking endpoints, OAuth operations, callback contracts, exclusive storage services, and the now-unused engine account-operation adapter. Member custom inference was already removed on the base branch; this change does not change provider selection or billing. Keep local/operator authentication, managed inference, existing privacy export/deletion obligations, and `/compare`.

## Ownership and data

The retired Web settings API produces runtime-control mailbox records. Runtime executes OAuth and sends callbacks to the Web-owned connection row. Delete those producers and callback machinery. Retain read compatibility for persisted mailbox wakes and checkpoint records, reducing them to local credential cleanup with retry on deletion failure. Retain the legacy database model and existing export/deletion cleanup until a separate operational retirement proves stored rows and old readers drained. No production mutation or schema drop.

Existing ordinary runtime handling of valid saved managed authentication stays unchanged: this removal must not silently switch an existing account's inference provider or costs. Do not add replacement settings, migration UI, or onboarding.

## Deployment and rollback

Deploy the runtime/Worker consumer first, then Web. New consumers drain old requests without OAuth or callback writes. Existing callback producers must be gone before deleting the Web callback route. Legacy mailbox readers remain until retained snapshots and mailbox records are demonstrably drained. No new persisted state or schema rollback floor.

## Product UX

New or existing members cannot start a new ChatGPT link through the retired settings API. Settings already omits this surface. Existing ordinary assistant behavior and account export/deletion remain available. Legacy queued operations clean up local credentials without provider calls; cleanup errors remain retryable. Proof covers those runtime paths and unchanged provider configuration. No new presentation or interaction.

## Tasks

1. Remove Web settings/callback routes and exclusive store/tests.
2. Remove callback contract/parser/Worker integration and adapt focused tests.
3. Reduce old runtime records to cleanup-only handling and verify failures retry.
4. Update current owner documentation, review full diff/privacy, run focused tests and typechecks.
5. Commit a separate draft PR for parent-owned final Claude/ReviewGPT review and CI.

## Verification

Passed:
- Hosted-execution parser/contract suites: 158 tests; package typecheck.
- Cloudflare outbound: 339 tests; platform and bundle suites: 336 tests; app typecheck.
- Web account-data, phone-transfer retirement, and settings suites: 244 tests; full Web typecheck.
- Scenario integrity: 206 scenarios, 12 sample inputs, 29 golden-output directories.
- Complexity diff: passed, complexity debt decreased by seven; no added hotspot.
- Documentation drift and whitespace checks passed.

- Runtime event, persisted-mailbox, and provider-config suites: 254 tests passed; six existing opt-in live-auth tests skipped. Initial runtime ownership/platform suites also passed (212 tests across five suites, including overlapping event/mailbox coverage).
- Six affected engine runtime suites: 275 tests passed; engine and runtime typechecks passed.

Runtime and engine emitted builds passed. Product UX replay: Ready for removal of the hidden API; synthetic cleanup/retry and preserved provider configuration are verified. Deployment and final external review remain parent-owned. Privacy review found no added personal identifiers. Local production rows and credentials were not inspected. Settings has no linking UI before or after; API removal requires no rendered-state change. Parent owns candidate review, Claude consultation, final ReviewGPT and exact-head CI.

## Changelog

Not applicable: removes a hidden legacy API and retired runtime plumbing; settings already has no ChatGPT linking UI. No replacement member-facing feature, billing change, or provider migration ships.
Completed: 2026-10-19
