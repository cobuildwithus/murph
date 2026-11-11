# Architecture, bug and test audit

Date: 2026-11-11
Status: six reviewed PRs; accepted findings resolved; final CI and release in progress
Audit base: main `d519978569e3443aabe4dfb17690d3cc30883649`
Integrated main: `978a415b771cff9810d2e1b7d5fd2adce0126d24`
Task: `codex/radical-simplicity`

## Scope and decisions

The audit revalidated the repository after fetching main, rather than applying
findings from the older checkout. Implementation uses one isolated worktree with
separate file ownership. Eleven domain agents covered production code; four
read-only CLI reviewers mapped test redundancy; twenty-two additional CLI
workers were assigned independent test-removal scopes. Eight later read-only
searches examined untouched test groups and are complete; no further worker
launches are planned for this checkpoint. Counts in the final
change summary must include replacement fixtures and new files.

The product decisions are explicit:

- Editing and voting during a live game remain supported.
- Remove optional categorical oxygen screening; keep numerical summaries.
- Remove mandatory percentage coverage floors; retain reports and meaningful
  behavioral tests.
- Prefer deletion and direct composition. Preserve a layer only when current
  behavior, a concrete failure, a security boundary or a measured constraint
  requires it.

The requested 500,000-line test reduction is a target, not evidence that any
particular test is unnecessary. No deletion is justified solely by file size,
its age, a `coverage` filename, or an estimate from a reviewer. The execution plan
records measured totals and remaining verification.

## Initial checkpoint measured result

The implemented diff against integrated main `978a415b771c` removes **62,003 net
test lines**: 85,830 deleted and 23,827 added, including replacement fixtures.
The full change removes **approximately 68,400 net lines** across 451 files. This is approximately
12.4% of the requested 500,000-test-line reduction; that target is **not met**.
Previously shipped main changes and unimplemented estimates are excluded.

Test accounting includes paths with a `test`, `tests`, `__tests__`, `e2e` or
`fixtures` directory and filenames containing `.test.` or `.spec.`. Other files
are counted separately; moving or reformatting code does not count as removal.
The source complexity gate passes with a total reduction of **1,029** and no
increased gated complexity debt. This metric supports the diff review; it does
not prove correctness or maintainability by itself.

All implementation workers and final searches have finished. The cleanup and
main reconciliation were committed locally, then split into six published PRs. This checkpoint includes focused
behavioral proof and the full workspace typecheck, but is not a claim that the
entire repository is bug-free or the branch is ready to deploy.

## Correctness findings and repairs

### Files, canonical data and locks

| Finding | Cause and consequence | Repair and retained proof |
| --- | --- | --- |
| Stale lock cleanup could wait forever | A contender encountering a cleanup claim could retry inside the generic acquisition path indefinitely, outside the caller's timeout/cancellation loop. | Return contention to the existing caller policy. The canonical caller now retries both active and stale contention within its existing deadline. Real lock tests cover a cleanup claim being released. No claim of automatic orphan recovery. |
| Food, recipe and provider edits could lose disjoint changes | A usecase read and patched an old record before acquiring the canonical write lock. Serializing only the final write did not serialize read-modify-write. | Hold the existing canonical lock across read, patch and persistence. Real filesystem tests cover concurrent fields and rename/edit. Owners: `packages/vault-usecases/src/usecases/{food,recipe,provider-event}.ts`. |
| Food removal could leave schedules active or make retries impossible | Deleting the food before archival made an archival failure hard to retry. Reordering alone still allowed concurrent schedule reactivation between writes. | Hold the existing schedule-registry lock, then the canonical lock, across lookup, archival and deletion. Delete by the resolved stable ID. Interruption can leave an archived schedule and existing food; retry remains safe. No cross-file transaction was invented. |
| Scheduled meals lost the saved food name | Generated meal payloads always used the generic fallback. | Use a valid saved-food title as the meal name; keep the existing fallback and note for incompatible historical titles. Owner: `packages/core/src/scheduled-logs.ts`. |
| Damaged promotion metadata could look like absence | Broad error handling hid unreadable or malformed canonical manifests, allowing a second identity to be created. | Treat only absence as absence; propagate corruption/I/O failures. Retain real manifest/replay tests in inbox-services. |
| Canonical cron corruption could silently reset behavior | Readers quarantined or ignored bad state and continued with empty defaults. An exported history lookup also caught all resolution errors and treated a failed alias lookup as a raw ID. | Missing files retain their documented empty behavior. Existing malformed, unsupported and unreadable stores fail visibly and preserve bytes. History fallback catches only true job-not-found. Repeated-read and I/O regressions cover both stores and exported history. |

### Hosted execution, billing and privacy

| Finding | Cause and consequence | Repair and retained proof |
| --- | --- | --- |
| Account cleanup could repeatedly redo a completed prefix without converging | Deadline-bounded Cloudflare/Stripe work restarted from the full identifier list on every attempt. Only Temporal had durable progress. | Persist progress by shrinking existing encrypted lists. Runtime IDs shrink only after Temporal and runtime-log cleanup complete, because those consumers share the original list. Ciphertext, flags and completed cursor update under the same lease. No new schema or payload field. Maximum-cardinality, lease-loss, ambiguous failure and near-limit legacy payload cases remain. |
| Stripe completion could precede its activation handoff | A receipt and an additional workflow reconstruction path had separate notions of completion and retry. | Receipt completion waits for required activation acknowledgement. Acknowledge previously retained pointers before replay can replace them, including when a still-active Starter member has left the Family. Use the existing receipt claim/backoff/poison owner. Retain signed webhook-to-PostgreSQL entitlement/replay proofs. |
| Removing all Stripe workflow execution would exceed the request lifetime | Existing Stripe/member mutation budgets can exceed the minute cron route's three-minute lifetime. A request-bound replacement was therefore insufficient. | Retain a small pointer-only workflow step for execution time. It runs one receipt attempt with zero independent workflow retries. The bounded cron dispatches due receipt IDs. Lost dispatch and duplicate execution remain recoverable through the receipt. Delete the large reconstruction wrapper and second retry policy. |
| Purchase locking depended on a redirect URL | Presentation-derived URL ordering could disagree with canonical beneficiary/container identity across checkout paths. | Derive ordering from the existing canonical container identity. Retain concurrency and account-deletion proofs. |
| X search could exceed the accepted-turn budget | A reconsidered model request received a fresh counter inside one accepted assistant turn. | Create the counter at the accepted-turn owner and thread it through recovery/provider execution. Three native tool RPCs consume the budget; the fourth reconsideration RPC fails before provider fetch. A focused real-model journey proves the truthful exhausted-budget response. |
| Unused raw model stdout grew with the process stream | Raw output duplicated information already parsed into protocol events. | Remove accumulation, the unused result field and forwarding. Keep parsed events required for billing, child accounting, final responses and framing errors. Command output and actual diagnostic evidence remain separate. |

### User-visible behavior and ingestion

| Finding | Cause and consequence | Repair and retained proof |
| --- | --- | --- |
| A connection request could be cancelled by an unrelated source refresh | Request lifetime was coupled to a changing server projection. | Preserve one accepted request across source refresh. Invalidate it on logout, re-login, unmount or member replacement; server component identity is keyed by the existing member ID. Rendered tests prove one redirect and no cross-member completion. |
| Preferences could show stale data or overwrite a fresher sibling setting | Local defaults outlived canonical props; late full responses overwrote unrelated fields after refresh. | Refresh the canonical snapshot, preserve open drafts, and merge only server-acknowledged fields actually submitted. Tone/voice and individual personality dials have deferred-save race proofs. |
| A stalled preference save could freeze the editor indefinitely | The UI awaited an unbounded request. | Use the existing bounded save path; retain the draft and recover editing after timeout. The tests exercise pending, timeout, failure and successful acknowledgement. |
| Delayed live-game activation lost reminder inheritance | Recovery selected only recently started games even though preference carry-over remains required later. | Select bounded batches of started live games without the game-age cutoff. The optional initial help offer still expires after 24 hours. Explicit new preferences always win. |
| Post replay could report success for another game | Replay checked the author but omitted the requested game identity. | Require entry, actor and game to agree. Retain composed database replay tests. |
| New clinical generations inherited obsolete query fingerprints | New-run definitions copied prior query fingerprints, even when current requirements changed. | Build successor fingerprints from current query definitions. Preserve frozen identity for already-started legacy runs. Generation and retrieval tests cover both paths. |
| Raw email processing could corrupt attachments | UTF-8 decoding and newline normalization occurred before MIME transfer decoding. | Preserve raw bytes until the part's encoding/charset is known. Retain binary CRLF and encoded body regressions; delimiter padding accepts only space/tab so nonbreaking-space payload bytes cannot become boundaries. |
| Multipart email could omit later body sections | Collection selected only the first text/HTML part even for mixed content. | Concatenate mixed body sections; retain alternative-content selection. |
| Sender-controlled Date was treated as receipt time | The parsed Date header supplied both occurrence and receipt. | Date remains occurrence evidence; trusted ingress wake time supplies receipt time. Normalizer and actual runtime handoff tests cover the seam. |
| A large sample series could exceed the JavaScript argument limit | `Math.min`/`Math.max` spread the entire reading array into arguments. | Compute extrema with iteration. A 200,000-reading regression exercises the real summary. |
| Metric lookup bypassed the selected source policy | A permissive fallback could return a series outside the requested selection policy. | Remove the implicit fallback; explicit historical anchors select latest-observed deliberately, while unanchored latest-lab queries remain strict. Retain source-policy and full anchored experiment regressions. |
| Tab-separated imports were rejected | Delimiter normalization treated the tab as empty whitespace. | Preserve the exact one-character delimiter. |
| CLI sample queries loaded unrelated shards and all records | Full reads and flattening preceded filtering, sorting and limiting. | Read sequentially, prune unrelated streams, prune UTC months only for timestamp summaries, and retain bounded batches for limited lists. Lists preserve explicit dayKey semantics independently of recordedAt. Immutable/content-derived IDs permit early exact lookup. |

The CLI list implementation was also measured after the first streaming rewrite.
Sorting after every row was unnecessary work. Batched truncation at twice the
requested limit kept bounded retention and returned the identical selection;
the isolated 50,000-row, limit-200 selection measurement changed from 83 ms to
1 ms. This is an algorithm measurement, not a claimed end-to-end latency gain.

## Architecture removed or collapsed

| Removed machinery | Why it was unnecessary | Current owner or replacement |
| --- | --- | --- |
| Full/delta legacy runtime snapshot producers, manifests and restore wrappers | Production already requires the current v2 archive path; old producer helpers had no live source consumers. | Existing archive planner and generic inline codec used by smoke/fixtures. Preserve archive admission, privacy and artifact-integrity checks. |
| Generic snapshot externalization/preservation and checkpoint-debug plumbing | These producer features had no remaining production caller after v1 retirement. | Direct v2 archive planning and aggregation. |
| Process-global environment/cwd mutation queue | Current execution already passes explicit process environment and working directory. | Existing process invocation inputs. |
| Signed AI allowance-decision protocol and unused nudge request parser | No live producer/consumer remained. | Active allowance/pricing, mailbox and ingress validation stay. |
| RunnerStoreCache and RunnerSecretsService wrappers | Request-scoped assembly only needed one loader; serialization was unused after inlining. | One request-scoped store loader; unused serialized lock deleted. |
| General bundle-transition GC class | Both production callers only delete a retired reference. | One legacy-bundle deletion function. |
| Telegram send/rollback fields on a download-only path | They described effects that this path no longer performs. | Existing download contract; email uncertainty/retry fields remain because they are live. |
| Synchronous query collectors and filesystem health-export readers | Live consumers use asynchronous collection and the supplied canonical read model. | Two explicit asynchronous collection modes; health export derives from its read model. |
| Collector Markdown cache | Its consumers were removed with obsolete disk export readers. | No replacement cache. |
| Handwritten food/recipe/provider runtime interfaces | They duplicated exported core signatures and drifted. | Types derive from the real lazy-loaded core API. |
| Single-provider dispatcher/registration and capability projection | Only concrete Junction assembly remained; generic maps and duplicated capabilities added no choice. | Direct Junction composition. Historical payload readers remain. |
| Current OAuth diagnostic producers and projection fallback | Local OAuth flow was already retired on main. | Keep only legacy wire readers required by older in-flight envelopes. |
| Empty CSV preset registry, CLI flags and parser scoring taxonomy | No preset existed; provider priority was a fixed order disguised as weights. | Explicit provider order and supported CSV options. Historical batch provenance remains readable. |
| Categorical oxygen screening | Product explicitly no longer requires it. | Numerical sample summaries and selected thresholds. |
| Ordinary invalid-tool union variants | Most variants differed only by an error code. | One ordinary invalid result, preserving wire codes; specialized authority/policy variants remain. |
| Four async orchestration forwarding wrappers | They only passed their arguments and return values unchanged. | Direct exports. |
| Pre-acceptance game terms/word history | Waiting invitations need the latest proposal, not every draft. | Latest values with monotonically increasing version. Live played-day history remains. |
| Duplicate game activation call | The join owner already performs the activation work. | One activation call at the join owner. |
| Retired picker step and unused UI wrappers/icons | No current product path used them. | Current components and one-step choice interaction. |
| Percentage coverage floors | They rewarded branch/source-shape scaffolding rather than proving product behavior. | Coverage reports and targeted behavioral/composed checks. |
| Documentation-only CI classifier and deployment-prose validator | Separate policy paths and source-text tests added maintenance without executing the deployed invariant. | Existing exact-head aggregate/security gates; human deployment review remains. |
| Hard-coded typecheck workspace inventory | It could omit declared packages as the workspace changed. | Discover declared workspace typecheck scripts from manifests. |

## Test deletion policy and retained evidence

The strongest removals execute less duplicated machinery, rather than merely
asserting fewer things:

1. Delete tests that exercise their own fake implementation. The greenfield
   runtime ports suite did not call production. A substantial latency-store
   suite reimplemented production SQL in JavaScript; its overlapping cases now
   rely on real PostgreSQL concurrency tests. Unique lifecycle/deadline cases
   were transferred to that actual database owner before deleting the fake.
2. Delete source-spelling, historical migration filename, prose-order, CSS-slot
   and copy-only assertions where they prove no current behavior. Preserve
   encryption, data-preservation, expand/contract and executable migration proof.
3. Remove mocked CRUD/forwarding success duplicates where real CLI or filesystem
   journeys already perform the same operation and read back its effects.
4. Consolidate repeated fixture setup through existing narrow builders, keeping
   each scenario name, literal expected result, forbidden effect and distinct
   failure/authority transition. Do not build a general scenario language.
5. Keep corruption, refusal, partial failure and ambiguous-provider cases unless
   the retained test actually reaches the same owner with the same authority and
   failure timing. A successful integration test is not blanket replacement for
   every failure case beneath it.

Representative retained-proof mappings:

| Deleted/reduced group | Retained behavioral proof |
| --- | --- |
| Legacy runtime snapshot tests | Current archive planner, interrupted enumeration, memory/rollout retention, traversal, permissions and artifact-integrity-before-write |
| Fake platform ports, source-body guards | Real workspace entrypoint/platform consumers and explicit env/cwd execution |
| Mock activation completion and duplicate idle timing | Persisted activation queue/checkpoint and background checkpoint deadline tests |
| Query helper/coverage replicas | Public query/export/timeline, real event mutation and registry tests; unique assessment/immunization/habitat and source-alias cases retained explicitly |
| Mocked bank mutation/choreography | Real concurrent edit, rename/edit, archive failure, schedule reactivation and persisted-link clearing |
| CLI document/meal/intervention forwarding | Actual import/show/filter/manifest/edit/delete journeys, immutable artifacts and explicit flag precedence |
| Usage grant/FIFO/reset mock success cases | Real grant races, coupled FIFO projections, fragment overflow rollback, both reset/usage lock orderings and Stripe entitlement replay |
| Latency SQL interpreter | Actual overlap, transferred ownership, generation fencing, bounded latest traces, row-lock ordering, skip-locked recovery and lifecycle timing |
| Omnibus engine infrastructure suite | Session resolution, store persistence, lock threshold, knowledge service and public event-redaction owners |
| Repeated Cloudflare transport fixtures | Exact signed authority, missing versus inconsistent metadata, owner replacement, expiry, publication CAS, unknown completion and cleanup effects |
| Computer/provider fixture repetition | Named action/cleanup/resume/authority cases plus real PostgreSQL publication, competing-capability and rollback proof |
| UI catalog/CSS/capture-only tests | Actual rendered controls/logo accessibility, request lifetime, sparse save acknowledgement, timeout and auth/member replacement |

The four independent test maps initially estimated approximately 61,500–86,350
removable lines across their inspected scopes. These were planning
estimates, not achieved deletions. Most involved fixture consolidation; none
supported deleting the large suites wholesale. Later worker output and final
Git accounting supersede estimates.

## Findings that still need a separate, concrete reduction

| Priority | Remaining area | Why a blind deletion is wrong | Smallest next investigation |
| --- | --- | --- | --- |
| High | Terminal clinical request-row retention | Claim creation precedes the member lock. A request that passed admission can recreate a row after terminal cleanup. Request cardinality is not currently bounded by a small product limit. | Fence creation and terminal-state checks at one existing transaction owner, enumerate every terminal transition, then choose bounded deletion. Do not introduce an arbitrary retention horizon or sweeper first. |
| Medium | Whole-history capture replay lookup | The fallback supports replay when a timestamp changes. Removing it can create a second canonical import identity. | Define a durable exact identity lookup at the existing import owner, prove changed-timestamp and missing-index replay, then remove scanning. |
| Medium | Retention input inventory | Current retention still inventories all stored assistant inputs. Removing unused plumbing does not make that scan bounded. | Measure retained-input counts and scan cost, identify the canonical live-reference set, then replace inventory only with equivalent privacy retention proof. |
| Medium | Parsed protocol events and raw stderr retention | Parsed events still supply child usage/accounting and diagnostic classification. | Measure memory under a long real turn. Derive only the necessary accounting/diagnostic state if the measured bottleneck justifies the added reducer. |
| Medium | Reflective importer boundary | Replacing the boundary with direct types exposes real optional-root and payload-contract disagreements. An unsafe cast would hide them. | Reconcile the existing canonical importer input contracts, then delete reflection; no new compatibility layer. |
| Medium | Typed string-patch usecases | CLI/headless callers still span this seam. Current locking fixes correctness without inventing another patch representation. | Trace actual field/clear semantics across callers; replace only with one existing typed request owner and keep omission/clear distinctions. |
| Medium | Game vote JSON/event and delivery-status mirrors | Proposer implicit yes, locked tally, cancellation and independently deployed readers still consume these representations. | Prove one canonical replay/reader contract, deploy readers first, then remove duplicate writes. Preserve live editing/voting. |
| Medium | Payment recovery UI | Unknown provider outcomes, stable request identity and cross-target recovery are real cases. A boolean replacement would lose financial authority. | Remove only states proven derivable from the existing purchase owner; retain ambiguous-versus-absent outcomes and authority changes. |
| Medium | Stranded cleanup claims | Contention now terminates within the caller deadline; automatically deleting a claim could steal a live cleaner's ownership. | Establish a provable owner/lease rule before automatic recovery. Do not infer death from age alone. |
| Low | Standby-pool retirement | Checked-in configuration and current call reachability do not establish that retained production resources have drained. | Verify current deployment/resource use and latency requirement before deleting the last compatibility path. |
| Low | Additional test repetition | Several large files retain distinct concurrency, privacy, money or model-protocol scenarios. | Continue owner-specific removal with explicit retained proof; remaining size is not a finding by itself. |

## Further test reductions identified in the final search

These are unimplemented follow-ups, not counted as deleted lines. The eight
fresh-scope searches inspected files that were unchanged by this cleanup and
found an estimated 19,937–23,543 additional net lines, mostly requiring a smaller
replacement matrix first. That evidence still does not substantiate a
500,000-line cut. Prioritize direct obsolete proof before writing new fixtures.

| Scope | Estimated further reduction | Concrete starting point and boundary |
| --- | ---: | --- |
| Cloudflare | 1,597–1,892 | Repeated completion polling and deployment-smoke retry fixtures; retain timeout, identity, replay and changed-version cases. |
| Engine | 2,425–2,765 | Frozen skill-reference inventory and full prompt-block snapshots; retain explicit assembled-prompt authority/privacy boundaries and real model journeys. |
| Runtime | 2,505–3,145 | Nine smaller lifecycle/notification fixture groups; preserve ordering and ambiguous completion before deleting their bodies. |
| Supporting packages/E2E | 3,800–4,000 | The 191 smoke scenario JSON manifests and verifier only check descriptions/references, not command execution. Replace their inventory with fixture integrity while retaining actual fresh-process CLI journeys. Also trim exercise prose/image URL snapshots. |
| Web game/native | 1,972–2,632 | Replace enrollment/notification/delivery database simulators with actual owner histories. Only 178 lines had immediate existing replacement evidence. |
| Web onboarding | 1,450–1,690 | Auth destination, contact-card and billing presentation fixture matrices. Preserve every identity and recovery distinction; static render tests do not prove payment settlement. |
| Other Web | 3,278–3,903 | About 1,150 lines in changelog wording/historical inventories and 247 legal-wording assertions have no corresponding runtime proof. Keep archive identity/pagination/action binding and actual consent/version behavior. KMS SDK simulation removal needs successful real-wrapper transport cases first. |
| Storage/CLI | 2,910–3,516 | `cli-typed-agent-inputs-schema.test.ts` repeats discovery across schemas/manifests/help; use one literal production-manifest matrix. Duplicate CLI tests of the Codex owner can move their few unique resume assertions before deletion. Preserve no-write/privacy and real interruption behavior. |

The estimates subtract replacement allowances. They are source-review findings;
no test run was performed by these final read-only searches. They are not a
claim that a mock happy path replaces corruption, security or race coverage.

## Already resolved by the selected main baseline

The task does not reintroduce or count deletions already shipped before the
branch: Browser Vault/Training surfaces, local device OAuth/heartbeat paths,
draft-reset workflows, retained-small-runner routing and prior cron/state
simplifications. The refreshed baseline was 25 commits newer than the initial
checkout. Baseline deletions are excluded from task totals.

## Verification and rollout boundaries

Focused owner suites, real filesystem mutation tests, synthetic PostgreSQL
concurrency tests and relevant package typechecks have been run throughout.
The accepted-turn search-budget journey used the actual local Codex subscription;
scripted native cold-resume and workout CSV journeys also passed. After main
reconciliation, `pnpm typecheck` passed all 25 declared workspaces, the prepared
runtime build passed, and 619 integration/artifact tests passed across 12 files.
Earlier owner suites and independent reruns overlap, so they are not summed
into a unique repository-wide test count. Commands and detailed verification
boundaries are recorded in the execution plan.

Production credentials, member data and production mutations were not needed.
The local PostgreSQL lanes are session-owned, migrated synthetic databases. No
new dependency or database schema is needed for the production repairs.

Stripe still has one deployment constraint: keep originating deployments until
old pinned workflows drain. Old completed receipts may still owe an activation
wake. New receipts use receipt-owned completion; resetting historical completed
receipts globally would be an unsafe substitute for that drain.

A scoped local commit is distinct from deployment or merging. Final remote CI
and required ReviewGPT were not run at the original local checkpoint. The
subsequent release is tracked in PRs #4861–#4866 and the active PR/release plan;
its review and merge status must be checked separately. The full Docker smoke and interactive browser/provider verification
also remain unrun. Rendered component tests and native local-Codex journeys
prove their respective boundaries, not those external checks. Product/release
readiness remains **Hold** until applicable missing evidence is supplied.


## Reviewed release candidate

All six PRs received valid GPT-6 Pro review. Three accepted findings were fixed:
remove unused collector family buckets; restore the smoke runner's existing
home-directory contract; and use canonical document manifest paths so member
files named `manifest.json` cannot block preservation. The last fix also removes
the unused document-promotion API and its speculative generic machinery.
Retained real-file and CLI proofs preserve default replay rejection and explicit
same-byte re-import after deletion. No new state or authority owner was added.

CI also identified three stale CSV scenario strings, redundant Connect effect
setters, a missing documentation index row and six PostgreSQL fixtures without
an activation transport. The corrections preserve product behavior and prove
real mailbox ownership at the mocked external acknowledgement boundary.

The reviewed combined candidate `43c660229ccfb6aebdd62f959dd7662f03b1b4d0`
against pre-merge main `1485217c1942e8ea938f4c993c572617590c0ca3` removes
**68,623 net lines**, including **62,114 test/fixture lines** and **6,258 source
lines**, across 462 paths. These are net counts after replacements and review
fixes; final documentation closure can change the doc total. The 500,000-test-line
target remains unmet. Fresh combined build, full workspace typecheck and scenario
integrity passed. Exact-head CI, ordered merges and the single Cloudflare release
remain distinct completion gates.

The [review record](../exec-plans/completed/2026-11-11-simplicity-pr-release.md)
contains validated heads, review links and proof. [PR #4866](https://github.com/cobuildwithus/murph/pull/4866)
tracks final merge and deployment receipts; this report does not claim a deployment
before that live evidence exists.
