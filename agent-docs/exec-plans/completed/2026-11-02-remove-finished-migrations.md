# Remove finished runtime migration and Stripe meter export

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Goal and invariants

Remove finished legacy-to-Postgres runtime migration and retired Stripe meter export. Preserve exact runtime attempt/generation, native target, workspace CAS, provider authorization, usage ledger and allowance accounting.

## Scope and authority

Only this task checkout and branch. No push, PR, production access, stash, other-checkout mutation, or destructive schema migration. Base: `5530387031d90de8bc713e749bd10216e0ffa07f`. Production terminal-state evidence is owner-supplied, not independently queried in this task. No public changelog: internal removal of finished compatibility systems.

## Decisions

- Postgres is the sole runtime authority. Preserve member/owner locking and bounded cleanup; delete campaign locks and selection.
- Keep terminal `cutover: "postgres"` wire responses for current deployed consumers. Remove migration commands and branches after proving no normal-operation caller.
- Schema remains intact; record all leftover objects and contract cleanup order below. Meter columns already have defaults or are nullable.
- Existing retired-mailbox routing owns terminal handling of retired kinds. Preserve current snapshot/resource cleanup obligations.
- Verification remains local as requested; do not push for CI or ReviewGPT.

## Tasks / commit slices

All three slices complete; final documentation is closed through finish-task.

1. Remove Stripe export metadata and normalization throughout producers/readers; preserve ledger and allowance tests.
2. Remove runtime migration implementation, contracts, dispatch branches and obsolete initialization; preserve live owner/resource tests and deploy skew.
3. Update durable docs and index; complete full verification and parent diff review; close through finish-task.

## Verification

- Initial `pnpm install`: pass, lockfile unchanged.
- Initial `pnpm build`: pass.
- Baseline scripts full suite: 880 passed, 27 failed, zero skipped. Final failure headings and privacy-hook causes match exactly.
- All required final lanes completed below. The scripts suite retains only its 27 independently reproduced baseline failures; opt-in/live skips and the unavailable protected Stripe lane are explicit.

## Deploy skew proof

Compared the fixed base source, designated current production by the task, with
this candidate. No live deployment or production data was read. The owner-supplied
terminal fleet state is the precondition. Normal Web-first deployment is safe;
Worker-first and mixed warm runners are also compatible from this exact base.

| Base source | Normal call and retained boundary |
| --- | --- |
| `apps/cloudflare/src/runtime-processing.ts:74,143` → `runtime-owner-client.ts:7,20` | Claim/reconcile/target/completion commands → signed POST `/api/internal/hosted-runtime/owner`. The same owner path and exact attempt/generation remain. |
| `apps/cloudflare/src/runner-container.ts:1036,1120,2331,2414` | Native launch preparation, reconciliation and target retirement → owner endpoint. Native receipts, slot identity and workspace version remain. |
| `apps/cloudflare/src/runner-outbound/write-fence.ts:48` and `runtime-completion.ts:54` | Runner writes require `authorize_effect`; completion reconciles the exact owner. Both commands remain. |
| `apps/cloudflare/src/runtime-resource-client.ts:18,36,54,69` | Snapshot → `/resources`; media → `/media`; orphan → `/orphans`; replica → `/replica-put`, all under `/api/internal/hosted-runtime`. All remain. |
| `apps/cloudflare/src/runtime-user-control.ts:20,50,68,84,86,95,106,109` | Voice/status/consent/deletion use ordinary reconcile/retire/release/deletion-ready commands, all retained. |
| `apps/web/src/lib/hosted-execution/control.ts` → `packages/cloudflare-hosted-control/src/client.ts:522,683` and `routes.ts` | Web OIDC control calls ordinary Worker ensure-processing, user control and resource purge. No migration RPC is sent. |
| `apps/web/src/lib/hosted-execution/runtime-owner-control.ts:19,32` | Removed `resolve_legacy` dispatch and backend reread. Repository-wide base search finds no Worker/runner caller. |
| `apps/web/app/api/internal/hosted-runtime/migration/route.ts:10` | Removed operator-only Web endpoint called the DB migration executor, then optionally signaled Temporal after commit. No base Worker/runner caller exists; the Worker operator route already returns 404 (retained test). |

Base search for `runtime/migration`, `resolve_legacy` and
`HOSTED_RUNTIME_MIGRATION_PATH` across Cloudflare, assistant-runtime,
assistant-engine and hosted-local-harness produced zero matches. Base parsers
require the retained terminal `cutover` field. Eleven additional in-memory
base/new parser assertions passed across owner, snapshot, media and usage;
old usage parsing defaults an absent source to `murph`, new parsing ignores the
old source, and every remaining ledger field is identical.

The migration wrote ordinary `runtime.maintenance-requested`; existing
maintenance still consumes it. `runtime-control.ts` retains
`HOSTED_RETIRED_MAILBOX_KINDS`, and assistant-runtime `mailbox-routing.ts`,
`mailbox-import.ts` and `snapshot-bridge-mailbox.ts` retain terminal
`skip-retired-mailbox-item` routing. Native DO receipt compatibility, imported
snapshot references, orphan cleanup and upload drains remain. No migration
state is newly deserialized, retried or resurrected.

## Schema follow-up

The complete object/column/index/constraint/trigger/function inventory and
ordered follow-up live in `agent-docs/references/hosted-postgres-runtime.md`
under Deferred schema contract cleanup. All schema non-comment lines are
byte-equivalent after whitespace normalization; no migration SQL is added or
changed. No dedicated enums exist. Meter columns use existing nullable/default
semantics; owner creation keeps the existing constant `migrationPhase: postgres`.
Retained member triggers still lock/read the singleton and require it; they do
no enrollment at terminal postgres. Do not delete it before dropping triggers.

A later release must first remove Prisma readers/writers/models and regenerate,
then converge Web/Worker/warm runners. The separately reviewed timestamped
contract SQL drops triggers/functions before their obsolete dependencies. Use
the existing exact-main Vercel alias proof, 300-second default drain (600 max),
repeat proof, advisory transaction lock, 5s lock/30s statement timeouts and
checksum ledger. That switched reader release becomes the rollback floor.
No contract migration is written here.

## Test case audit

Every removed or narrowed case will be listed here with subject and retained proof. Fixture-only meter field removal preserves all other assertions.

### Stripe case audit

- Deleted `assistant usage parsing rejects Vercel meter source payloads` (hosted-execution): removed normalization/validation subject. Old metadata is now ignored.
- Narrowed `assistant usage parsing rejects invalid schema and non-string optional values` (hosted-execution): removed only invalid meter-source assertion; credential, schema and other validation remain.
- Deleted `preserves historical terminal Stripe meter state on an exact replay` (Web PostgreSQL): removed exporter-state subject; concurrent exact replay, changed immutable fields, rollback and ledger tests remain.
- Narrowed `persists sanitized usage metadata without provider debug fields` (Web): removed skipped-export writes and updateMany assertion; all ledger/privacy assertions retained.
- Narrowed `does not read billing refs while recording local usage` (Web): replaced meter-only create assertion with usage/member identity; billing lookup denial retained.
- All other affected billing/engine/runtime/Cloudflare tests retain their cases and non-meter assertions; only retired property fixtures/projections removed. Final per-case diff audit follows.

- Deleted `rejects an existing usage row when the stored Stripe meter source differs` (Web): removed exporter-only immutable field. Token pricing, raw usage, identity and all other immutable checks remain.

- Deleted `rejects unsupported meter source payloads` (Web): removed normalization subject.

- Deleted `blocks claims during draining without consuming a generation` in `apps/web/test/hosted-runtime-owner-postgres.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

- Deleted `returns explicit %s routing without executing provider authorization` in `apps/web/test/hosted-runtime-owner-postgres.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

- Deleted `returns the locked %s routing decision for blocked claims` in `apps/web/test/hosted-runtime-owner-postgres.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

- Deleted `still fences %s with the live cutover gate` in `apps/web/test/hosted-runtime-owner-postgres.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

- Deleted `uses the authorization snapshot for %s routing` in `apps/web/test/hosted-runtime-owner-route.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

- Deleted `resumes exact pages, preserves terminal resources without a member, and activates only a complete frozen inventory` in `apps/web/test/hosted-runtime-migration-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `begins a rolling campaign without changing other members' admission` in `apps/web/test/hosted-runtime-member-migration-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `waits for same-member callbacks while a different member continues through its shared campaign lock` in `apps/web/test/hosted-runtime-member-migration-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `imports exact pages under the member token and activates with one durable wake` in `apps/web/test/hosted-runtime-member-migration-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `migrates all enrolled members, then retires the namespace only from a complete census` in `apps/web/test/hosted-runtime-member-migration-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `enrolls canonical members omitted by the provider and retains deleted identities` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `includes group runtimes and retained resource owners without source data` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `bounds enrollment pages and includes a new creation between pages` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `rolls back a conflicting enrollment page without changing prior source identity` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `retains the selected source if an earlier ID appears before reservation is acknowledged` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `continues the fixed campaign across compatible deployments without replacing its selection or seal` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `automates pending first use without starting the next baseline member after a canary` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `acknowledges repeated exact enrollment without contending with serving campaign readers` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `polls an unfinished selection without waiting for ordinary shared campaign holders` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `keeps new member and late materialization enrollment outside the original seal and legacy admission` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `classifies post-closure discovery as late even before the first seal page` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `keeps the baseline cursor valid when an earlier late source appears during sealing` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `persists first-use intent before a source call, including lost responses and member deletion` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `joins a provider census with an intent that arrived after its page passed` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `requires exact enrollment of an undiscovered older member before creation closes` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `rejects contradictory member/object bindings and cannot hide an earlier intent` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `keeps stale releases away from creation admission while preserving current legacy routing` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `leaves empty-source activation to the explicit durable-wake handoff` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `does not use an empty receipt to activate before legacy creation closes` in `apps/web/test/hosted-runtime-materialization-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `retires the maximum census with fixed database work and no external calls` in `apps/web/test/hosted-runtime-retirement-cardinality-postgres.test.ts`: exercises removed fleet census/import/activation, not ongoing owner or resource authority.

- Deleted `selects Postgres for a new local schema and preserves that decision` in `apps/web/test/hosted-local-runtime-initialization-postgres.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

- Deleted `refuses to reinterpret an existing legacy namespace from empty SQL tables` in `apps/web/test/hosted-local-runtime-initialization-postgres.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

- `assigns new runtime ownership atomically during %s` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `enrolls an old writer's new member without granting either runtime authority` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `does not resurrect or overwrite a deleted runtime identity (%s writer)` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `rolls the route back with failed member creation (%s writer)` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `keeps creation on one side of campaign start (%s writer)` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `retries creation without waiting behind an exclusive campaign transition` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `makes an old writer retry when a campaign transition already holds the lock` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `keeps missing and partially imported owners closed to Postgres while migrated members can claim` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `fences the legacy callback transaction against its member seal without blocking another member` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `serializes default ownership even after the canonical member was deleted` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Migrated to concurrent deleted-member claim rejection and retained-generation proof.

- `excludes unfinished imports before the cleanup batch limit` in `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts`: Migrated to bounded 50-of-60 resource cleanup after account deletion; unfinished-import filtering is removed.

- `retains historical personal and group identities that exist only in encrypted cleanup` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `pages duplicate historical identities without skipping the remaining cleanup payload` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `retains a completed vendor receipt until its runtime identities have independent owners` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `does not hold database locks during decryption and fences concurrent page preparation` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `does not advance on decryption failure or an incompatible caller` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `revalidates the ciphertext and rolls back retained owners with their cursor` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `keeps late cleanup work pending without altering a sealed baseline` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Deleted: subject is removed migration enrollment, legacy admission, campaign lock, or source sealing.

- `preserves ordinary cleanup deletion before a rolling campaign` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Retained ordinary cleanup deletion; removed historical campaign wording.

- `finishes later cleanup for %i identities through ordinary retries after the operator stops` in `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts`: Migrated both 1/201 identity cases to ordinary cleanup completion without enrollment; preserve existing generation and receipt deletion.

- Deleted `keeps an unretired %s database closed without calling a legacy object` in `apps/cloudflare/test/runtime-processing-postgres.test.ts`: subject is the removed migration gate, enrollment, import or exporter. Retained-owner cases in the same suite remain.

### Final per-case narrowing and retained behavior audit

Reviewed every changed/deleted test diff against the fixed base, including shared
fixtures and parameter tables. Renamed tests are retained tests, not deletions.
No live owner, provider, snapshot, accounting or ordinary cleanup suite was
removed wholesale. The four deleted PostgreSQL suites exclusively tested the
retired campaign. The two mixed suites retain their ordinary behavior below.

- `keeps callback identity, deletion, phase and cutover boundaries fail-closed` becomes `keeps callback identity, deletion and phase boundaries fail-closed`: only the legacy/draining loop is removed; stale attempt, generation, cross-member, deleted member, idle/retiring and live owner checks remain.
- `authorizes providers without loading completion, legacy, or upload recovery` becomes `authorizes providers without loading completion or upload recovery`: only the deleted module's mock and backend lookup assertion are removed. Startup laziness for completion and upload recovery remains asserted.
- `classifies $name without crossing a fence` (container runtime completion): removes only `legacy cutover with newer owner` and `draining cutover with completed owner`; all receipt, generation, missing-owner and missing-target cases remain.
- `rejects stale runtime authority (%s) before the canonical store` (old-runtime auth callback): removes only `draining`; attempt, generation, member and retiring variants remain. The coherent SQL mock now mirrors the retained member/phase filter. The full old-runtime callback suite passed.
- `keeps the scheduled retry when ownership is %s` (runner fleet): removes only legacy/draining variants; control-unavailable still preserves scheduled cleanup retry and prevents destruction.
- `records the actual bounded retry reason for %s`: removes only draining/cutover-blocked; missing-owner and uncertain-wake retry reasons remain.
- `omits admission for %s ownership`: removes only legacy, draining and rolling-legacy variants. Idle, retiring, deleted, absent, untargeted, unprepared and retention variants remain; SQL filtering is exercised in the real PostgreSQL suite.
- `tells the Worker why a claim was blocked (%s)`: removes only cutover reason; ordinary admission denial still returns its exact reason and command.
- `reads callback authority in the three lock queries without fetching either row twice` becomes `reads callback authority in the two lock queries without fetching either row twice`: removes the campaign read and tightens the exact bound from three to two; retains member/owner locks and exact bigint values.
- `reads eligible live admission on a read-only connection without changing the owner`: excludes only retired migration fields from the raw projection; still checks the full stored row is unchanged and exactly two reads occur.
- `authorizes both provider identities with one fresh statement and no transaction`: excludes only migration metadata from the expected live row; both identities, exact bigints, one-query and no-transaction checks remain.
- `admits a %s runtime without redundant policy or routing reads`, `uses the locked route for target selection and launch preparation`, `preserves %s admission policy with a bounded game fallback`, and `admits 36 replica receipts atomically and retains unknown uploads through deletion`: tighten query counts for deleted campaign queries; retain every success, refusal, authority, concurrency and cleanup assertion. Replica admission drops from nine to seven statements for all 36 uploads.
- `keeps successful claims and sequential provider work quiet and bounded`: removes only the campaign-query mock; cleanup bounds and diagnostics remain.
- `exports canonical hosted execution contracts without staged payload helpers`: removes only the deleted runtime-migration subpath from the expected export list.
- `can force-reset the local Postgres target before db push when explicitly requested`: removes only the deleted gate-initializer invocation expectation; explicit reset and refusal of implicit accept-data-loss remain.

The following changed bodies only remove exporter fixtures/expected fields; all
other assertions and all cases remain:

- `apps/cloudflare/test/runner-outbound.test.ts` — `fits the final usage envelope: %s`.

- `apps/web/test/hosted-execution-usage-postgres-concurrency.test.ts` — `persists and settles OpenAI priority usage at the documented rate`.

- `apps/web/test/hosted-execution-usage-postgres-concurrency.test.ts` — `converges concurrent first writes on one immutable usage row`.

- `apps/web/test/hosted-execution-usage-postgres-concurrency.test.ts` — `rejects a conflicting concurrent replay and rolls its identity update back`.

- `apps/web/test/hosted-execution-usage-route.test.ts` — `records usage rows and runs allowance accounting during callback`.

- `apps/web/test/hosted-execution-usage-route.test.ts` — `preserves %s through the signed callback`.

- `packages/assistant-engine/test/assistant-service-runtime.test.ts` — `records hosted usage with normalized provider metadata`.

- `packages/assistant-engine/test/assistant-service-runtime.test.ts` — `records each additional usage draft with its own provider, ordinal, and credential source`.

- `packages/assistant-engine/test/assistant-usage-attribution-and-scheduled-log.test.ts` — `normalizes usage attribution payloads and reporting identifiers`.

- `packages/assistant-engine/test/assistant-usage-attribution-and-scheduled-log.test.ts` — `uses a fixed category for a host-bound occurrence (%s)`.

- `packages/hosted-execution/test/assistant-usage.test.ts` — `assistant usage records accept TTS character cost basis`.

- `packages/hosted-execution/test/assistant-usage.test.ts` — `assistant usage parsing preserves a missing totalTokens value`.

Shared fixture-only changes retain every consuming case in:
`game-chat-allowance-postgres`, `hosted-execution-usage-allowance`,
`hosted-ops-usage-reset-postgres`, `hosted-usage-plan-reset-postgres`,
Cloudflare `runner-egress-intercept`, `runner-platform`, `usage-record-port`,
hosted-execution `hosted-runtime-control`, and assistant-runtime workspace
runner/assistant-phase/entrypoint harnesses. Cloudflare `index` and
`index-backpressure` replace only default mocked backend values with terminal
Postgres responses; the retired operator's 404 assertion remains. The local
Postgres E2E removes only obsolete initialization from setup. No assertions in
these cases were removed beyond the retired field.

Historical SQL/schema assertions in `hosted-onboarding-privacy-foundation-migration`
remain because those migrations, columns, indexes and defaults are explicitly
retained. They verify replayable schema history, not executable exporter logic.

## Parent review

- Ledger identity, amounts, pricing, funding attribution and allowance accounting remain unchanged; only meter metadata and its normalization/update are removed.
- Runtime callback and canonical publication still lock the member then exact owner. Provider effects read one coherent member/owner snapshot; cleanup remains bounded and performs external work outside transactions.
- No new dependency, abstraction, configuration knob or retry owner. Runner startup imports are unchanged. Provider input and prompts are untouched for individual and group runtimes; no real-Codex behavior journey is applicable to this metadata deletion.
- Complexity guard passed across 50 source files. Twelve existing hotspots remain; no debt increased. The account-cleanup and usage-service hotspots each fell by two. Their retained provider/retry logic is outside this deletion; splitting it would add unrelated change.
- Schema and historical SQL are unchanged except comments. Lockfile remains unchanged after frozen installation. Privacy inspection found no new identifiers or home paths.
- No changelog: internal retirement with unchanged member-visible runtime and accounting behavior. No remote CI, ReviewGPT, PR or deployment was invoked because this task explicitly forbids pushing/opening PRs and touching production.

## Final local verification results

Counts below are tests, not assertions; zero failures/skips are explicit for
completed test lanes. A dash means the command is a guard/build/typecheck with
no test-count summary. All required code checks ran on the final code; later
edits only rename a test description, remove empty lines and update documentation.

| Command | Result | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
| `pnpm install` (before editing) | PASS; no lock change | — | — | — |
| `pnpm build` (before editing) | PASS | — | — | — |
| `pnpm --dir apps/web prisma:generate` | PASS; real generator, repeated inside Web typecheck | — | — | — |
| `pnpm install --frozen-lockfile` | PASS | — | — | — |
| `pnpm build` | PASS | — | — | — |
| `pnpm verify:workspace-boundaries` | PASS | — | — | — |
| `pnpm verify:workspace-package-cycles` | PASS | — | — | — |
| `pnpm deps:guard` | PASS | — | — | — |
| `pnpm no-js` | PASS | — | — | — |
| `pnpm verify:cli` | PASS | 348 | 0 | 0 |
| `pnpm --dir apps/web typecheck` | PASS | — | — | — |
| `pnpm --dir apps/cloudflare typecheck` | PASS | — | — | — |
| `pnpm --filter @murphai/assistant-engine --filter @murphai/assistant-runtime --filter @murphai/hosted-execution --filter @murphai/hosted-local-harness typecheck` | PASS | — | — | — |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage` | PASS | 13723 | 0 | 1473 |
| `pnpm hosted-billing:ci-guard` | PASS | — | — | — |
| `pnpm --dir packages/hosted-local-harness exec vitest run --config vitest.config.ts --no-coverage test/stripe-billing-live-config.test.ts test/dev-hosted-local/stack.test.ts` | PASS | 102 | 0 | 0 |
| `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-billing-checkout-route.test.ts apps/web/test/hosted-billing-live-support.test.ts apps/web/test/hosted-billing-projection-waiter.test.ts` | PASS | 119 | 0 | 0 |
| `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-hosted-stripe-billing-ci.test.ts` | PASS | 39 | 0 | 0 |
| `scripts/install-playwright-chromium.sh` | UNAVAILABLE: Ubuntu sudo/apt installer | — | — | — |
| `pnpm --dir apps/web exec playwright install chromium` | PASS | — | — | — |
| `env MURPH_E2E_BILLING_BROWSER_SMOKE=1 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-billing-browser-hydration.test.ts` | PASS | 3 | 0 | 0 |
| `pnpm --dir apps/cloudflare test:node` | PASS | 4663 | 0 | 5 |
| `pnpm --dir apps/cloudflare runner:bundle` | PASS | — | — | — |
| `pnpm --dir packages/hosted-execution test:coverage` | PASS | 890 | 0 | 3 |
| `pnpm --dir packages/hosted-local-harness test:coverage` | PASS | 512 | 0 | 1 |
| `env MURPH_VITEST_FILE_PARALLELISM=1 MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-engine test:coverage` | PASS | 5965 | 0 | 713 |
| `env MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-runtime test:coverage` | PASS | 3906 | 0 | 7 |
| `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage` | BASELINE FAILURE (identical) | 880 | 27 | 0 |
| `pnpm docs:drift` | PASS | — | — | — |
| `pnpm complexity:diff` | PASS | — | — | — |
| `pnpm provider-requests:guard` | PASS | — | — | — |
| `pnpm --dir apps/web lint` | PASS | — | — | — |
| `pnpm --dir packages/hosted-local-harness verify:package-boundary` | PASS | 1 | 0 | 0 |
| `pnpm test:scenario-integrity` | PASS | — | — | — |
| `env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_remove_migrations pnpm --dir apps/web exec prisma migrate deploy` | PASS | — | — | — |
| `env DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_remove_migrations MURPH_TEST_POSTGRES_CONCURRENCY=1 MURPH_VITEST_FILE_PARALLELISM=0 MURPH_VITEST_MAX_WORKERS=2 pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-runtime-owner-postgres.test.ts apps/web/test/hosted-runtime-member-cutover-postgres.test.ts apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts apps/web/test/hosted-local-runtime-initialization-postgres.test.ts apps/web/test/hosted-execution-usage-postgres-concurrency.test.ts` | PASS | 93 | 0 | 0 |
| `node .tmp/remove-finished-migrations/skew-proof.mjs` | PASS | — | — | — |

Web full workspace: 849 passing files, 128 skipped files; 13,723 passed and
1,473 skipped tests. PostgreSQL-concurrency suites are gated by the unset
`MURPH_TEST_POSTGRES_CONCURRENCY`; other opt-in E2E/live gates also contribute
to those skips. A separate isolated loopback database replayed the actual
historical Prisma migrations, then ran the five affected owner, retained-resource,
account-cleanup, local-fault-control and usage-concurrency suites with the gate
set and file parallelism off: 93 passed, zero skipped. The task-created database
was dropped normally after clients disconnected; no shared database was changed.

Cloudflare full Node: 215 passing files, one skipped file, 4,643 passed/five
skipped tests; the command's separate container-helper phase adds 20 passed,
zero skipped. CLI: 20 files/348 tests passed. Scenario integrity: 194 scenarios,
12 sample inputs and 28 golden-output directories passed. The extra base/new
wire proof passed 11 assertions, as described above.

The scheduled live Stripe browser matrix requires its protected
`hosted-stripe-billing-sandbox` environment and credentials. It was not run or
fetched locally. Every hermetic step in that workflow passed, with one platform
substitution: the Ubuntu-only installer failed at `sudo`/apt setup on macOS;
`pnpm --dir apps/web exec playwright install chromium` succeeded and the exact
billing browser hydration command passed all three cases. This is no claim of
live Stripe/production verification.

| Coverage package | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| hosted-execution | 84.12% | 78.57% | 86.61% | 84.74% |
| hosted-local-harness | 86.00% | 78.24% | 86.13% | 85.94% |
| assistant-engine | 91.38% | 85.84% | 95.25% | 91.57% |
| assistant-runtime | 91.19% | 86.65% | 94.43% | 91.67% |

All configured thresholds passed unchanged: 80% statements/functions/lines,
70% branches (`config/vitest-coverage.ts`). No guard or threshold was weakened.

Runner bundle: entry 77,854 bytes (76,589 baseline + 12,000 tolerance), static
boot closure 2,017,938 bytes (2,047,343 baseline + 96,000 tolerance), 22 chunks
of 24 maximum, total 12,407,399 bytes. Vault CLI startup closure 19,814 bytes
of 33,200 maximum, entry 805 bytes of 20,000 maximum. Real bundle generators,
startup laziness checks and parity checks passed; no generated artifact was
hand-edited. Remote exact-base CI's relative total-size check is not claimed.

### Failed attempts and disposition

- Scripts baseline and final both have exactly 27 failures (20 dependency-context,
  seven native-context), 880 passes and no skips. Compared all 27 full test
  headings and exception/privacy lines: identical. Fixture `git commit` is
  rejected by the existing noreply privacy hook. Existing Frog entry
  `20261101192002-worktree-fixture-setup` owns this; no hook bypass or fix.
- Early billing-focused proof: one stale skipped-export write expectation failed;
  removed only the retired normalization assertion. Full Web and billing lanes
  subsequently passed.
- Early Cloudflare typecheck: a test fixture still supplied removed cutover phases.
  Retained its unavailable-control retry proof and removed only migration rows.
- Early full Cloudflare Node: 16 failures/4,627 passes/five skips from the callback
  mock expecting the deleted gate query and assuming the member was raw parameter
  zero. The new composed SQL inserts a column expression first. Adapted the mock
  to the real join/phase filter; all 27 focused old-runtime callback cases and
  all 4,643 full Node cases then passed.
- First harness coverage: one failure/511 passes/one skip from an obsolete
  initialization matcher left empty after removal. Removed that one obsolete
  assertion; rerun passed 512 tests with one skip.
- First PostgreSQL run: five failures/88 passes from expected retired projection
  fields and old query counts. Kept full stored-row invariance, compared the live
  projection without migration metadata, and tightened admission/replica counts
  for the removed campaign reads. Final 93/93 passed.
- Web typecheck caught a test destructuring retired properties from the narrowed
  live type. Read the full stored row for that assertion instead; final typecheck
  and PostgreSQL run passed. No type cast was added.
- The temporary skew-check script initially resolved esbuild from the root rather
  than its declared Cloudflare package. Corrected that script's resolution only;
  eleven bidirectional assertions passed. No project dependency was added.

## Remaining objects and limits

Terminal wire fields remain for deployed parsers. Retained schema objects,
member-trigger reads and owner creation's constant remain until the documented
contract migration. Historical Prisma and Wrangler migrations remain immutable.
Live snapshot-format, native receipt/provider-context and unrelated device/vault
compatibility remain because their subjects are still supported; this task only
retires the completed runtime-ownership campaign and Stripe meter export.
There was no remaining Stripe exporter cron/job to remove at the base.

The proof supports the owner-supplied terminal production state and the fixed
base fleet. It does not permit deploying to an unfinished migration environment
or rolling back to one. External CI/ReviewGPT and live production rollout are
unperformed under the task's explicit local-only boundary. Existing scripts
failures and gated live suites remain reported evidence gaps, not passing checks.

## Commit slices and file ledger

The final documentation slice closes this plan with `scripts/finish-task`.
Every commit carries the requested coauthor trailer. The code slices below use
`git show --numstat`; additions/deletions include plan text in the first slice.

### `c2f63722f5ef` — Remove retired Stripe usage meter metadata

30 files; +293 / -286 lines.

| File | Added | Deleted |
| --- | ---: | ---: |
| `agent-docs/exec-plans/active/2026-11-02-remove-finished-migrations.md` | 285 | 0 |
| `apps/cloudflare/test/runner-egress-intercept.test.ts` | 0 | 1 |
| `apps/cloudflare/test/runner-outbound.test.ts` | 1 | 1 |
| `apps/cloudflare/test/runner-platform.test.ts` | 0 | 1 |
| `apps/cloudflare/test/usage-record-port.test.ts` | 1 | 1 |
| `apps/web/src/lib/hosted-execution/usage-lob.ts` | 0 | 1 |
| `apps/web/src/lib/hosted-execution/usage-retell.ts` | 0 | 1 |
| `apps/web/src/lib/hosted-execution/usage.ts` | 0 | 36 |
| `apps/web/src/lib/hosted-onboarding/linq-instant-first-turn.ts` | 0 | 1 |
| `apps/web/test/game-chat-allowance-postgres.test.ts` | 1 | 1 |
| `apps/web/test/hosted-execution-usage-allowance.test.ts` | 0 | 3 |
| `apps/web/test/hosted-execution-usage-postgres-concurrency.test.ts` | 0 | 77 |
| `apps/web/test/hosted-execution-usage-route.test.ts` | 0 | 3 |
| `apps/web/test/hosted-execution-usage.test.ts` | 2 | 70 |
| `apps/web/test/hosted-ops-usage-reset-postgres.test.ts` | 0 | 1 |
| `apps/web/test/hosted-usage-plan-reset-postgres.test.ts` | 0 | 1 |
| `packages/assistant-engine/src/assistant/codex-turn-runner.ts` | 0 | 1 |
| `packages/assistant-engine/src/assistant/service-usage.ts` | 0 | 1 |
| `packages/assistant-engine/src/assistant/usage-attribution.ts` | 0 | 5 |
| `packages/assistant-engine/test/assistant-service-runtime.test.ts` | 0 | 3 |
| `packages/assistant-engine/test/assistant-usage-attribution-and-scheduled-log.test.ts` | 2 | 5 |
| `packages/assistant-runtime/src/hosted-runtime/clinical-enrichment.ts` | 0 | 1 |
| `packages/assistant-runtime/src/hosted-runtime/detached-assistant-ask.ts` | 0 | 1 |
| `packages/assistant-runtime/src/hosted-runtime/meal-name-repair.ts` | 1 | 1 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.harness.ts` | 0 | 5 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.harness.ts` | 0 | 3 |
| `packages/assistant-runtime/test/hosted-runtime-workspace-runner.test.ts` | 0 | 1 |
| `packages/hosted-execution/src/assistant-usage.ts` | 0 | 21 |
| `packages/hosted-execution/test/assistant-usage.test.ts` | 0 | 37 |
| `packages/hosted-execution/test/hosted-runtime-control.test.ts` | 0 | 2 |

### `6ba0ef91df` — Remove finished runtime migration paths

67 files; +155 / -2871 lines.

| File | Added | Deleted |
| --- | ---: | ---: |
| `apps/cloudflare/src/runner-container.ts` | 2 | 2 |
| `apps/cloudflare/src/runner-outbound/runtime-completion.ts` | 2 | 2 |
| `apps/cloudflare/src/runner-outbound/write-fence.ts` | 1 | 1 |
| `apps/cloudflare/src/runtime-processing.ts` | 1 | 2 |
| `apps/cloudflare/src/runtime-resource-client.ts` | 0 | 1 |
| `apps/cloudflare/src/runtime-user-control.ts` | 4 | 6 |
| `apps/cloudflare/src/worker/route-handlers/test-runner.ts` | 2 | 3 |
| `apps/cloudflare/test/container-runtime-completion.test.ts` | 0 | 2 |
| `apps/cloudflare/test/hosted-local-postgres-runtime-e2e.test.ts` | 1 | 2 |
| `apps/cloudflare/test/index-backpressure.test.ts` | 1 | 1 |
| `apps/cloudflare/test/index.test.ts` | 1 | 1 |
| `apps/cloudflare/test/legacy-codex-auth-callback.test.ts` | 5 | 6 |
| `apps/cloudflare/test/runner-fleet-lifecycle.test.ts` | 2 | 4 |
| `apps/cloudflare/test/runtime-processing-postgres.test.ts` | 1 | 15 |
| `apps/web/app/api/internal/hosted-runtime/migration/route.ts` | 0 | 27 |
| `apps/web/app/api/voice/route.ts` | 2 | 2 |
| `apps/web/prisma/schema.prisma` | 5 | 5 |
| `apps/web/scripts/initialize-local-runtime-cutover.sql` | 0 | 11 |
| `apps/web/src/lib/hosted-execution/runtime-cutover.ts` | 0 | 65 |
| `apps/web/src/lib/hosted-execution/runtime-materialization.ts` | 0 | 53 |
| `apps/web/src/lib/hosted-execution/runtime-media.ts` | 0 | 4 |
| `apps/web/src/lib/hosted-execution/runtime-member-creation.ts` | 0 | 21 |
| `apps/web/src/lib/hosted-execution/runtime-member-migration.ts` | 0 | 123 |
| `apps/web/src/lib/hosted-execution/runtime-migration-cleanup.ts` | 0 | 48 |
| `apps/web/src/lib/hosted-execution/runtime-migration-compatibility.ts` | 0 | 11 |
| `apps/web/src/lib/hosted-execution/runtime-migration-enrollment.ts` | 0 | 84 |
| `apps/web/src/lib/hosted-execution/runtime-migration-inventory.ts` | 0 | 137 |
| `apps/web/src/lib/hosted-execution/runtime-migration-resources.ts` | 0 | 99 |
| `apps/web/src/lib/hosted-execution/runtime-migration-unmaterialized.ts` | 0 | 73 |
| `apps/web/src/lib/hosted-execution/runtime-migration.ts` | 0 | 239 |
| `apps/web/src/lib/hosted-execution/runtime-orphans.ts` | 0 | 2 |
| `apps/web/src/lib/hosted-execution/runtime-owner-control.ts` | 4 | 9 |
| `apps/web/src/lib/hosted-execution/runtime-owner-snapshot.ts` | 1 | 1 |
| `apps/web/src/lib/hosted-execution/runtime-owner.ts` | 44 | 67 |
| `apps/web/src/lib/hosted-execution/runtime-replica-puts.ts` | 0 | 2 |
| `apps/web/src/lib/hosted-execution/runtime-resource-cleanup.ts` | 0 | 5 |
| `apps/web/src/lib/hosted-execution/runtime-snapshots.ts` | 1 | 3 |
| `apps/web/src/lib/hosted-execution/runtime-upload-recovery.ts` | 0 | 3 |
| `apps/web/src/lib/hosted-execution/usage.ts` | 0 | 1 |
| `apps/web/src/lib/hosted-onboarding/hosted-member-store.ts` | 0 | 2 |
| `apps/web/src/lib/hosted-privacy/account-deletion-cleanup.ts` | 2 | 56 |
| `apps/web/src/lib/hosted-runtime-log/runaway-alert-monitor.ts` | 1 | 1 |
| `apps/web/src/lib/hosted-workspace/checkpoint-recovery.ts` | 0 | 2 |
| `apps/web/test/hosted-direct-runtime-wake.test.ts` | 3 | 5 |
| `apps/web/test/hosted-local-runtime-initialization-postgres.test.ts` | 0 | 11 |
| `apps/web/test/hosted-runtime-cleanup-enrollment-postgres.test.ts` | 9 | 136 |
| `apps/web/test/hosted-runtime-materialization-postgres.test.ts` | 0 | 355 |
| `apps/web/test/hosted-runtime-member-cutover-postgres.test.ts` | 26 | 225 |
| `apps/web/test/hosted-runtime-member-migration-postgres.test.ts` | 0 | 288 |
| `apps/web/test/hosted-runtime-migration-postgres.test.ts` | 0 | 81 |
| `apps/web/test/hosted-runtime-owner-postgres.test.ts` | 18 | 86 |
| `apps/web/test/hosted-runtime-owner-route.test.ts` | 4 | 22 |
| `apps/web/test/hosted-runtime-resource-cleanup-diagnostics.test.ts` | 1 | 7 |
| `apps/web/test/hosted-runtime-retirement-cardinality-postgres.test.ts` | 0 | 81 |
| `apps/web/test/support/hosted-runtime-migration-testkit.ts` | 0 | 65 |
| `apps/web/test/support/hosted-runtime-owner-testkit.ts` | 1 | 19 |
| `apps/web/test/support/hosted-web-testkit.ts` | 1 | 2 |
| `apps/web/tsconfig.json` | 0 | 3 |
| `packages/hosted-execution/package.json` | 0 | 4 |
| `packages/hosted-execution/src/parsers/orchestration-control.ts` | 1 | 1 |
| `packages/hosted-execution/src/runtime-media.ts` | 2 | 2 |
| `packages/hosted-execution/src/runtime-migration.ts` | 0 | 221 |
| `packages/hosted-execution/src/runtime-owner.ts` | 3 | 36 |
| `packages/hosted-execution/src/runtime-resources.ts` | 2 | 2 |
| `packages/hosted-execution/test/hosted-execution.test.ts` | 0 | 1 |
| `packages/hosted-local-harness/src/dev-hosted-local/stack.ts` | 1 | 9 |
| `packages/hosted-local-harness/test/dev-hosted-local/stack.test.ts` | 0 | 5 |

Final parent review: complete. All 53 deleted test templates have removed subjects; six renamed/migrated templates and all narrowed parameter tables retain their live assertions as enumerated above. The later callback-query title rename is also retained. No unexplained deleted test title remains in the base-to-candidate audit.
Completed: 2026-11-02
