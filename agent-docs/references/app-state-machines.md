# Murph and iOS state machines

Last verified: 2026-11-07

## Scope and evidence

This is the shared inventory and finding ledger for the state-machine audit of
`cobuildwithus/murph` at `c32c522e20fd61e61a65b9053b94f5d848b909e1` and `cobuildwithus/murph-ios` at
`60e694036454108a30a05e77e78a390eb25c5e06`. The iOS baseline is the weekly game
application, with retained companion authentication, health and capture bridges.
Both remote main heads were fetched with an explicit main refspec and compared
with `git ls-remote`. The initial Murph discovery used stale tracking revision
`91b49c1dcd1`; its default fetch configuration tracked a different branch. The
inventory and current findings were revalidated after advancing the task
checkout. The two repositories are independently versioned; an older companion design is
not evidence of the current native implementation.

A machine includes both explicit enums and implicit combinations of persisted
fields, booleans, current request identity, lease/attempt ownership and external
receipts. Tables group related product lifecycles; they do not enumerate every
visual animation or Cartesian combination of UI flags. A listed transition is
an observed implementation rule or required invariant, not a claim that every
interleaving has been formally verified. Detailed contracts remain with the
linked source and owner documents. This file owns the audit inventory, confirmed
failure schedules, issue grouping and verification status.

Evidence levels:

- **Inspected:** state owner and transition paths traced in source.
- **Reproduced:** a deterministic regression exercises the actual faulty path.
- **Fixed locally:** the regression and applicable focused checks pass with the
  correction; this does not imply merge, deployment or production verification.
- **Unproven:** plausible concern without a demonstrated executable schedule;
  not included in the confirmed bug priority list.

## Cross-cutting invariants

| Invariant | Consequence for transitions and recovery |
| --- | --- |
| One canonical owner | UI, caches, SDK state and provider callbacks are projections or inputs; they cannot independently grant authority or declare a canonical result. |
| Exact operation ownership | Completion, failure and cancellation act only on their own request, attempt, generation or lease. A stale owner must not reset a successor. |
| Conditional writes decide success | Reading an eligible state does not reserve it. A conditional update that affects zero rows must not be reported as a successful transition. |
| Terminal means terminal for that identity | Retry reuses current work or explicitly creates a new attempt. Failed, revoked, expired and completed records cannot silently regain authority. |
| External effects have stable identities | Unknown acceptance is not failure. Replays retain the idempotency key, reconcile the existing effect and distinguish acceptance from delivery. |
| Revocation wins | Sign-out, consent withdrawal, membership loss and account change invalidate in-flight publication and future execution. |
| Failure retains recoverable work | Durable input/outbox state survives transient failure. Cancellation releases only its own claim; acknowledged progress follows confirmed persistence. |
| A stale read cannot undo a mutation | Client snapshots carry member identity and revision/generation. Requests admitted before a mutation cannot replace its accepted result. |
| Bounded work | Polling, retries, collection queries and claims have owner-defined bounds; expensive network/crypto work stays outside database-only transactions. |

## Confirmed findings and fix groups

Priorities reflect demonstrated impact, not hypothetical worst cases. P1 means
serious privacy/data-integrity or primary-flow failure; P2 means a material,
recoverable correctness or availability defect; P3 means a smaller operational
or resource-lifecycle defect.

| ID | Priority and impact | Related issue | State and proof |
| --- | --- | --- | --- |
| SM-03 | P2: delayed Home successes/errors or offline snapshots undo accepted game actions | [iOS #473](https://github.com/cobuildwithus/murph-ios/issues/473) | Merged in [iOS PR #478](https://github.com/cobuildwithus/murph-ios/pull/478); 288 simulator tests pass; independent local review complete |
| SM-06 | P2: reminder operations cross accounts or overwrite saved settings through loading and competing saves | [iOS #477](https://github.com/cobuildwithus/murph-ios/issues/477) | Merged in [iOS PR #478](https://github.com/cobuildwithus/murph-ios/pull/478); nine new and three existing reminder tests pass |
| SM-05 | P2: delayed game activation overwrites explicit reminder preferences, including opt-out | [Murph #4732](https://github.com/cobuildwithus/murph/issues/4732) | Merged in [Murph #4733](https://github.com/cobuildwithus/murph/pull/4733); 42 PostgreSQL tests pass, including both lock orders and 1,000-game load proof |
| SM-02 | P2: diagnostic callback claims readiness or completion after its conditional write lost to terminalization | [Murph #4730](https://github.com/cobuildwithus/murph/issues/4730) | Merged in [Murph #4733](https://github.com/cobuildwithus/murph/pull/4733); see verification ledger |
| SM-04 | P3: shutdown during warmup setup still launches a child and misclassifies cancellation | [Murph #4731](https://github.com/cobuildwithus/murph/issues/4731) | Merged in [Murph #4733](https://github.com/cobuildwithus/murph/pull/4733); six lifecycle tests and Cloudflare typecheck pass |
| SM-01 | Historical P2: old parser cancellation could reset a replacement attempt | [Murph #4729](https://github.com/cobuildwithus/murph/issues/4729), closed; [upstream fix #4656](https://github.com/cobuildwithus/murph/pull/4656) | Already fixed in latest main; redundant local patch removed |

### SM-01 — parser cancellation, already fixed upstream

Owner: `packages/parsers/src/pipelines/worker.ts` and
`packages/inboxd/src/kernel/sqlite/parse-jobs.ts`.

| Step | Old attempt A | Durable job / replacement B |
| --- | --- | --- |
| 1 | Claims attempt 1; provider pending | `running`, attempt 1 |
| 2 | Still pending | Explicit service requeue sets `pending`; B claims attempt 2 |
| 3 | Signal aborts; preparation resolves or rejects | B remains `running`, attempt 2 |
| 4, baseline defect | Cleanup requeues by capture, attachment and `running`, without attempt | B is incorrectly changed to `pending` |
| 5, impact | Returns canceled | B's correctly fenced completion applies zero rows; useful result is removed |
| Required transition | Requeue only A's claimed attempt | B stays `running` and can publish exactly once |

The public parser service exposes the requeue and preparation/drain paths.
Existing stale-result tests cover replacement completion before A returns, but
that order does not expose cancellation while B is still running. Regression
coverage must retain the real SQLite owner and hold both providers explicitly.
Current main already supplies `exactAttempt: { jobId, attempt }` to the existing
requeue owner in all cancellation branches. Commit `25e633bd8ec` / PR #4656 also
covers stale completion/abort while a replacement is running. The duplicate
local patch and release note were removed after baseline correction; explicit
operator retries keep their existing semantics. This is not an outstanding bug.

### SM-02 — diagnostic responses must follow the winning durable transition

Owner: `apps/web/src/lib/hosted-ops/operator-task.ts`;
consumer: internal assistant-ask runtime control and detached diagnostic work.

| Step | Callback A | Durable task / callback B |
| --- | --- | --- |
| 1 | Reads `queued` or `running` before expiry | Eligible task |
| 2 | Awaits mailbox read (prepare) or encryption (complete) | B terminalizes the task |
| 3, baseline defect | Conditional update changes zero rows, but response says `ready` or `completed` | Task stays failed/completed; A's result is not saved |
| Required transition | Check affected-row count and re-read on loss | Return existing terminal/already-completed result |

A second baseline entry is an already-failed, not-yet-expired task with a
retained wake: the missing failed guard returns ready even without concurrency.
The member-message sibling already illustrates conditional-update handling.
The fix must preserve legitimate running retries and keep encryption outside
transactions. This finding concerns operational correctness and wasted work;
member data loss has not been demonstrated.

### SM-03 — game commands must invalidate earlier Home reads

Owner: iOS `MurphCompanion/Game/Live/LiveGameService.swift`.

| Step | Mutation | Concurrent home request |
| --- | --- | --- |
| 1 | Today’s post exists | Home begins and captures `changeRevision` |
| 2 | Server delete succeeds; new view removes post | Old response remains pending |
| 3, baseline defect | Delete never advances revision | Old response passes unchanged-revision guard and restores post, old allowance and unlock projection |
| Required transition | Advance existing revision around the delete request and settlement | Pre-mutation and in-flight snapshots cannot undo accepted deletion |

The same missing ownership update is reachable after creating or accepting an
invite. Hold Home, accept the command response, then release Home: the new game
disappears; creation loses its preview/share link and acceptance reverts local
selection. Four held-transport simulator tests reproduce these schedules,
including a Home read started during a delete whose response is lost.

The server does not recreate the deleted post; this is a stale client/cache
projection. The fix advances the existing revision at `show(Game)`, the accepted
command-response boundary; ordinary Home publication and selection use distinct
owners. Deletion also fences admission and failed/nil-response settlement.
Preserve exact token/safety guards, local-only unsent artifact removal, and the
pre-merge revision decision in reply sending. Wait for server deletion before
opening the retake camera.

Independent review proved two additional variants at the same projection owner:

| Schedule | Baseline invalid state | Correction |
| --- | --- | --- |
| Initial Home computes `GAME_DISABLED`; invite admission and fresh Home finish; release old denial | Access becomes denied despite the newly admitted game | Apply success-path revision/profile/block guards to non-auth errors; current-token 401 still reaches authentication |
| Delete/create accepted, then offline relaunch before another Home fetch | Pre-command retained snapshot restores deleted shot/unused retake or loses new invite/link | Accepted `show(Game)` merge or removal updates the member-scoped cache through `updateKeptHome` |
| Two posts overlap; one accepted answer merges only its own entry; recovery fetch fails; relaunch | Accepted partial post disappears from retained snapshot | Existing `keep(postedDay)` updates that same cache writer |

Cache updates preserve the absent-cache block tombstone, reply redaction,
account scoping and backup exclusion. Only a fresh authorized Home read can
recreate a removed snapshot. Seven new tests and extended existing overlap/cache
tests exercise these paths without mocking revisions. The server remains
canonical; cached state is advisory. The original correction is commit `624c8e6`;
shipping integration narrows these added cache writes to accepted game merges,
removals and partial posts. Generic `show(Home)` only presents a projection;
fresh authorized reads retain their existing cache writer.

### SM-04 — cancellation must be observed after asynchronous warmup setup

Owner: `apps/cloudflare/src/container-codex-binary-warmup.ts`;
caller: `container-entrypoint.ts` supplies the container shutdown signal.

| Step | Warmup | Shutdown signal |
| --- | --- | --- |
| 1 | Initial cancellation check passes; filesystem setup yields | Live |
| 2 | Scratch home/configuration still preparing | SIGTERM aborts controller |
| 3, baseline defect | Spawn child, then register abort listener | Already aborted; event is not replayed |
| 4, impact | Stalled child reports timeout (production limit 20 seconds) | Process-exit hook eventually reaps owned child |
| Required transition | Synchronously check cancellation immediately before spawn | Return aborted; no child, clean scratch in existing finally |

The regression starts warmup and immediately aborts while `mkdtemp` is pending;
the synthetic child records whether it was launched. Baseline returns
`timed_out` and starts the child. No member-data loss is claimed. Existing
post-spawn cancellation, successful initialization, timeout and failure cleanup
remain owned by the same helper.

### SM-05 — explicit reminder choice must win over activation recovery

Owners: `apps/web/src/lib/game/private-kickoff.ts::activateOne` and
`apps/web/src/lib/game/service.ts::saveGameReminders`.

| Step | Activation | Member preference |
| --- | --- | --- |
| 1 | New game commits; post-commit activation fails before its event commits | New seat has defaults |
| 2 | Recovery remains pending | Real `setReminders` saves explicit on/off and every-day choices |
| 3, baseline defect | Recovery copies prior game's flags without explicit-choice evidence | Saved choice is overwritten in either direction |
| Required transition | Carry over only fields with no explicit choice under the existing transaction/lock owners | Explicit values remain; activation still reserves its legitimate kickoff |

The real PostgreSQL regression uses a settled previous game and proves both
on-to-off and off-to-on overwrite. The optional every-day field is independent:
an older client that changes only on/off must not prevent normal every-day
carry-over. Correction uses immutable per-field facts in the existing GameEvent
history, set-based writes and the existing game lock; no new schema or per-game
activation loop on settings save is needed. Both lock orderings, optional-field
inheritance, feature-disabled saves, activation replay, and kickoff reservation
pass real PostgreSQL proof. At 1 versus 1,000 live games, settings uses the same
query count (at most 12) and one connection; at most two immutable facts per
seat are inserted, and retries add none. No artificial application cap was added.
The added settings operation is one set-based database insert before player
writes; activation adds only a bounded two-key fact lookup. No
network or encryption work was added to these database transactions.

### SM-06 — reminder operations must retain their account and attempt

Owners: iOS `Game/Live/LiveGameService.swift::loadReminders/saveReminders` and
`Game/Prototype/GamePrototype.swift::changeReminders/reset`. This machine arrived
with iOS main `60e6940`; its states and transition table are in IOS-21.

| Reproduced schedule | Baseline invalid state | Required ownership |
| --- | --- | --- |
| Hold member A's GET; switch to B and load B; release A | A's settings replace B's projection | Match token, session generation and loading attempt before applying a read |
| Open settings as A; account source changes to B; submit A's edit | Account observation supplies B's credential to A's PUT | Capture owner before observation; reject a changed owner before sending |
| Hold A's PUT; switch to B, load and begin B's save; fail A | A's prior settings replace B's settings | Only the original token/session/attempt can roll back or settle its save |
| Sign out with nondefault settings | Old member's preferences remain visible | Reset preference projection and lifecycle with account state |
| Hold first PUT; issue an identical second edit that succeeds; fail first | Both writes run, then the earlier failure undoes the accepted local edit | Admit one PUT at a time; settlement permits explicit retry |
| Hold initial GET; toggle a channel before it returns | Full PUT sends default time/exclusions over the saved values; late GET cannot repair them | Only a successfully loaded projection is editable |
| Hold save A's account observation; complete save B; resume A | A sends its older full snapshot over B's accepted values | Claim the saving attempt synchronously before the first await |

Four account-boundary regressions failed five assertions; the overlapping-PUT
case failed two. The initial-load and pre-await reservation cases each failed
four assertions before correction. Nine new tests plus three existing reminder
tests now pass, including current failure/cancellation, unavailable authentication,
retry and an old completion arriving during the new member's save.

The service owns one `ReminderState`: unloaded, loading, ready, saving or failed.
Loading and saving carry their request UUID; token/session checks retain account
authority. This replaces the separate save marker and reminder-specific use of
the global game revision. Only ready settings can be edited. Saves reserve that
state before account observation and own optimistic display/rollback. Failed
loads offer retry; duplicate loads share the pending request. Reset invalidates
old attempts. No persistent queue, authentication owner or dependency was added.

## Web client machines

These are projections of server authority. `apps/web/src/components/` paths
below are relative to that directory unless the full path is shown.

### W1. Authentication, code verification and account handoff

Sources: `hosted-onboarding/hosted-contact-code-form.tsx`,
`hosted-onboarding/hosted-first-party-auth-panel.tsx`,
`hosted-onboarding/hosted-session-renewal.tsx`.

States: entry; sending code; code entry; verifying; account completing;
resume-after-error/history; consent; ending session. Method is phone, email or
Telegram; pending operation and mounted/ending flags are part of the state.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Entry | Valid contact, no current operation | Sending; exact AbortController owns completion |
| Sending | Send acknowledged | Code entry with fixed destination; reset code |
| Code entry | Six digits, no current operation | Verifying; reauthentication proves the current account |
| Verifying | Session proof succeeds and still mounted/current | Completing, or reauthentication callback |
| Completing | Current response requires launch consent | Consent with returned status |
| Completing | Current response admitted | Redirect/caller completion; loading stays until navigation |
| Completing | Failure or persisted history restoration | Resume; explicit retry remains available |
| Any admitted panel | Sign-out/decline | Abort owned completion, end server session, return to entry |
| Any | Unmount | Abort current operation; no later UI publication |

Invariants: one operation per form; a sent destination cannot change underneath
verification; an aborted proof cannot continue the account flow; reauthentication
must not carry signup context; sign-out and decline are server-owned facts.
Inspected; no confirmed defect in these paths during this audit.

### W2. Invite access and group/family entry

Sources: `hosted-onboarding/join-invite-state.ts`,
`hosted-onboarding/join-invite-page-model.ts`,
`hosted-groups/group-start-client.tsx`, `family/family-invite-accept-client.tsx`.

States: invite `invalid`, `expired`, `verify`, `checkout`, `blocked`,
`active`; recovery `checking`, `idle`, `linking`, `linked`, `failed`, `conflict`;
family acceptance `idle`, `submitting`, `accepted`.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Verify | Authenticated matching account | Server-derived checkout/activation/access stage |
| Checkout/active | Consent incomplete | Gate progression until current grant |
| Post-verify | Stale authenticated matching `verify` refresh | Ignore regression |
| Recovery checking | Token + authenticated account | Linking; success clears recovery fragment |
| Linking | Cross-account binding conflict | Terminal conflict for this recovery link |
| Linking | Transient/error response | Failed; authenticated access remains known, so a successful explicit retry returns to the group |
| Family idle | Accept action | Submitting; success accepted; failure returns idle |

Invariants: stage does not establish membership by itself; account must match
invite; consent is independent of billing; stale verify responses cannot send an
admitted invite backward. Group recovery conflicts must not attach another
account's messaging address. Group-start authentication is published before linking, so transient recovery failure cannot discard active access.

### W3. Consent acceptance, handoff and withdrawal

Sources: `legal/hosted-legal-consent-card.tsx`,
`legal/dashboard-legal-consent-gate.tsx`,
`settings/hosted-health-data-consent-settings.tsx`.

States: loading/status-error; required launch/feature scopes; accepting;
partially accepted; accepted/handoff-pending; handoff-error; withdrawal pending;
revoked/resume required. Grant versions and handoff status are separate facts.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Unknown | Status read succeeds | Derive pending scopes from server grant versions |
| Required | Accept, current documents, explicit feature choice where required | Submit scopes sequentially, retain latest accepted status |
| Partial acceptance | Later scope fails | Show actual accepted scopes; retry remaining work |
| All accepted | Parent handoff | Keep pending until navigation/callback; failed handoff can retry |
| Granted | Explicit withdrawal | Server revocation; clear/reload authorized view |
| Revoked | New explicit acceptance | Resume only with current server status |

Invariants: visual dismissal is not consent; version changes require new proof;
partial success cannot be undone by a UI error; withdrawal and health-source
cleanup remain server-owned; the settings recovery route stays available.
Inspected; no confirmed defect.

### W4. Retired Browser Vault page lifecycle

Home remains, but its only replica fact is lab presence. The global React
provider, warm cache, shard demand, refresh polling and homepage preparation
were deleted. `home-labs.ts` performs one authorized server core read with a
two-second total deadline; it cannot schedule refresh work. Missing replica
is the existing empty onboarding state; malformed/unreadable/timeout is unknown,
which hides the labs action and exposes the existing retry alert. Abort guards
prevent late results from starting a decode after the deadline. Other Home
projections retain failure isolation, callback precedence and contact setup.
Shared `loader.ts`, `authority.ts`, `session-handler.ts`, `export.ts` and replica
publication remain for native APIs and explicit account export. The auth
provider still consumes `session-invalidation.ts` to fence cross-tab cookie
replacement; it is not a dashboard cache owner.

### W5. Usage-credit checkout and recovery

Sources: `settings/hosted-usage-top-up-state.ts`,
`settings/use-hosted-usage-top-up-dialog.ts`,
`settings/hosted-usage-top-up-request-identity.ts`.

States: selection with idle/opening/locked attempt; purchase with
idle/opening-checkout/canceling operation; dormant/checking/exhausted/failed poll;
server purchase status; open/closed dialog; capacity/selection/target conflict.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Selection idle | Valid offer + persisted request identity | Opening, stable request key stored before POST |
| Opening | Ambiguous timeout/dismissal/failure | Locked recovery identity; no new purchase identity |
| Locked/purchase | Retry | Recover exact existing request or purchase |
| Purchase | Current matching response | Server-derived status, safe checkout URL and retry permissions |
| Pending purchase | Poll run | At most ten reads / bounded timeout per run |
| Poll exhausted/failed | Explicit retry | New poll run for same purchase |
| Purchase | Confirmed terminal result | Stop poll; refresh once, or defer refresh until close |
| Any | Dismiss | Abort owned requests; retain unresolved identity for reopening |
| Redirecting | History restoration | Recovery message replaces indefinite loading |

Invariants: unknown charge acceptance cannot create a new payment; scope binds
checkout endpoint and payer; target conflict blocks checkout; stale purchase IDs
are ignored; exact server proof alone clears ambiguous request identity.
Latest main retains terminal expired/payment-failed context when reopening
selection, and derives resume/cancel/retry actions from the purchase and whether
Checkout returned success. Group checkout reuses this same controller.
Inspected; checkout requests abort the existing poll before mutation, so an
unfenced-looking reducer action alone is not proof of a reachable race.

### W6. Clinical provider web connection, retired

The earlier `/records/connect` client search/selection machine was deleted
between initial discovery `91b49c1dcd1` and current main. Its old states and
transitions are not current app behavior and are intentionally omitted here.
Clinical backend connection/retrieval remains covered under B09. A remaining
route exclusion in the consent gate is not evidence that the old page exists.

### W7. Connected-app one-shot launcher

Source: `connected-apps/integrations-connect-launcher.tsx`.
States: waiting (automatic or paused), connecting, failed, navigated.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Waiting | Visible timeout or button; not already started | Claim local once flag, POST single-use server claim |
| Waiting | Pause/hidden document | Cancel automatic timer; explicit continue remains |
| Connecting | Current valid response | Redirect to provider |
| Connecting | Error/invalid response | Failed; refresh/new link recovery |
| Any | Unmount | Abort owned request and timer |

Invariant: timer and click cannot race into two POSTs; a client retry must not
invent reusable authority for a single-use server claim. Inspected.

### W8. Browser live voice (retired)

Removed in November 2026. The browser page, call-admission APIs, native media
adapter and provider Live routes no longer exist. Historical voice records remain
readable; messaging voice memos use their existing owners.

### W9. Sensitive-action enrollment and recovery

Sources: `sensitive-actions/use-initial-approval-enrollment.ts`,
`settings/hosted-approval-recovery-settings.tsx`,
`sensitive-actions/action-approval-card.tsx`.
States: idle; preparing; reauthenticating; enrolling/confirming;
rotate/recover mode; recovery key displayed; recovered; error. A decision card
has separate `approving`, `denying`, `returning-approved`, `returning-denied`
submission states and a server-supplied return target.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Idle | Repair/recover, no active request | Current AbortController owns ceremony |
| Preparing | Fresh proof required | Reauthenticate current member |
| Authorized | Passkey ceremony or recovery API succeeds | Confirm/recovered state |
| Rotation succeeds | Returned one-time recovery key | Display until user stores it |
| Pending | Error | Error and retry at current owner |
| Enrollment/recovery | Unmount/close | Abort; late response cannot publish |
| Decision idle | Approve | Obtain and sign current challenge; submit signed decision |
| Decision idle | Deny | Submit denial without an approval ceremony |
| Decision submitting | Server confirms approved/denied | Returning decision; navigate or retain receipt |
| Decision submitting | Failure or unsupported returned decision | Clear busy state and permit retry |

Invariants: authentication and approval are distinct; enrollment cannot silently
widen the original request; recovered/rotated state comes from server evidence;
recovery secrets do not enter durable browser caches. Inspected.

### W10. Referral-link and clipboard lifecycle

Source: `referrals/referral-link-action.tsx`.
States: loading, load-error, ready, copying, copied, copy-error; identity key,
input URL and generation scope every result.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Loading | Current account response | Ready with scoped URL |
| Any | Identity/input changes | Immediately derive safe replacement view, invalidate old generation |
| Load error | Retry | New load generation |
| Ready | Copy action | Copying → copied or copy-error |
| Old load/copy | Generation no longer current | Ignore |

Invariant: no frame or late clipboard completion may present another account's
referral URL as current. Inspected.

### W11. Retired Training handoff observation

`/training` redirects to `/settings`. Its workout view, refresh baseline and
focus/visibility observation state were deleted with the Browser Vault provider.
Native training data and runtime publication are unchanged.

### W12. Human browser handoff

Source: `computer-use/computer-handoff-active-view.tsx`.
States: idle with takeover cover; idle with live browser control; saving; done
with return target; idle with retry error. Terminal analytics and first browser
focus have independent one-shot refs.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Covered idle | Take over | Focus live iframe; expose browser controls |
| Idle | Done | Saving; POST existing handoff completion endpoint |
| Saving | Successful response with return target | Done; record completion and navigate |
| Saving | Rejected/malformed/lost response | Idle error; permit completion retry |
| Idle | Page hidden before terminal completion | Record abandonment once; no local grant or checkpoint |

Invariants: browser interaction does not itself prove checkpoint completion;
only the server response permits the return receipt. Server B13 owns exact
handoff identity, retries and cleanup. Inspected; no confirmed defect.

### W13. Group funding and sponsorship management

Sources: `hosted-groups/group-funding-checkout.tsx`,
`hosted-groups/group-sponsorship-management-card.tsx`.
States: W5 checkout selection/purchase for one-time or monthly funding;
management active/paused/recovery-required; cap-change or cancel confirmation;
submitting; recovery `payment_pending`, `fulfilled`, `recheck_required`;
canceled receipt; authoritative or indeterminate error.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Funding selection | Start selected offer/mode | W5 controller owns stable checkout request |
| Purchase | Expired/canceled/failed | Return to selection with outcome note; refresh current sponsorship |
| Management | Increase cap / cancel | Confirm exact intended change; lower cap submits renewal change directly |
| Submitting | Current management returned | Replace projection and selected cap; clear prior recovery message |
| Submitting | Checkout redirect or pending payment | Navigate / bounded status polling |
| Payment pending | Current authorization becomes active | Fulfilled; checkout return can end |
| Payment pending | Retry budget exhausted | Recheck-required; explicit status check remains available |
| Submitting | 4xx / uncertain failure | Authoritative / indeterminate error; keep server-owned projection |
| Cancel submission | Server confirms absent management | Canceled receipt |

Invariants: form selection cannot itself change billing authority; management
writes bind the authorization ID; recovery polls are bounded and canceled on
owner/effect change; an unknown response does not claim cancellation or payment.
Canonical sponsorship and refund/recovery rules remain B06. Inspected.

## Runtime, package and Cloudflare machines

| ID | State owner and source | States | Invariants and recovery |
| --- | --- | --- | --- |
| R01 | Attachment parse job: `packages/parsers/src/contracts/runtime.ts`; `packages/inboxd/src/kernel/sqlite/parse-jobs.ts`; `packages/parsers/src/pipelines/worker.ts` | `pending`, `running`, `succeeded`, `failed`; monotone `attempts` | One claimed attempt may publish/fail/requeue itself; a stale attempt cannot change a replacement. Claim and all SQLite projection changes are immediate transactions. Attempt-specific output directories prevent stale cleanup from deleting a newer result. Upstream #4656 already fences cancellation with exact job ID + attempt and both running projections; recovered succeeded attachment projections cannot be re-claimed. |
| R02 | Canonical write transaction: `packages/core/src/operations/write-batch.ts` | batch `staged`, `committing`, `committed`, `rolled_back`, `failed`; action `staged`, `applied`, `reused`, `rolled_back` | Canonical writer lock serializes mutation. Applied/reused actions are skipped on replay. Rollback evidence remains until its terminal receipt is durable. Terminal/failed batches reject further mutation. Definitively rejected hosted persistence enters rollback. `HostedCanonicalWriteOutcomeUnknownError` retains committed local effects and receipt evidence because remote commit may have happened; cleanup failure after commit does not retroactively report rollback. |
| R03 | Accepted assistant input projection: `packages/assistant-engine/src/assistant/input-store.ts` | `not_attempted`, `pending`, `succeeded`, `failed`, `quarantined`; attachment evidence `not_attempted`, `available`, `partial`, `failed` | Accepted source identity is durable independently of optional inbox projection. Projection success is terminal for the same capture ID; failures/quarantine carry bounded reason codes. Attachment evidence is separately represented, so an accepted input need not imply media availability. |
| R04 | Mailbox import cursor: `packages/assistant-runtime/src/hosted-runtime/mailbox-state.ts`, `mailbox-import.ts`, `mailbox-checkpoint.ts` | per-lane monotone sequence watermark; receipt `imported`, `quarantined`, `skipped` | Conversation/system lanes have independent watermarks; sequence is validated decimal text rather than lossy JS numeric identity. Status history is bounded and advisory; watermark advancement never moves backward. Persistence/checkpoint represents progress, not merely fetched work. |
| R05 | System mailbox execution: `packages/assistant-runtime/src/hosted-runtime/system-mailbox-state.ts`, `system-mailbox.ts` | `pending`, `recording`, `sending`, then removal; `attemptCount`, `nextAttemptAt`, post-checkpoint receipt | Deduped work remains owned until the required durable result/checkpoint/ack completes. Retry time gates dispatch. Cold recovery resets transient `sending` to pending. Serialization frontier and exact continuation owner prevent unrelated or stale work from acknowledging another item. Restored recording cannot consume newly imported device hints. Model-free wake projection filters before selecting and is bound to the published workspace version; retired notification profiles are removed on read. |
| R06 | Assistant turn receipt: `packages/assistant-engine/src/assistant/turns.ts`; statuses in `packages/operator-config/src/assistant-cli-contracts.ts` | `running`, `completed`, `deferred`, `blocked`, `failed`; delivery disposition `not-requested`, `queued`, `sent`, `retryable`, `blocked`, `failed` | Computation and delivery are distinct axes: a completed turn does not prove a sent reply. Receipts identify the exact turn and append timeline events; final delivery follows its existing outbox owner. These receipts are evidence, not current provider admission authority. |
| R07 | Delivery outbox: `packages/assistant-engine/src/assistant/outbox/dispatch-state.ts`, `retry-policy.ts`, `intents.ts` | `awaiting_approval`, `pending`, `sending`, `retryable`, `sent`, `failed`, `abandoned`; confirmation-pending flag | Stable intent identity supplies provider idempotency. Runtime write lock plus prepared dispatch token/attempt fields fence concurrent settlement. Retry requires retryable evidence and budget. An uncertain non-idempotent external send may become abandoned rather than issue a duplicate; email ambiguity without provider IDs explicitly abandons even without a group-fanout code. Provider accepted/confirmed delivery and canonical receipt repair are separate steps. |
| R08 | Canonical automation: `packages/contracts/src/automation.ts`; `packages/assistant-engine/src/assistant/managed-automations.ts` | `active`, `paused`, `archived` | Canonical automation configuration owns future occurrence authority. Mutable title/slug does not grant managed identity. Pause/archive prevents new occurrences; pending already-created delivery uses its existing authority checks and owner. |
| R09 | Scheduled occurrence runtime: `packages/assistant-engine/src/assistant/cron/runtime-state.ts`, `execution.ts`, `delivery-reconciliation.ts` | derived idle/due, claimed (`runningAt`, `runningClaimId`), waiting delivery (`pendingDeliveryIntentId`), deferred retry (`retryAfterAt`); terminal run `succeeded`, `failed`, `skipped` | Exact occurrence claim fences completion. A pending outbox intent blocks launching another provider turn for the same occurrence. Delivery reconciliation uses that exact intent ID. Stale claim recovery has an explicit age policy; canonical pause/archive still gates fresh work. One-shot completion archives only the exact still-current occurrence; a device-activity parent is revalidated before delivery and after an archival CAS declines. |
| R10 | Resident Codex process: `packages/assistant-engine/src/assistant-codex.ts` | `idle`, `reserved`, `stopping`, `stopped`; readiness promise, one-shot/warm lifetime and launch identity | Engine is the sole process owner. Reservation/checkpoint admission is serialized, exact-process teardown precedes replacement, and a stale ready promise cannot publish a newer process. Ordinary turn completion returns a healthy warm process to idle. Checkpoint/restore and explicit abort use the existing exact process boundary. An unknown canonical-write outcome ends the turn and rejects subsequent dynamic-tool dispatch. A steer-attempt latch is set before any asynchronous steering work and never cleared within the turn. |
| R11 | Device account/source lifecycle: `packages/device-syncd/src/client.ts`, `store/sync-state.ts`, `hosted-runtime.ts` | account `active`, `reauthorization_required`, `disconnected`; setup `pending_link`, `link_returned`, `source_confirmed`, `failed`; source `connected`, `unavailable`, `error`, `disconnected` | Web owns connection/consent authority. A provider-link return alone is not a confirmed source. Local runner state is an execution projection; canonical imports require current authority/revision, except explicitly retained accepted work classified by existing contracts. |
| R12 | Device sync job: `packages/device-syncd/src/store/jobs.ts` | `queued`, `running`, `succeeded`, `dead`; attempts, lease owner/expiry and canonical import receipts | Active dedupe identity coalesces work. Only exact live lease may complete/fail. Claim/recovery increments attempts; expired exhausted jobs dead-letter except named retained-work classes. Import receipts distinguish real canonical progress from provider activity. |
| R13 | OAuth callback claim: `packages/device-syncd/src/store/oauth-states.ts` | derived unconsumed, consumed; responses `consumed`, `replayed`, `recovery_required`, `missing`, `provider_mismatch`, `owner_mismatch`, `discarded` | Transactional consume marks, rather than deletes, the state before external work. Concurrent callback must not repeat authorization exchange. Expired unconsumed state may be deleted; consumed state survives until exact finalization/recovery. Finalization binds original `consumedAt`. |
| R14 | Clinical enrichment: `packages/vault-usecases/src/clinical-enrichment.ts`; execution in `packages/assistant-runtime/src/hosted-runtime/clinical-enrichment.ts` | `pending`, `prepared`, `complete`, `blocked`; work `extract`, `deferred`, `apply`, `advance` | Current manifest digest, source digest, cursor and parent eligibility are re-attested. External extraction is separate from canonical application. Prepared output survives retry; canonical readback verifies imports. Job/resource locks serialize application; deferred time and bounded failures prevent unbounded retry. Superseded extraction-version caches are disposable; pending/prepared accepted job state is retained. |
| R15 | Native runner slot binding: `apps/cloudflare/src/runner-slot-binding.ts`; contract `standby-runner-contract.ts`; orchestration `runner-container.ts` | `unbound`, `bound`, `retiring`, `retired` | Slot release/region/name are immutable. Bind is idempotent only for the identical claim/member, never another member. Retirement is one-way and cannot clear a bound member until exact claim matches and stop completes. Legacy standby namespace is drain-only (`standby-runner-container.ts`); current lifecycle is in RunnerContainer. |
| R16 | Native invocation receipt: `apps/cloudflare/src/runner-invocation-receipt.ts` | absent, `registered`, `completed`; attempt ID and monotone generation | A new generation is allowed only after current invocation completes. Equal identity is replay; lower/equal different generation rejects. An uncertain registered native invocation cannot be assumed stopped because time passed. Exact identity fences completion and late RPCs. This native receipt does not itself grant member admission. The legacy immediate-recheck SQL column is retained for old controllers but no longer read/written by this owner. |
| R17 | Runner provider usage latch: `apps/cloudflare/src/runner-invocation-receipt.ts` | absent/allowed, `pending`, `denied` per exact report | Any retained pending/denied usage settlement blocks provider access. Lost replies preserve pending. Only explicit allowance removes a pending exact report; denied cannot be cleared by a later allowed reply. A late denial can recreate the report latch after an earlier allowance removed it, but only for the exact still-current invocation. A new, properly admitted invocation resets old report residue. |
| R18 | Managed snapshot upload: `apps/cloudflare/src/managed-snapshot-upload.ts`; receipt `packages/hosted-execution/src/runtime-resources.ts` | derived allocated, durably admitted, multipart complete, verified; aborted/terminal unverified; pending cleanup obligation | Allocate without bytes, durably admit before URL escape, preserve exact attempt/generation/object/byte binding. Retry reuses admitted immutable receipt and aborts unused allocation. Ambiguous completion seals capability through exact abort then verifies object. Cleanup remains outstanding until exact completion/abort proof. |
| R19 | Workspace checkpoint/restore: `packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts`, `mailbox-checkpoint.ts`; `packages/hosted-execution/src/runtime-control.ts` | derived absent/restoring/active/dirty/checkpointing/published; workspace version and snapshot ref; invocation outcome `idle`, `budget_exhausted`, `scheduled`, `failed` | Workspace version is freshness, distinct from attempt/generation effect authority. Checkpoint reasons describe write boundary, not another authority owner. Stop exact resident process before restore changes Codex home; retain canonical accepted work across snapshots. Conflict is explicit (`foreground_pending`/`workspace_version`). Operational receipt-replay failures clear local roots and retry without retiring acknowledged history; invalid tree/history failures follow the snapshot recovery path. Cold restore clears only in-memory uncommitted-photo gates. |
| R20 | Vault-share publication receipt: `packages/assistant-runtime/src/hosted-runtime/vault-share-publication-state.ts`, `vault-share-projection.ts` | absent/receipt keyed by known projection scope; content digest, generation token, source workspace version | Receipt is dedupe/freshness evidence, not sharing permission. Scope keys and digests are validated; cardinality is bounded to known scopes. Current Web grant/generation must be revalidated by publication owner. Same content can reuse existing receipt only under matching authority. Expanded history falls back to the complete default window if older sources fail resolution or exceed the unchanged record ceiling. |
| R21 | Live workout: `packages/vault-usecases/src/usecases/workout-live-model.ts`, `workout-live-state.ts`, `workout-live.ts` | derived not-started/open/completed from source/start/end fields; per-set member-action identity | Exact workout resource lock serializes modifications. Append operations require an open live workout; endedAt must follow startedAt. Action ID and expected-state binding distinguish exact replay from stale coordinates; historical correction uses canonical record owner rather than blindly replaying a set append. |
| R22 | Experiment lifecycle: `packages/contracts/src/constants.ts`; `packages/vault-usecases/src/usecases/experiment-journal-vault.ts` | `planned`, `active`, `paused`, `completed`, `abandoned` | Only a planned experiment may change protocol lineage/effective snapshot; retained public protocol links cannot be introduced/replaced. Entering active rechecks safety/onboarding and primary-outcome capturability. Canonical write digest prevents stale overwrite. Status is deliberately editable, not a universal one-way terminal FSM. |
| R23 | Canonical catalog/plan status families: `packages/contracts/src/constants.ts`, `zod.ts`; current usecases in `packages/vault-usecases/src/usecases/` | goal `active/paused/completed/abandoned`; regimen `active/paused/completed/stopped`; protocol `available/archived`; recipe `draft/saved/archived`; food/workout-format `active/archived`; condition `active/inactive/resolved`; allergy status per contract | These are canonical record states, not queue claims. Schema-valid explicit editing/correction can reopen a record. Visibility, lineage and canonical write invariants remain; do not invent universal terminal-state restrictions from the name alone. Schema/owner inventory only; individual domain mutation paths are not exhaustively audited here. |
| R24 | Assistant onboarding marker: `packages/assistant-engine/src/assistant/onboarding-state.ts` | `open`, `completed` derived from completedAt; reason `user_answered/user_declined/manual` | Completion is an explicit answered/declined/manual marker, not inferred from a provider turn ending. Normalization derives status from completion time to avoid contradictory persisted status/time combinations. Explicit reopen is supported. Explicit repair handles malformed owned state; ordinary reads remain fail-closed. |
| R25 | Canonical photo media intent: `packages/assistant-runtime/src/hosted-runtime/media-references.ts`, `meal-media-maintenance.ts` | derived locally-uncommitted, `pendingUpload`, uploaded, `retirementPending`, removed; attempts + cursor | Warm catalogue intents cannot upload/retire until the exact archive accepts them; cold restore resets this in-memory gate. Pending bytes stay in snapshots until settled. Current holder, path/hash/size and expiry re-attest upload; retirement preserves a pointer until acknowledged. Each idle invocation has a ten-item/two-second budget; retries use the existing durable wake CAS. |
| R26 | Assistant typing handle: `packages/assistant-engine/src/assistant/channels/typing-handle.ts` | derived ack-grace/lookup/covered wait, starting, accepted, released, stopped | One irreversible stopRequested flag gates all late work. An in-flight accepted start after stop is explicitly stopped. Ack lookup is bounded; release begins immediately; final cleanup reuses the same stop promise. Provider stop remains best-effort with a bounded wait. |
| R27 | Container binary warmup: `apps/cloudflare/src/container-codex-binary-warmup.ts` | derived absent/preparing/initializing; outcomes `ready`, `failed`, `aborted`, `timed_out`; cleanup | Scratch home and child are isolated from real turns and credentials. This optimization does not own runtime readiness. Exact owned process group is killed and scratch removed after every outcome. Immediately before spawn, cancellation is checked again after asynchronous preparation; #4731 covers the confirmed missed-abort correction. |

### Runtime transition table

| Family | From | Trigger/guard | To and retained effect |
| --- | --- | --- | --- |
| R01 | pending | atomic claim | running; increment attempt |
| R01 | running(n) | success/failure with exact current n | succeeded/failed; update capture projection atomically |
| R01 | running(n) | cancellation with exact n | pending; no transcript published |
| R01 | running(n+1) or recovered succeeded attachment | late cancellation/completion/failure of n | unchanged under upstream exactAttempt fence; discard only n's artifacts |
| R01 | failed/running/succeeded | explicit operator requeue | pending; retain attempt high-water |
| R02 | staged | commit under canonical writer lock | committing; action journal progresses staged→applied/reused |
| R02 | committing | all actions and persistence succeed | committed; prune terminal artifacts |
| R02 | staged/committing/local committed | definitive rejection, cancellation or explicit rollback while mutable | rolled_back if restoration succeeds; failed if rollback fails, retaining evidence |
| R02 | local committed, remote acknowledgement pending | HostedCanonicalWriteOutcomeUnknownError | committed local effects/evidence retained; error propagates and runtime aborts further mutation |
| R03 | not_attempted/pending/failed/quarantined | valid projection update | pending/succeeded/failed/quarantined; source identity preserved |
| R03 | succeeded | identical success/capture replay | succeeded; any regression/capture substitution rejects |
| R04 | watermark k | handled item with higher valid sequence j | watermark j plus imported/quarantined/skipped receipt |
| R04 | watermark k | duplicate/older sequence | k unchanged |
| R05 | pending | due eligible item selected | sending or recording, depending on route/checkpoint obligation |
| R05 | sending/recording | failure or restart | pending/retry with due time; preserve exact item and durable result |
| R05 | sending/recording | effect/checkpoint/ack confirmed | remove exact item and proven covered continuation items |
| R06 | absent | admitted turn starts | running, delivery queued or not-requested |
| R06 | running | turn settles | completed/deferred/blocked/failed; delivery axis remains independently truthful |
| R07 | awaiting_approval | valid approval | pending |
| R07 | pending/retryable | due/current authority, exact dispatch claim | sending; persist token/attempt before external effect |
| R07 | sending | confirmed delivery | sent; repair receipt idempotently |
| R07 | sending | retry-safe failure/confirmation pending | retryable or sending with confirmation flag; same intent/key |
| R07 | sending/retryable | terminal/retry exhausted/ambiguous non-idempotent effect | failed/abandoned; no automatic duplicate effect |
| R08/R09 | active automation + due occurrence | no running claim/pending delivery | claim occurrence, run once |
| R08/R09 | running occurrence | delivery accepted but not terminal | pendingDeliveryIntentId; release execution claim without rerunning model |
| R08/R09 | waiting delivery | exact intent sent/failed/abandoned | terminal run success/failure; clear exact pending binding |
| R08/R09 | active | explicit pause/archive | paused/archived; future fresh occurrences disallowed |
| R10 | absent/stopped | admitted launch | idle after readiness; reserve for exact foreground owner |
| R10 | idle | turn/checkpoint reservation | reserved |
| R10 | reserved | healthy normal turn completes | idle (warm) or stopping (one-shot) |
| R10 | idle/reserved | explicit abort/restore/poisoned process | stopping→stopped; await exact teardown before replacement |
| R11 | pending_link | provider returns | link_returned; not source-confirmed yet |
| R11 | link_returned | provider/source evidence accepted | source_confirmed; active/connected projection |
| R11 | active | credentials rejected / explicit disconnect | reauthorization_required/disconnected; source authority revised |
| R12 | queued / expired recoverable running | eligible atomic lease claim | running with new attempt/lease |
| R12 | running | exact live lease completes | succeeded; retain canonical import receipts |
| R12 | running | retryable failure with budget | queued with availableAt |
| R12 | running | exhausted/non-retryable failure | dead, except explicit retained-work policy |
| R13 | unconsumed | unexpired matching owner/provider callback | consumed marker committed before external exchange |
| R13 | consumed | callback replay | replayed; after both admission expiry and processing lease, recovery_required |
| R13 | consumed | exact claim resolution without provider authority | deleted; mismatching claim cannot resolve it |
| R14 | pending | attested next source/page | extract work; prepared on accepted extraction |
| R14 | prepared | attested current source + canonical apply/readback | pending next page/source or terminal complete/blocked |
| R14 | pending | source integrity/eligibility failure or exhausted failures | blocked; retain reason/review evidence |
| R15 | absent | initialize exact slot identity | unbound |
| R15 | unbound | bind exact claim/member | bound; identical bind replay succeeds |
| R15 | unbound/bound | correct retirement claim | retiring→retired only after native stop proof; never rebound |
| R16 | absent/completed(g) | new identity with generation > g | registered(g+); registration replay returns existing |
| R16 | registered | matching completion | completed; late mismatched completion is no-op |
| R17 | absent | exact registered invocation begins settlement | pending; provider permission denied until resolved |
| R17 | pending | explicit allowed response | remove pending latch |
| R17 | absent/pending/denied | denied response for exact current invocation | denied; retained across eviction/reply loss, including allowance-then-late-denial |
| R18 | allocated | admission returns exact immutable receipt | admitted; abort unused concurrent allocation |
| R18 | admitted | complete/abort ambiguity sealed, bytes verified | verified terminal receipt |
| R18 | allocated/admitted | failure | exact abort then terminal unverified; retain cleanup obligation if abort unconfirmed |
| R19 | absent/stale local workspace | validated snapshot/owner restore | active; resident process stopped before home replacement |
| R19 | active/dirty | quiescent exact owner + checkpoint CAS | published new workspace version/ref, or explicit conflict |
| R20 | absent/prior publication | current grant, scope/digest/generation validated | exact publication receipt; invalid input ignored/fails owning boundary |
| R21 | open | valid bound member set/action | open updated; exact replay no duplicate append |
| R21 | open | finish with endedAt > startedAt | completed; further append rejected |
| R22 | planned | explicit activate + safety/outcome checks | active; lineage frozen after planned |
| R22 | any status | explicit schema-valid edit | chosen status; active entry revalidates safety and capturability |
| R23 | any allowed record status | explicit validated canonical correction | another allowed status; visibility follows the canonical owner |
| R24 | open | answer/decline/manual completion | completed with timestamp/reason; status derived on read |
| R24 | completed | explicit reopen | open; clears completion timestamp/reason and preserves creation time |
| R25 | locally-uncommitted pending upload/retirement | exact archive accepted or cold restore | intent eligible for the existing idle maintenance owner |
| R25 | eligible pending upload | current retained holder + exact bytes + accepted register/PUT | uploaded; pendingUpload cleared under canonical write lock |
| R25 | obsolete/expired pending intent | retirement acknowledged | remove pointer; failures retain it for retry |
| R26 | ack wait/starting/accepted | stop | stopped; timers canceled and any late accepted child handle stopped |
| R26 | ack wait | uncovered/lookup timeout/fallback deadline/release | start once; accepted readiness or null on failure |
| R27 | preparing | abort before spawn | aborted without starting child; outer finally removes scratch |
| R27 | initializing | initialize response / error / abort / deadline | ready / failed / aborted / timed_out; exact child and scratch cleanup |

## Hosted backend machines

### B01 — Authentication credentials and sessions

Sources: `apps/web/src/lib/better-auth/{otp-store,otp-transaction,verified-session,session,credential-change,bound-reauthentication}.ts`; encrypted `HostedAuthRecord` in `apps/web/prisma/schema.prisma`.
States: challenge absent/pending/consumed/expired or attempt-limited; session absent/valid/expired/revoked; reauthentication bound/unbound to current member. These are library records plus Murph admission facts, not a new enum.
Invariant: successful proof, member reconciliation and session publication agree on one member; an OTP or reauthentication proof cannot switch the authenticated principal; no plaintext identity/credential payload in the database wrapper.

| From | Event / guard | To / effect |
| --- | --- | --- |
| No challenge | Send passes delivery/rate-limit authority | Pending bounded challenge |
| Pending | Exact credential proof plus durable attempt reservation | Consumed proof; transactional member/session result |
| Pending | Deadline or invalid proof limit | Expired/denied; no session |
| Valid session | Renewal under current identity | Valid renewed session |
| Valid session | Logout, credential removal, expiry | Revoked/expired; next protected read fails |

### B02 — Hosted onboarding and account admission

Sources: `apps/web/src/lib/hosted-onboarding/{stage,lifecycle,invite-service,authentication-completion,member-access,member-access-projections,initial-onboarding}.ts`.
States currently emitted: `invalid`, `expired`, `verify`, `checkout`, `blocked`, `active`. `activating` remains accepted in the type/helper surface but no current hosted-onboarding producer emits it; the activation-progress owner was removed. Product access, strict funding/welcome/referral eligibility, and AI usage are distinct projections.
Invariant: session identity must match the invite. Real people retain product access after billing lapses; returning `incomplete` product access requires mailbox activation evidence or all four active crypto domains. Synthetic rooms retain strict sponsorship/game-funding rules. Recovery navigation with an existing subscription is not itself product or AI entitlement. Suspension denies access; initial onboarding completion is not consent/payment.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Invite lookup | Missing/expired invite | `invalid`/`expired` |
| `verify` | Matching verified session | Derived `checkout`, `active`, or `blocked` |
| `checkout` | Effective own/Family access | `active` |
| Existing account | Billing lapses or owned subscription requires recovery | Recovery UI remains active; product admission separately checks activation proof where required |
| Product-accessible account | AI work requested | Separate current consent/funding/usage gate |
| Accessible account | Suspension | `blocked`/denied |

### B03 — Stripe subscription and Checkout

Sources: `apps/web/src/lib/hosted-onboarding/{billing,subscription-checkout-lifecycle,billing-plan-change-service,stripe-billing-events,stripe-event-reconciliation}.ts`; `HostedBillingStatus`, `HostedMemberSubscriptionCheckout`.
States: billing `not_started`, `active`, `incomplete`, `past_due`, `canceled`, `unpaid`, `paused`; provider Checkout `open`, `complete`, `expired`; pending plan changes remain distinct from the currently effective plan.
Invariant: provider-authoritative subscription/payment state determines billing; product admission and AI funding remain separately owned projections (B02). Ambiguous Checkout cannot mint a replacement while its original charge may complete; scheduled downgrades do not immediately lower the effective plan.

| From | Event / guard | To / effect |
| --- | --- | --- |
| No checkout | Locked eligible start with stable request identity | One open checkout |
| Open | Provider proves completed or expired | Terminal checkout; reconcile associated subscription |
| Any billing state | Valid current provider snapshot | Matching persisted billing state |
| Active | Paid upgrade or renewal downgrade request | Applied upgrade or pending renewal change |
| Open/uncertain | Retry | Recover exact existing session; provider terminal proof before replacement |

### B04 — Stripe event reconciliation

Source: `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`; `HostedStripeEvent`.
States: `pending`, `processing`, `completed`, `failed`, `poisoned`, plus claim expiry/attempt count/next attempt time.
Invariant: one current attempt owns completion/failure; canonical billing transaction and post-commit effects use their existing idempotency owners. A stale attempt cannot clear a replacement claim.

| From | Event / guard | To / effect |
| --- | --- | --- |
| New event | Verified webhook, event identity unique | `pending` |
| Pending/failed/expired processing lease | Due conditional claim | `processing`, increment attempt, lease |
| Processing | Current attempt completes reconciliation | `completed`, lease cleared |
| Processing | Retryable failure at exact attempt | `failed`, bounded next attempt |
| Processing | Non-retryable poisoned payload | `poisoned` |
| Terminal/current lease | Duplicate delivery | Reuse/skip; no blind second side effect |

### B05 — Usage-credit purchase and ledger

Sources: `apps/web/src/lib/hosted-onboarding/usage-credit-purchase-*.ts`, `usage-credit-stripe-{checkout,direct-payment,financial}-reconciliation.ts`; `HostedUsageCreditPurchase`, `HostedUsageCreditEntry`.
States: `created`, `checkout_open`, `payment_pending`, `fulfilled`, `expired`, `payment_failed`; reconciliation/recovery is also projected from attempt and provider evidence.
Invariant: stable payer/request identity admits one purchase; `fulfilled` requires provider paid/succeeded proof and the exact grant; refunds/disputes append scoped adjustments rather than replacing purchase truth. A late paid snapshot must be reconciled even after an earlier local failure projection.

| From | Event / guard | To / effect |
| --- | --- | --- |
| None | Locked payer capacity/request reservation | `created` |
| Created | Provider session creation bound to purchase | `checkout_open` |
| Created/open | Payment processing evidence | `payment_pending` |
| Non-fulfilled | Exact paid session + succeeded intent/charge | `fulfilled` plus one grant |
| Open/pending | Verified unpaid expiry or payment failure | `expired`/`payment_failed` |
| Fulfilled | Refund/dispute evidence | Remains fulfilled; idempotent financial adjustment |

### B06 — Sponsorship and referrals

Sources: `apps/web/src/lib/hosted-groups/{group-sponsorship-authorization,group-sponsorship-refill-dispatch}.ts`, `apps/web/src/lib/hosted-growth/{usage-referral,usage-referral-recovery}.ts`; schema enums `HostedGroupSponsorshipAuthorizationStatus`, `HostedUsageReferralStatus`.
States: sponsorship `pending_activation`, `active`, `paused`, `recovery_required`, `canceled`; referral `armed`, `target_bound`, `rewarded`, `superseded`, `canceled`, `expired`, `disqualified`.
The previous `HostedGroupSponsorshipMoment` and moment store were removed; recurring authorization/refill remains current.
Invariant: funding authority and benefit eligibility are scoped to their payer/target generations; rewards are exactly once ledger effects, never earned merely by creating a link.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Pending sponsorship | Current payment/consent activation | Active |
| Active sponsorship | Pause, failed recovery, cancel | Paused/recovery_required/canceled |
| Armed referral | Eligible exact target binds | Target_bound |
| Target_bound | Policy qualification under locks | Rewarded + deduplicated credit |
| Active referral | Expiry, replacement, cancellation, disqualification | Corresponding terminal state |
| Rewarded | Retry | Reuse reward; no second grant |

### B07 — Device OAuth intent and credential generation

Sources: `apps/web/src/lib/device-sync/prisma-store/{oauth-sessions,connections,sources}.ts`; `DeviceConnectIntent`, `DeviceOauthSession`, `DeviceConnection`, `DeviceConnectionSource`.
States: intent unstarted/started/expired; OAuth unconsumed/consumed/replayed/discarded/expired; connection active/reauthorization_required/disconnected (with provider/source error projections); refresh claimed/in_progress/version_changed/stale.
Invariant: provider, authenticated owner, state and redirect proof are bound before credential publication. Session consumption and credential generation fences prevent replay or stale refresh from restoring disconnected credentials.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Unstarted intent | Exact member/provider claim | Started OAuth |
| Unconsumed OAuth | Current bound callback under row lock | Consumed; publish current credential generation |
| Consumed OAuth | Exact retry in replay window | Replayed result, no second ownership transfer |
| Active connection | Auth revoked/expired proof | Reauthorization_required |
| Active/reauth required | Authorized disconnect | Disconnected, credential authority retired |
| Current credential | Refresh CAS claim | Claimed; stale/version-mismatched writer rejected |

### B08 — Device webhook and dirty-sync progress

Sources: `apps/web/src/lib/device-sync/prisma-store/{webhook-traces,dirty-connections,dirty-payloads}.ts`.
States: webhook absent/processing/processed, claim token and expiry; dirty work clean (`processedRevision == dirtyRevision`)/pending/in-flight/deferred, with encrypted per-revision payloads.
Invariant: an acknowledged revision cannot cover newer accepted work; webhook processing is token-fenced; hydration budgets bound payload fanout; credential-independent accepted captures survive credential-specific cleanup.

| From | Event / guard | To / effect |
| --- | --- | --- |
| New trace | Unique provider/trace claim | Processing with token/expiry |
| Processing | Exact owner finishes | Processed |
| Expired processing | Replacement claim | Processing with new token |
| Clean/pending | Durable accepted provider/capture event | Increment dirty revision, merge bounded work |
| Pending | Runtime ingests captured revision/payload set | Acknowledge only captured progress; newer work remains |
| Pending | Recovery/capacity delay | Deferred until durable wake time |

### B09 — Clinical connection and retrieval

Sources: `apps/web/src/lib/clinical-records/{connect-intents,connections,retrieval}.ts`; `ClinicalRecordOauthSession`, `ClinicalRecordRetrievalRun`.
States: intent unclaimed/started/expired; connection `active`, `error`, `needs_reauth`, `disconnected`; run `queued`, `retrieving`, `importing`, `complete`, `partial`, `failed`, `needs_reauth`, `canceled`.
Invariant: connection retrieval generation fences every read and terminal outcome; authorization failure is distinct from an empty record set; disconnect cancels active work and invalidates old tokens/cursors.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Connect intent | Bound provider/consent-authorized start | OAuth session, then active connection |
| Queued | Valid generation and provider page request | Retrieving/importing |
| Active retrieval | Runtime preempted | Queued; retain restartable accepted work |
| Active retrieval | Valid exact outcome and snapshot evidence | Complete/partial/failed |
| Active connection/run | Provider auth failure | Needs_reauth |
| Connected | Member disconnect/health-consent withdrawal | Disconnected; active runs canceled |

### B10 — Retired companion wrist-command machine

The latest baseline removes `apps/web/src/lib/wearable-haptics/service.ts` and `CompanionWearableSession`, `CompanionWearableLink`, and `CompanionWearableCommand` from the schema. The old queued/claimed/acknowledged/unknown/expired/cancelled/unavailable table is historical and is not a current app state machine. Companion push routing remains current for game notifications (B28).

### B11 — Consent, disclosure, and vault sharing

Sources: `apps/web/src/lib/legal/consent.ts`, `apps/web/src/lib/hosted-privacy/health-data-consent-withdrawal.ts`, `apps/web/src/lib/hosted-groups/group-disclosure-store.ts`; `HostedConsentGrant`, `HostedGroupDisclosureGrant`, `HostedVaultShare`.
States: absent/granted/revoked; grants also bind current version, membership generation, scope, expiry and digest. Absent legacy health grant is not explicit withdrawal.
Invariant: durable grant is the authority; UI, cached membership, provider reaction replay or a projected record cannot grant access. Revocation precedes cleanup, and effect/read boundaries revalidate live authority.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Absent/stale consent | Explicit authenticated acceptance of current scope/version | Granted plus audit event |
| Granted | Explicit withdrawal | Revoked first; block fresh processing, then cleanup |
| Published group permission | Exact current member reacts to bound message | Immutable generation-scoped disclosure grant |
| Active disclosure/share | Revoke, leave/rejoin, expiry | Inactive; old request/delivery fails authority |
| Revoked | Old reaction/request replay | Remains revoked; replay cannot resurrect grant |
| Revoked with unfinished runtime/provider cleanup | Bounded redrive (8 candidates; device retry spacing one hour) | Each signed stop/cleanup rereads consent and ownership; regrant makes old cleanup a no-op |

### B12 — Sensitive action approval

Sources: `apps/web/src/lib/action-approvals.ts`, `apps/web/src/lib/sensitive-actions/`; `HostedSensitiveActionChallenge`.
States: absent/pending/approved/denied plus expired/consumed; passkey enrollment unconfigured/configured/unavailable with separate recovery proof.
Invariant: approval binds member, action hash, token, expiry and one consuming effect. A proof for a different action or identity cannot authorize; denial/expiry cannot be consumed as approval.

| From | Event / guard | To / effect |
| --- | --- | --- |
| None | Authorized exact action presentation | Pending challenge |
| Pending | Authenticated valid passkey decision | Approved or denied |
| Approved | Exact unexpired action consumes token | Consumed once |
| Pending/approved | Expiry | Unusable |
| Consumed/denied | Replay | No new effect authority |

### B13 — Browser computer run and handoff

Sources: `apps/web/src/lib/computer-use/{store,service}.ts`.
States: run `running`, `awaiting_user`, `cleanup_pending`, `completed`, `failed`, `expired`, `canceled`; handoff `open`, `checkpointing`, `completed`, `expired`.
Invariant: run/handoff identity, expected status and revision guard transitions. User interaction and assistant control cannot concurrently own the same browser. Terminal work can still require durable cleanup.

| From | Event / guard | To / effect |
| --- | --- | --- |
| None | Authorized bounded run | Running |
| Running | Login/payment/final confirmation/stuck handoff | Awaiting_user + open handoff |
| Open handoff | Exact checkpoint claim | Checkpointing |
| Checkpointing | Checkpoint success/failure | Completed and resumed run, or reopened handoff |
| Runnable | Finish/cancel/expiry | Terminal or cleanup_pending |
| Cleanup_pending | Confirmed provider/resource cleanup | Recorded terminal disposition |

### B14 — Phone call and result delivery

Sources: `apps/web/src/lib/phone-calls/{service,reconciliation,result-delivery,retell-result-lifecycle}.ts`.
States: call `starting`, `calling`, `ended`, `completed`, `needs_user`, `failed`; result `pending`, `queued`, `sending`, `delivered`, `ambiguous`, with delivery generation.
Invariant: call reservation precedes provider creation; provider correlation is authoritative; no blind repeat after ambiguous send. Result generation and live route authority fence delivery. Linq uses its existing receipt owner; the explicit result-delivery controller handles Telegram.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Starting | Confirmed provider call | Calling |
| Calling | Provider lifecycle + reconciliation | Ended, then completed/needs_user/failed |
| Pending result | Durable notification enqueue | Queued |
| Queued | Current generation + live route authorize send | Sending |
| Sending | Confirmed delivery / ambiguous acceptance | Delivered / ambiguous (terminal) |
| Queued/sending | Proven retryable failure | Pending and recovery rearmed; ambiguity after send is not retryable |
| Old generation | Late outcome | Ignore or reject; cannot authorize new sending |

### B15 — Linq delivery intent, provider child receipts, and terminal retry

Sources: `apps/web/src/lib/hosted-onboarding/{linq-delivery-store,linq-terminal-retry,linq-provider-event-store}.ts`.
States: parent `attempted`, dispatch-started, `accepted`, `delivered`, `failed`, `skipped`, `sent_no_receipt_expected`; exact message child `accepted`, `delivered`, `failed`; retry claim/deadline/lineage are separate metadata.
Invariant: acceptance is not delivery; exact child receipts determine aggregate outcome without losing earlier positive evidence. Dispatch uncertainty never authorizes a blind repeat. Special terminal retry requires exact verified code 4001 failure, live route/consent, service policy, parent lock, lineage and bounded window.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Attempted | Exact claim + current routing/egress authority | Dispatch-started before provider call |
| Dispatch-started | Provider acceptance | Accepted and exact child identity |
| Accepted | Exact positive receipt(s) | Delivered, or allowed no-receipt terminal form |
| Attempted/accepted | Proven terminal failure or policy skip | Failed/skipped |
| Failed child | Narrow terminal-retry authorization under lock | Replacement child in same bounded lineage |
| Ambiguous dispatch | Retry | Recover receipt/claim; no unfenced resend |

### B16 — Public-email bootstrap

Source: `apps/web/src/lib/hosted-onboarding/hosted-email-public-bootstrap.ts`.
States: `claimed`, `sending`, `sent`, `ambiguous`, `failed`, `abandoned`; suppressed is a response disposition before admission.
Invariant: global/member budgets and authority are checked before claim and again before send; stable identity preserves uncertain delivery. Failed provider attempts back off; sent/ambiguous claims enforce cooldown.

| From | Event / guard | To / effect |
| --- | --- | --- |
| No attempt | Valid candidate + locked budget/authority | Claimed |
| Claimed | Revalidated current route/provider configuration | Sending |
| Claimed | Configuration/authority gone | Abandoned |
| Sending | Provider confirms/fails/ambiguous result | Sent/failed/ambiguous |
| Recent failed/claimed/sending/sent/ambiguous | Retry | Backoff/cooldown suppression under existing limits |

### B17 — Operator diagnostics and messages (confirmed defect fixed)

Source: `apps/web/src/lib/hosted-ops/operator-task.ts`; runtime consumer `packages/assistant-runtime/src/hosted-runtime/detached-assistant-ask.ts`.
States: diagnostic `queued`, `running`, `completed`, `failed`; message `accepted`, `running`, `completed`, `failed`. Result-retention expiry clears encrypted result, not task identity.
Invariant: task/mailbox admission is atomic and request shape bound; a failed diagnostic is terminal; ready/completed responses require successful current-row transition. Lost updates return the durable winner. Diagnostic content remains operator-only.

| From | Event / guard | To / effect |
| --- | --- | --- |
| None | Authorized idempotent admission | Queued diagnostic / accepted message + one mailbox wake |
| Queued/running diagnostic | Valid prepare and atomic current-state update | Running, ready |
| Queued/running diagnostic | Exact completion wins conditional update | Completed + encrypted result |
| Active task | Expiry/unavailable source | Failed |
| Completed/failed | Replay or lost transition | Already_completed / terminal; no new ready/success claim |
| Completed result | 48-hour retention boundary | Result unavailable/cleared; completed identity remains |

Confirmed P2, issue https://github.com/cobuildwithus/murph/issues/4730. Baseline lacked failed guard and ignored both CAS counts. A prepare waiting for its mailbox could return ready after another callback expired the row; a completion waiting for encryption could return completed after its zero-row update discarded the result. A failed row also returned ready/completed directly. New `apps/web/test/hosted-operator-diagnostic-lifecycle.test.ts` failed 6 cases before correction (ordinary success passed), then all 7 passed. Combined feedback sanitizer/runtime-route proof: 3 files, 16 tests passed. Tests model database predicates and deterministic callback interleavings, not live PostgreSQL contention.

### B18 — Account deletion cleanup

Source: `apps/web/src/lib/hosted-privacy/account-deletion-cleanup.ts`; `HostedAccountDeletionCleanup`.
States: pending/leased/retry-due/partially complete/complete, derived from exact lease token, expiry, per-vendor completion timestamps and Temporal cursor.
Invariant: account deletion retains encrypted durable cleanup obligations until required vendors are done. Only current lease updates progress; a stale attempt cannot delete another worker's receipt. External calls occur outside database transactions.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Accepted deletion | Durable encrypted cleanup record | Pending |
| Pending/retry due/expired lease | Conditional lease claim | Leased with attempt and token |
| Leased | One vendor/runtime slice completes | Persist that slice/cursor under same token |
| Leased | Failure/incomplete vendor | Release claim, retain progress, schedule retry |
| All required slices complete | Exact lease verifies completion | Remove finished cleanup record |

### B19 — Game agreement, roster, schedule, change votes, and settlement

Sources: `apps/web/src/lib/game/{service,rules,changes,change-resolution,audience,roster,account-deletion,blocks}.ts`; `Game`, `GameInvitee`, `GamePlayer`.
States: `invited`, `negotiating` (pair), `live`, `settled`, `void`; scheduled-before-Day-1 versus current day window; pending change plus immutable vote/resolution events. Pair capacity is 2, group capacity 10. Invite identity survives acceptance; players use stable `(gameId, seat)` identity with nullable `memberId` and `leftAt`.
Invariant: game row locks serialize commands/settlement; pair/audience locks additionally guard applicable admission/capacity. The second acceptance starts a group; later joins share its fixed calendar and add undecided voters. Leaving/deletion expires the pending group change rather than silently changing its electorate. Terms version and proposal identity bind decisions. Current game truth, tickets, events, and lifecycle admission commit together. Account deletion preserves surviving seat/result history and rekeys shared words to a survivor; null identity is not an eligible current player. Live joins/agreements additionally trigger recoverable per-player reminder activation (B29).

| From | Event / guard | To / effect |
| --- | --- | --- |
| New invite / chat pair | Verified audience + current capacity under audience/pair lock | Invited / negotiating; stable invitee/seat identities |
| Invited pair | Other member accepts current terms and exact eligible seat | Live; frozen time-zone/day-one calendar |
| Invited group | Second acceptance under game lock | Live with shared calendar; starter-only direct term edits close |
| Live group | Additional valid join; count below 10, available non-reused seat, not due | Live; existing calendar retained, new undecided voter if a change waits |
| Invited pair | Other member proposes changed terms | Negotiating with pending proposal |
| Negotiating pair | Exact other-player approval | Live with fixed schedule |
| Live / negotiating pair | Valid proposed change | Pending exact proposal; proposer cancellation, other-player agreement/decline |
| Live group | Valid proposed change | Pending, proposer yes; one immutable vote per remaining player |
| Pending group change | Strict majority yes / majority no longer possible | Applied / declined with durable resolution event |
| Pending change | Roster departure/deletion, terms advance, deadline, game end | Expired/cancelled; cannot apply stale ciphertext/calendar |
| Live group | Player leaves | Durable leftAt; void if fewer than two remain; seat never reused |
| Invited/negotiating | Expiry/cancellation | Void |
| Live | Due under database/game clock and game lock | Settled + frozen seat scores/tickets/event/recap intent |
| Active pair | Block | Void, unbound chat, pending lifecycle retired; unblock does not resurrect it |
| Group with blocked pair | Block | Game continues; views/disclosure and chat authority mask/recheck restriction |

### B20 — Game check-in and day-credit state

Sources: `apps/web/src/lib/game/{rules,service,entry-data}.ts`; `GameEntry`.
States: absent; posted attempt 1; retake attempt 2 (prior withdrawn as retake); withdrawn/removed; day marked incomplete/restored. Excuse is attempt 0; media upload existence is not a posted entry. Prove-it challenge state is derived as open/stood/conceded/void from immutable challenge/concession events, current entry, and roster.
Invariant: unique `(game, member, dayIndex, attempt)` bounds posts; exact player and live local day window control admission; artifact provenance/capture age must be valid; correcting credit does not erase retained artifact evidence.

| From | Event / guard | To / effect |
| --- | --- | --- |
| No daily entry | Authorized live-player post with valid evidence | Attempt 1 posted |
| First post | Allowed retake | Attempt 1 withdrawn as retake; attempt 2 posted |
| Posted | Poster withdraws / moderation removes | Withdrawn/removed, credit withdrawn |
| Credited day | Authorized did-not-finish correction | Incomplete; artifacts remain visible |
| Incomplete day | Authorized restoration | Restored credit according to existing entry |
| Duplicate entry identity | Retry | Reuse accepted entry; unique constraint prevents second attempt identity |
| Eligible visible photo | Current live player with unused challenge budget, under game lock | One challenge event and chat obligation keyed by entry |
| Open challenge | Later concession / withdrawn or replaced entry / group departure / game ends | Conceded / void / void / stood; restoring score does not erase concession evidence |

### B21 — Game tickets, reports, and blocks

Sources: `apps/web/src/lib/game/{service,rules,moderation,report-review,blocks}.ts`; `GameTicket`, `GameReport`, `GameBlock`.
States: ticket `open`/`redeemed`, `expired` derived from use-by; report unreviewed/reviewed timestamp; pair unblocked/blocked. Tickets now store `owedBySeats`/`owedToSeats`, not member foreign keys. Report subjects include replies, with encrypted text/audio snapshots and frozen alert parameters.
Invariant: pair redemption retains holder/deadline/block checks. Group redemption requires the actor's frozen eligible seat plus at least one surviving debtor and creditor; account deletion changes availability, never winners. Report snapshots survive source removal, and frozen alert fields keep provider-idempotent alerts stable. Block changes are pair-scoped.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Settlement | Locked frozen outcome requires IOU | Open seat-based ticket(s) atomically issued |
| Open ticket | Current eligible redemption authority + deadline | Redeemed via conditional update |
| Open ticket | Use-by deadline | Derived expired; no redemption |
| No report | Authorized post/player/terms/reply subject | Unreviewed encrypted snapshot + stable alert identity |
| Existing report | Same reporter/subject replay | Reuse accepted receipt/alert; no second report |
| Unreviewed report | Ops review | Reviewed timestamp |
| Unblocked pair | Member blocks | Blocked; pair games/pending sends retired, group remains subject to disclosure masks |
| Blocked pair | Blocker removes block | Unblocked; terminated games stay terminal |

### B22 — Game chat lifecycle generation, binding, and delivery

Sources: `apps/web/src/lib/game/{chat-lifecycle-receipt,chat-lifecycle,chat-delivery-authority,chat-membership,post-notification,change-resolution,recap-witness}.ts`.
States: chat unbound/bound/current-or-stale audience; receipt `awaiting_generation`, `generation_queued`, ordinary delivery states, `skipped`, with retry timestamp and exact source/proposal/regeneration identity. Notice kinds include group change resolutions, group missed-day/evening notices, group invitation talk, recap witnesses, and private evening/kickoff receipts. Private receipts partition draining by payload member rather than the game room and require exact direct Linq route plus current private AI/usage access.
Invariant: canonical transition reserves lifecycle receipt in its transaction; enqueue and advancement commit together. Prepared provider roster evidence is collected outside transactions and revalidated against bound room/database audience. A complete current roster, verified addressed identities, current restrictions, game/proposal and route authority govern disclosure. Pair blocking terminalizes pair work; group notices may defer on a temporary block. Accepted resolution history owns notice truth even after pendingChange clears; current audience still owns disclosure.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Unbound game | Exact prepared provider audience + locked revalidation | Bound canonical room; pair kickoff races reuse same room |
| Accepted game transition | Stable lifecycle identity reserved transactionally | Awaiting_generation |
| Awaiting_generation | Current audience/subject authority + durable enqueue | Generation_queued |
| Generation_queued | Exact retry/wake | Same event; no second obligation |
| Pending generation | Permanent stale game/proposal/audience authority | Skipped with durable reason |
| Pending group notice | Temporary block/route recovery | Retained receipt with bounded retry |
| Generated content | Current live disclosure/route check | Ordinary Linq delivery state machine |

### B23 — Physical note provider acceptance and recovery

Sources: `apps/web/src/lib/physical-notes/{service,lob-runtime}.ts`; `HostedPhysicalNote`, `HostedPhysicalNoteRecovery`.
States: `starting`, `accepted`, `failed`; a failure without a classified reason remains unresolved, and the public response can be `pending`; recovery records distinguish accepted/clear/unavailable.
Invariant: stable intent precedes the external print/mail request; provider ambiguity is not permission to send another note. Only positive acceptance or verified absence permits recovery to settle; usage and authorization remain bound to the exact effect.

| From | Event / guard | To / effect |
| --- | --- | --- |
| No note | Authorized request with usage reservation | Starting |
| Starting | Provider acceptance correlated to exact note | Accepted |
| Starting | Classified definitive rejection | Failed with reason |
| Starting/unresolved failure | Retry or recovery query | Pending unless provider acceptance/absence is proven |
| Accepted | Replay | Reuse accepted effect; no second print/mail request |

### B24 — Conversation poll and vote progress

Sources: `apps/web/src/lib/hosted-polls/{tool,store,votes,completion,notification}.ts`; `HostedConversationPoll`, `HostedConversationPollVote`.
States: reserved/undispatched; dispatched/open; closed; result-notified. Each voter's sequence independently holds vote or retraction tombstone.
Invariant: exact poll target/provider correlation owns updates; per-voter sequence prevents one voter's newer event from suppressing another's vote, and stale events cannot resurrect retracted votes. Completion requires current roster/provider evidence rather than assumed membership.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Reserved | Confirmed provider dispatch | Dispatched with provider identity |
| Open poll | Newer valid voter update | Replace that voter's vote; empty options retain retraction sequence |
| Open poll | Older/duplicate voter update | No change |
| Open poll | Provider close | Closed |
| Open/closed poll | Proven majority, all voted, or closed with votes | Completion eligible; one result notification |

### B25 — Group-join offer, deferred outreach, and membership

Sources: `apps/web/src/lib/hosted-groups/group-join-outreach-{store,drain,window}.ts`, `{group-store,thread-container-participants,thread-container-participant-access,join-post-commit}.ts`; `HostedGroupJoinOffer`, `HostedGroupJoinOutreach`, `HostedGroupMember`.
States: offer active/revoked; outreach accepted/due/deferred/delivery-admitted/terminal, derived from stable offer-participant row and existing delivery status; membership absent/joined/left (new membership identity on rejoin).
Invariant: one offer/participant identity collapses reaction replay; active/suspended/already-joined people follow their existing admission paths. Retryable line/capacity conditions get a durable next attempt; permanently invalid authority terminates. A later membership is not the same disclosure generation. `completeRosterObservedAt` distinguishes current complete provider observations from historical/partial roster evidence; offer gestures have their own idempotent receipt.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Active offer | Verified eligible participant reaction | One durable outreach request |
| Due outreach | Recoverable send window/capacity/line condition | Deferred with reason and next attempt |
| Due outreach | Current exact recipient/line/offer authority | Existing Linq delivery admitted |
| Due/deferred | Permanent ineligibility, revocation, invalid window | Typed terminal disposition |
| No membership | Canonical join completes | Joined generation |
| Joined | Leave, followed later by new join | Old membership removed; new identity |

### B26 — Linq acknowledgment reaction burst

Sources: `apps/web/src/lib/hosted-onboarding/linq-ack-reaction{,-store,-classifier}.ts`; `HostedLinqAckReaction`.
States are implicit: eligible/unclaimed, claimed, accepted (`reactedAt`), ambiguous claimed, heavy/silenced, superseded by outbound. The current burst is bounded by latest `HostedLinqDelivery.attemptedAt`; reservations additionally age out after two minutes. Heavy suppression lasts until outbound. Optional quick asks in a live conversation skip without claiming.
Invariant: chat ownership lock serializes claims/heavy marks against dispatch fences; stale confirm/release matches the exact `claimedAt` token. Provider ambiguity retains claim; only confirmed acceptance suppresses progress. Network calls run outside short bounded transactions. A reply that beat classification prevents a stale claim.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Unclaimed fresh burst | Eligible classifier result, no outbound since receipt, no claim/heavy mark | Claimed with message/reaction identity |
| Fresh burst | Heavy classification, still same burst | Silenced until next outbound |
| Claimed | Provider accepts + exact token confirmation | Accepted; bounded progress suppression |
| Claimed | Definite provider refusal / no send before deadline | Exact unconfirmed token released |
| Claimed | Timeout/ambiguous response | Claim retained, progress still eligible |
| Any old claim | Later outbound / reservation age passes | Old claim no longer covers current burst |
| Newer claim | Late old confirmation/release | Token mismatch; newer claim unchanged |

### B27 — Private game reply and its notification

Sources: `apps/web/src/lib/game/{service,replies,reply-audio,reply-notification}.ts`; `GameReply`, `GameEvent`.
States: absent; accepted text/voice; deleted/removed (reply gone, acceptance receipt retained); unreadable from withdrawn entry, block/report, or departed participant. Notification slot is unclaimed/claimed forever per post, independently of current reply existence.
Invariant: only the other current participant in a two-player live game can reply to a visible post; one current reply per entry. Text/audio sealing happens before the transaction, then authority is checked under the game lock. Acceptance receipt binds actor/game/entry/reply identity. A deleted reply's old request cannot resurrect it; delete-and-new-reply cannot send a second push. Read, audio playback, report, and push share reply visibility authority.

| From | Event / guard | To / effect |
| --- | --- | --- |
| No current reply | Exact eligible participant/post, live and not due, entry slot free | Reply + acceptance receipt + one push slot atomically |
| Accepted reply | Same reply identity retried | Existing receipt reused; no second reply or notification |
| Accepted reply | Author deletion/Ops removal, post withdrawal/retake, account cascade | Reply deleted; durable receipt prevents old-command resurrection |
| Deleted reply | New reply identity with current authority | New reply allowed, consumed notification slot remains consumed |
| Readable reply | Block/report, departure, entry becomes hidden | Unreadable; current authority rechecked for audio/push |
| Claimed notification | Valid current content + exact unexpired signed-in push session/route | One best-effort APNs attempt; no replay after uncertain outcome |

### B28 — Game push and evening reminder opportunities

Sources: `apps/web/src/lib/game/{reminders,reminder-notification,post-notification,push-delivery,evening-check-in}.ts`; `CompanionPushRoute`, `GameProfile`, `GamePlayer`, `GameEvent`, existing Linq lifecycle receipts.
States: reminder disabled/enabled globally and per game; per-seat `reminderEveryDay` distinguishes every available day from count-target urgency; eligible within a thirty-minute local window; daily push unclaimed/claimed/terminal outcome. Post pushes separately consume first/completion slots per recipient/game/local day. Evening chat notices use awaiting_generation/generation_queued/delivery states, plus a derived paused state after three accepted notices without later inbound.
Invariant: one member-wide daily reminder attempt, including failed/ambiguous/superseded attempts. Current game/post, suspension, alerts, reminder preference, exact route, and live game session are rechecked before APNs. Bounded five-minute sharded sweeps revisit unclaimed opportunities; claims never release for blind retries. Evening notices require joined exact audience, suitable time-zone spread, current open-day need, unchanged conversation causal boundary, and one room/date receipt.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Disabled | Member opts in + valid registered route/session | Enabled; no past missed-send replay |
| Count-target game | Member explicitly changes per-game everyDay | Keep posting eligibility; bypass only the urgency shortfall test when enabled |
| Unclaimed daily opportunity | Window, posting need, enabled preference/current route | Durable claim before external send |
| Claimed | Current subject and exact session still valid | One APNs attempt; record delivered/provider outcome when possible |
| Claimed | Subject/route becomes stale or send ambiguous/fails | Superseded/failed/uncertain; claim still consumes daily slot |
| Unclaimed post milestone | First peer post or completion under game lock | Consume appropriate first/completion slot; current visibility rechecked for wording |
| Evening window | Exact joined audience, open work, not paused, bounded reservation | One room/date awaiting_generation receipt |
| Evening pending | New inbound, changed terms/roster/day need, expired window | Current policy rejects stale send; existing lifecycle owner resolves receipt |
| Three accepted evenings without subsequent inbound | Pause condition | No further evening reservation until inbound resumes engagement |

### B29 — Private reminder activation, carry-over, and text opportunity (confirmed defect fixed)

Sources: `apps/web/src/lib/game/{private-kickoff,private-notification,direct-tool,service,chat-lifecycle,reminder-preferences}.ts`; existing `GameEvent`, `GamePlayer`, `HostedLinqDelivery` and mailbox owners.
States: each preference field implicit default/explicitly chosen (append-only event fact); per-player activation unmarked/marked (`messageKind` none/new_person/new_rhythm); optional kickoff awaiting_generation/generation_queued/delivery/skipped-expired; profile-private text disabled/enabled/unavailable; per-member/date evening opportunity unclaimed/awaiting_generation/generation_queued/delivery with derived paused state.
Invariant: activation is idempotent under the game lock; carry-over comes from explicit rematch lineage or the latest earlier same audience and matches member identity, independently of seat order. Explicit current-game choices survive activation recovery: saves record per-field immutable facts set-wise before player writes; activation holds the game lock before checking those facts and copies only untouched fields. The off fact also bounds affected seats to admitted preference authority; newly admitted seats are not caught by a later broad update. These preference facts remain separate from activation/kickoff completion. Kickoff is reserved only for new-person/rhythm notice within 24 hours and delivered 09:00–21:00 local. Private text never grants AI access or creates a direct route; it requires current existing direct Linq authority, consent/funding/usage and applicable reminder opt-in. Private evening excludes games that an eligible room evening can cover; exact terms/day batch and conversation watermark must still match at egress.

| From | Event / guard | To / effect |
| --- | --- | --- |
| Unmarked live player | Post-commit activation or bounded sweep recovery under the game lock | Copy only prior fields without explicit choice facts; mark activation once; optionally reserve kickoff |
| Marked activation | Retry | No recopy or second kickoff |
| Default/current preference | Explicit save, even while feature disabled | Record off fact and optional every-day fact before writing settings; immutable keys collapse retries |
| Explicit current-game preference saved | Delayed/concurrent activation recovery | Keep explicit fields; untouched every-day field may still inherit; kickoff continues |
| Kickoff awaiting_generation | Local daytime, live current seat, private access/route, within 24 hours | One queued private notification; overnight publication defers to 09:00 |
| Kickoff awaiting_generation | 24-hour deadline / game missing | Skipped expired |
| Private text disabled | Authorized app/direct reminder command + canText | Enabled; other current preferences retained according to command |
| Unclaimed member/date opportunity | Text opt-in, +60-minute local reminder window, open-day need, not covered by room, not paused | One private evening receipt |
| Private evening awaiting_generation | Exact current batch and causal watermark, direct route revalidated | Atomic mailbox append and generation_queued |
| Private evening awaiting_generation | Unpublished after bounded deadline | Skipped expired |
| Queued notification | Current batch/seat/access/route/expiry fails egress check | Send rejected as stale; no private disclosure |
| Three accepted private evenings within prior 28 dates, no later inbound | Derived pause | Further private evening reservation blocked until inbound/new policy evidence |

Confirmed reproduction: settle earlier rematch with both per-seat flags false (repeat with true), create live rematch, inject one activation transaction failure, call production `runGameCommand(setReminders)` with opposite flags, then `reconcilePrivateGameActivations`. Both flags revert to the settled game's values. Regression executes real PostgreSQL and real activation/save/sweep owners; baseline 2 failures/6 existing passes in `game-private-activation-postgres.test.ts`. Fixed activation suite: 14 passed, including both toggle directions, four PostgreSQL-observed activation-first/save-first cases with absent or partially existing facts, feature-off to enabled, omitted every-day inheritance, and preserved new-rhythm kickoff. Existing ordinary reminder suite: 28 passed. Issue: [#4732](https://github.com/cobuildwithus/murph/issues/4732).

Load proof: saving 1,000 live games has the same operation/query count as one game, at most 12 SQL statements, one pool acquisition, and at most two preference facts per seat (2,000 total after repeated saves). The added save work is one set-based insert; activation adds one bounded two-key fact read. The separate player-lock query was removed as redundant. Added work has no provider/crypto calls or per-game loop, and imposes no new product cap. Insert facts before player updates: their game foreign-key lock coordinates with activation's existing game FOR UPDATE lock; reversing this order could deadlock.

## Native iOS machines

Sources in this section are relative to `cobuildwithus/murph-ios`; shortened
`Core/`, `Auth/`, `Game/`, `HealthSync/`, `MealCapture/`, `Wearables/` and
`MessagesMiniApp/` paths are beneath `MurphCompanion/`.

### IOS-01: product credential and account observation

Owner: `MurphCompanion/Auth/HostedAuthService.swift`; persisted shape `Core/HostedAuthContracts.swift`; observation types `Core/Contracts.swift`.
States: absent/signed-out marker; active unexpired credential; expired or unreadable/unverified; renewing (`tokenTask`); credential mutation (`credentialMutation` + `epoch`).
Invariants: one device-only Keychain owner; member/token/local key come from one epoch; renewal cannot restore logout or a replaced account; failed revocation remains retryable; transient network failure does not erase a valid credential; authenticated product mutations never automatically replay.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Absent or signed-out | OTP verification; no credential mutation | Retire previous credential, advance epoch, save issued active session after exact epoch check |
| Active | Token request within validity/verification window | Return current token |
| Active/expired | Renewal needed | One coalesced renewal; exact epoch/member/store checks before saving |
| Renewing | Transient failure; original credential still valid | Preserve token; 60-second retry delay |
| Renewing | 401 | Signed-out marker; publish signed-out observation |
| Any saved credential | Explicit logout | Advance epoch/cancel renewal; revoke server session, then signed-out marker; revocation failure preserves retry |
| Any | Storage unavailable, mutation pending, changed epoch, expired offline | Unverified observation; never infer signed-out cleanup |

### IOS-02: OTP entry

Owner: `Auth/LoginViewModel.swift`. State is implicit in `method`, `sentTarget`, `isInFlight`, `flowRevision`, code and error.
Invariants: sent destination stays canonical through resend; stale responses cannot publish a code step for a changed destination; auto-send never repeats a destination during one model lifetime; failed resend preserves entered code.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Entry | Valid destination and idle; Send | Sending; capture method/destination/revision |
| Sending | Success and same revision | Code entry; clear code, set exact sent target |
| Sending | Failure/cancellation | Idle entry with safe error; stale revision does not publish |
| Code entry | Resend while idle | Sending same target; success clears code, failure preserves code |
| Code entry | Confirm nonempty code while idle | Verifying; success only returned for same revision |
| Any | Method/destination/country change | Advance revision; method resets sent target/code |

### IOS-03: app admission, Health connection and consent recovery

Owners: `Core/AppSession.swift`, `Core/AppPhase.swift`.
App phases: `launching`, `needsLogin`, `linkingJunction`, `ready`, `failed(AppFailure)`.
Consent recovery: `pausing`, `loading`, `loadFailed`, `required`, `saving`, `resuming`.
Invariants: `sessionEpoch` fences stale async results; refresh/connect tasks coalesce by owner; no Health or capture authority runs through missing consent; different members cannot inherit SDK session or extension credentials; failed teardown retries the teardown, not ordinary launch.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Launching | No authenticated session | Needs login |
| Launching | Verified existing member and backend admission | Ready, or linking Junction for an established/explicit Health boundary |
| Linking Junction | Same epoch and accepted exchange | Ready |
| Launch/link | Network, rejected session, conflict, missing account, teardown failure | Typed failed state; retry selects its correct recovery boundary |
| Ready | Missing launch consent | Pause independent Health/capture boundaries; load current consent; keep signed-in shell |
| Required | Accept current documents | Saving → resuming → ready; stale documents reload; failure preserves recoverable required state |
| Any signed-in | Logout/account change | Advance epoch; cancel/join owned work; close boundaries; revoke credential; needs login |

### IOS-04: Health sync evidence and attempt progress

Owners: `Core/AppPhase.swift::HealthSyncState.derive`, `Core/AppSession.swift`, `HealthSync/JunctionSyncService.swift`, `HealthSync/SupplementalHealthMetadataSyncService.swift`.
Evidence states: `notConnected`, `awaitingFirstData`, `synced(date)`, `delayed(date)`, `needsAttention(date?)`. Separate attempt state tracks checking/status, not proof of receipt.
Invariants: HealthKit read permission is unknowable; only backend receipt establishes sync success; future server timestamps clamp to fresh; supplemental reader admits only the two approved metadata kinds and advances successful scan cursors, never stores raw health values.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Not connected | Permission sheet completed | Awaiting first backend receipt |
| Awaiting | Backend last-data timestamp | Synced |
| Synced | Receipt age ≥36 hours / ≥72 hours | Delayed / needs attention |
| Delayed/attention | Fresh backend receipt | Synced |
| Any | Permission request not completed on installation | Not connected; no local optimism promotes it |

### IOS-05: game session and access

Owners: `Game/Live/LiveGameService.swift::followMurph`, `adopt`, `suspendSession`, `forgetAccount`; `Game/Prototype/GamePrototype.swift::GameAccess`.
States: no account; active exact account/token; suspended/unverified; access `unknown`, `lookupFailed`, `allowed`, `denied`.
Invariants: unverified suspends without deleting retained pending artifacts; verified member change/sign-out cleans the correct owner; session generation and exact token fence queued sends/downloads; stored access is advisory, server home owns admission.

| From | Event and guard | To / effect |
| --- | --- | --- |
| No account | Coherent signed-in observation | Adopt member, restore only that member's pending files |
| Active | Unverified observation | Advance generation, stop sends/downloads, clear bearer, preserve member/home/artifacts |
| Suspended | Same member verified | Resume existing state/token |
| Active/suspended | Different member or signed-out | Forget former account, cancel work, reset visible game; adopt new member if present |
| Unknown/lookupFailed | Home response | Allowed; `GAME_DISABLED` → denied; transport failure stays recoverable |

### IOS-06: server game projection and local navigation

Owners: `Game/Live/GameWire.swift`, `Game/Live/GamePrototype+Server.swift`, `Game/Prototype/GamePrototype.swift`, `Game/Live/LiveGameService.swift::loadHome/show/render`.
Server statuses: `invited`, `negotiating`, `live`, `settled`, `void`, `unknown`.
Derived app phases: `needsName`, `zero`, `waiting`, `negotiating`, `declined`, `beforeDayOne`, `playing`, `resultsSoon`, `recapReady`, `afterRecap`, `rematchRequested`. Cover and sheet are separate presentation coordinates (setup/invite/reveal/capture/recap/ticket; edit/delete/route/heart-rate/terms/settings).
Invariants: backend owns scoring, day close, winner and tickets; a command's accepted answer must not be regressed by older Home success/failure or retained cache; current-token rejection still belongs to authentication; active capture/explicit selection survives unrelated refresh; no unknown server status grants an action.

| From | Event and guard | To / effect |
| --- | --- | --- |
| No home | Cached exact-member snapshot | Show advisory cached home while loading |
| Any shown home | Home response with unchanged token/profile/change revision and no block in flight | Replace projection, cache answer, derive phase and retry pending work |
| Any shown home | Mutation answer | Merge affected game; invalidate older home answers through existing revision counter; update retained projection if cache still exists |
| Any shown home | Non-auth Home error from older revision/profile or during block | Ignore stale result; current errors retain normal recovery |
| Accepted projection | Offline relaunch | Recover current member's retained full/partial projection; a block-deleted cache remains absent |
| Live | Backend settles game | Results/recap states derived from server data |
| Recap ready | Recap finished locally | After recap; record exact-member receipt owed to server |
| Any presentation | Explicit capture/cover or selection | Preserve until user closes/completes; server projection remains canonical |

SM-03 is merged in iOS PR #478: shared accepted-command revision ownership, stale-error
guards, and the existing retained-snapshot writer cover deletion, create/accept,
and accepted partial-post recovery. See the finding and verification ledger.

### IOS-07: invite creation, delivery and viewing

Owners: `Game/Live/LiveGameService.swift::createGame/openInvite/acceptInvite`; `Game/Prototype/GamePrototype.swift::SetupAttempt`; `Game/Live/GameLiveMessages.swift`.
States: editable draft; stable create attempt; unsent server invite; Messages handoff; delivered/shared; preview open/used/expired; accepted; cancellation pending/failure.
Invariants: unchanged retry reuses game id/link; a changed draft cancels unsent invite first; losing a create response must not create another game; only newest invite look publishes; invites are sent by the member's Messages app.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Draft | Send | Stable `SetupAttempt` id; create or exact retry |
| Created unsent | Messages cancelled | Keep same attempt and link for retry |
| Created unsent | Draft changed | Cancel old invite first; failure blocks replacement |
| Created unsent | Sent/copied/shared or setup ended | Retire setup identity; later setup gets new id |
| Preview lookup | New link opened | Increment `inviteLook`; stale link responses rejected |
| Open invite | Accept exact current link/session | Server accepted game; used/expired/unknown preview becomes closed-link view |

### IOS-08: artifact outbox, deletion and retake

Owners: `Game/Live/LiveGameService.swift::post/save/send/deleteTodaysShot`; `Game/Live/GamePendingShots.swift`.
Implicit states: no pending artifact; unsaved handoff; durable pending; sending; retryable failure; waiting for Terms; accepted; terminal refusal. Persisted identity is member/game/entry with capture clocks and optional JPEG.
Invariants: one pending artifact per game; handoff succeeds only after durable local save; retries preserve entry identity; exact session/generation and entry identity own completion; no unknown network result destroys a pending artifact; daily delete/retake is server-owned.

| From | Event and guard | To / effect |
| --- | --- | --- |
| No pending | Capture Send | Unsaved owner → durable pending; failed save leaves explicit retry |
| Durable pending | Valid member bearer, not sending | Upload then entry POST; guard session/generation between effects |
| Sending | Server accepts | Remove exact pending entry/files; merge accepted projection |
| Sending | Network/server/auth uncertainty | Keep durable entry; retry on explicit action or eligible home refresh |
| Sending | Terms unavailable | Keep pending, mark waits-for-Terms; automatic refresh cannot reprompt |
| Sending | Terminal `DAY_CLOSED`/`SLOT_TAKEN`/other refusal | Retire pending entry; show truthful failure and refresh |
| Pending not sending and no server entry | Delete | Remove local pending only, no retake consumed |
| Server entry, retake available | Delete | Await server deletion, then render server projection; older home must be fenced (SM-03) |

### IOS-09: replies and voice composer

Owners: `Game/GamePostReplyModel.swift`, `Game/GameReplyAudioSession.swift`, `Game/Live/LiveGameService.swift::replyToPost/sendReply/deleteReply`, `GamePendingShots.swift::GamePendingReply`.
Composer phases: `closed`, `typing`, `requestingPermission`, `recording`, `review`; audio playback has separate request generation. Outbox phases: durable waiting/sending/failed/waits-for-Terms/accepted/refused.
Invariants: draft remains with composer until durable handoff; member/game/entry/reply identity never changes during retry; only current playback request publishes; post deletion/report/block removes forbidden reply projection; audio permission/cancellation cannot reopen old composer.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Closed | Open exact post target | Typing |
| Typing | Record | Permission → recording if current generation and allowed |
| Recording | Stop/interruption | Review if valid recording, otherwise typing with problem |
| Typing/review | Valid text/audio Send | Persist exact reply, hand off; failed persistence keeps draft |
| Durable reply | Send succeeds / terminal refusal | Remove pending file; merge response / surface refusal |
| Durable reply | Uncertain error or Terms declined | Preserve retry identity; Terms needs explicit retry |
| Any | Close/account boundary | Advance composer/playback generation; stop recorder/player |

### IOS-10: recap and ticket acknowledgements

Owner: `Game/Live/LiveGameService.swift::finishRecap/acknowledgeRecapWatches/redeem/acknowledgeRedeems`.
Ticket states from server: `open`, `redeemed`, `expired`, `void`, `unknown`; local per-member sets track recap watches/ticket acknowledgements owed.
Invariants: local confirmation never repeats Messages handoff; acknowledgement retries exact ticket, never next ticket; ambiguous failure keeps owed marker across restart; server settlement authority remains canonical. Concurrent acknowledgements may repeat the same request; the canonical ticket is redeemed once. The later main integration at `fc555ff` adds the recap-writing projection through `GamePrototype+Server.swift` and `GameHomePageModel.swift`; an omitted pending field keeps the existing fallback.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Settled, recap writing | Server `recapPending` is true and recap is absent | Show writing/result projection; Watch stays unavailable |
| Recap writing | Accepted server projection supplies recap | Watch becomes available; watched receipt remains separate |
| Unwatched recap | Finish | Per-member watched receipt pending; locally after-recap |
| Receipt pending | Server acknowledgement / definitive refusal | Clear exact receipt; transient failure keeps it |
| Open ticket | Confirm handoff for exact ticket | Record owed acknowledgement; remove from local spendable wallet |
| Owed acknowledgement | Home refresh under same session | Retry exact id; success/refusal clears marker; failure keeps |
| Any ticket | Server expired/void/unknown/other member left | Presentation denies unsupported redemption |

### IOS-11: Terms fan-out

Owner: `Game/Live/GameTerms.swift::GameTermsAsk`; API caller in `Game/Live/GameAPIClient.swift`.
States: idle; waiting for presentation; required; saving; loading updated documents; failed load; resolved.
Invariants: one visible consent owner answers all waiting writes; recording capture is not forcibly displaced; exact round fences save/reload completion; explicit Not now prevents retry.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Idle | `TERMS_REQUIRED` with documents and consent handler | Required state; queue waiter; wait for capture to close before showing |
| Required | Additional write needs Terms | Append waiter to same owner |
| Required | Accept | Saving; current-round success resolves all true |
| Saving | Stale documents | Reload current documents; required or loadFailed |
| Any active round | Dismiss/Not now/account reset | Increment round; resolve all false; stale saves cannot answer new round |

### IOS-12: protected media loading and profile photos

Owners: `Game/Live/GameImageLoader.swift`, `GameImageStore.swift`, `LiveGameService.swift::setProfilePhoto/setPlayerPhoto/fetchImages`.
States: requested/download-ahead locked; loading; cached; display-authorized; unavailable/suppressed; cancelled/owner changed. Profile mutation has one `isSavingPhoto` slot and a `profileRevision`.
Invariants: locked preview may download but not display; cache scope includes backend/member; removing bearer stops downloads; profile upload/commit/reply each check original owner; stale home cannot undo completed profile write.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Requested | Exact owner and allowed media request | Cache lookup/download; publish individual loaded image |
| Download-ahead locked | Server unlock or accepted local post | Display-authorized |
| Cached | Missing/forbidden current projection | Suppress until fresh authorization |
| Any | Sign-out/member boundary | Cancel requests, clear visible images and correct disk scope |
| Profile idle | Picker Save; same owner and no mutation | Sanitize/upload → commit → owner-checked projection; failure preserves previous accepted profile |

### IOS-13: route capture

Owner: `Core/RouteRecording.swift::RouteRecorder`; system boundary `Game/Route/GameRouteRecorder.swift`.
Phases: `ready`, `asking`, `denied`, `recording`, `done`.
Invariants: When-In-Use precise permission only; Start/Stop bound fixes; raw coordinates stay in memory; finished artifact hides route ends; Send hands only rendered map/distance/time to ordinary artifact outbox.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Ready/denied | Start | Asking if undetermined; allowed → recording; otherwise denied |
| Asking | Permission returns and phase still asking | Recording/denied; closed sheet cannot start |
| Recording | Valid ordered fix with bounded accuracy/capacity | Append and accumulate distance |
| Recording | Stop, denied, or point limit | Done; stop location, freeze clocks |
| Any | Discard/account closure | Stop location, clear raw route, ready/denied |

### IOS-14: wearable heart-rate capture

Owners: `Core/HeartRateRecording.swift::HeartRateRecorder`, `Wearables/WearableHeartRateConnection.swift`.
Phases: `idle`, `discovering`, `connecting`, `ready`, `recording`, `finished`; Bluetooth on/asking/off/notAllowed and typed failure are orthogonal.
Invariants: foreground explicit recording only; exact generation rejects old radio callbacks; search/read/reconnect attempts bounded; samples stay in memory; only summarized artifact leaves after Send; gaps cannot invent measurements.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Idle | Discover / reconnect remembered exact peripheral | Discovering / connecting |
| Discovering | Select discovered device | Connecting |
| Connecting | Valid heart-rate reading | Ready |
| Ready | Start and reading ≤5 seconds old | Recording |
| Connecting/ready | Failed link/no reading | Bounded reconnect or failure; Bluetooth unavailable waits |
| Recording | Stop, prolonged lost readings, foreground exit, duration limit | Finished; close connection |
| Any | Discard | Close exact connection and monitor; clear samples/generation |

### IOS-15: rep tape camera, gate and counter

Owners: `Game/RepTape/RepTapeModel.swift`, `RepTapeGate.swift`, `RepTapeCounter.swift`; Core capture protocol.
Camera states: `starting`, `ready`, `denied`, `unavailable`. Gate: `waiting`, `holding`, `countdown(n)`, `counting`, `done`; missed set remains until redo.
Invariants: no stored or uploaded camera frames; one model owns camera stream; frame time drives gate; only qualified movement counts; standing/leaving after a counted rep pauses rather than silently finalizing; finalized summary stays fixed.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Starting camera | Capture result | Ready or denied/unavailable |
| Waiting | Stable ready plank | Holding → countdown → counting |
| Holding/countdown | Sustained invalid pose | Waiting; short grace tolerates jitter |
| Counting | Valid top/down/up cycle | Add rep; pose loss holds count |
| Counting | Done/goal reached after settling beat | Done; freeze capture clocks and optional HR summary |
| Done/missed | Redo | Reset gate/analyzer/session; no previous frames become new reps |
| Any camera state | Calling task ends | Stop camera and wearable capture |

### IOS-16: optional Contacts projection

Owners: `Core/AddressBookSharing.swift::AddressBookSharingService`, `Core/Contracts.swift`, `Core/AppSession.swift`.
States: `off(access)`, `requestingAccess`, `preparing`, `replacing`, `on(access,count)`, `remoteChanged`, `needsContactsAccess`, `consentRequired`, `deletionPending`, `failed`.
Invariants: one bounded explicit foreground projection; local source never grants identity, membership, routing or consent; base revision and mutation id bind retries; remote edits require deliberate refresh rather than overwrite; permission loss closes prior projection.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Off | Explicit Share | Request access → prepare bounded projection → replacing |
| Replacing | Matching server revision/identity | On with server count |
| Replacing/reconciling | Revision conflict | RemoteChanged; do not overwrite newer source |
| On | Permission loss | Delete owned projection; pending deletion retained on network failure |
| Any enabled | Stop sharing | DeletionPending → off after canonical deletion |
| Any mutation | Missing consent/account epoch changed | Consent recovery or discard stale result |

### IOS-17: automatic meal capture enrollment and teardown

Owners: `MealCapture/MealPhotoCaptureService.swift`, `Core/MealPhotoCaptureContracts.swift`, `MealPhotoCaptureCredentialStore.swift`, `MealPhotoCaptureStore.swift`.
States: `unavailable`, `off`, `enabling`, `on`, `needsPhotosAccess`, `setupFailed`, `needsFullAccess`, `needsAttention`; implicit active operation/disable generation and pending revocation own teardown.
Invariants: future-only explicit opt-in; Full Photos required; scoped credential separated from host session; disabling drains owned capture work and closes local + server authority; generation prevents late enable/repair reopening a disabled boundary; failed revocation remains durable.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Off | Explicit Enable, supported device | Request full access; missing permission → needsPhotosAccess |
| Enabling | Current generation, enrolled credential/configuration and backend activation | Enable local capture → on |
| Enabling | Failure | Close partially created authority; setupFailed/off or needsAttention if closure unresolved |
| On | Full access revoked / credential repair needed | NeedsFullAccess / needsAttention |
| Any configured | Disable, logout or consent pause | Advance disable generation; cancel/drain; disable local extension; revoke scope; clear only exact credential |
| Closure pending | Retry | Complete revocation; never silently resume capture |

### IOS-18: automatic meal processing and review queue

Owners: `MealCapture/MealPhotoCaptureProcessor.swift`, `MealPhotoCaptureStore.swift`, `MealPhotoUploadPolicy.swift`.
Processing states: `inactive`, `processing`, `completed`, `budgetExhausted`, `failure`; per asset classification accepted/needsReview/rejected/retry; upload uploaded/previouslyUploaded/credentialRejected/needsAttention/retry/discard; review needsReview/sent.
Invariants: exact configuration generation/credential/cursor fences progress; cursor advances only after terminal handling; stable capture id dedupes retry; unresolved server outcome preserves retry; invalid duplicate receipt must not discard local capture; bounded private history is not a general gallery.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Active boundary | PhotoKit change after enrollment cursor | Persist progress target; classify eligible new assets within budget |
| Classified | Accepted / uncertain / rejected | Upload / review queue / terminal skip |
| Uploading | 2xx or exact matching dedupe receipt | Sent; advance progress and bounded thumbnail history |
| Uploading | Network/5xx/rate limit | Retry without advancing asset |
| Uploading | Auth rejected | Invalidate scoped credential; foreground repair |
| Uploading | Route/conflicting duplicate problem | Needs attention; preserve capture |
| Uploading | Definitive image refusal (413/415/other 422) | Discard asset; advance progress |
| Any | Changed generation/credential/cursor, cancelled, revoked | No stale write or upload; later current owner resumes |

### IOS-19: manual meal submission

Owners: `Core/ManualMealPhotoSubmission.swift`; orchestration `Core/AppSession.swift` (`manualMealPhotoSendTask` and generation).
States: empty draft; preparing bounded selections; ready draft; sending; partial failure with retained unsent items; completed; cancelled/account changed.
Invariants: at most ten sanitized in-memory selections; no persisted manual queue/full image/retry keys; no upload before explicit Send; accepted sends may add only bounded member-owned thumbnail history; session generation fences response and draft cleanup.

| From | Event and guard | To / effect |
| --- | --- | --- |
| Draft | System camera/picker result | Add sanitized selections up to bound; cancelled leaves draft |
| Ready | Explicit Send under admitted current member | One owned send task; stable retry identities for current draft |
| Sending | Accepted individual item | Remove accepted item, record allowed thumbnail; continue bounded batch |
| Sending | Some failures | Preserve unsent items and partial-failure notice |
| Any | Dismiss/sign-out/member boundary | Cancel/advance generation; clear in-memory draft |

### IOS-20: Messages extension credential and workout mutation

Owners: `MessagesMiniApp/MessagesMiniAppCredentialStore.swift`, `MessagesMiniApp/MessagesMiniAppModels.swift`, `Core/AppSession.swift::ensureMessagesMiniAppCredential`; `MurphMessagesExtension/WorkoutEntryDraft.swift`, `MessagesViewController.swift`.
States: no scoped credential; current derived credential; expired/retired; decoded static card; editable draft; awaiting server confirmation; confirmed/stale/error.
Invariants: extension never receives host product session; derived grant is member-bound and revoked across auth/consent boundaries; cards are untrusted snapshots; direct workout edits wait for canonical server confirmation and cannot infer authority from card payload.

| From | Event and guard | To / effect |
| --- | --- | --- |
| No/current derived credential | Admitted app session needs extension authority | Mint/renew exact scoped grant; publish only for current epoch |
| Current grant | Logout/member/consent boundary | Retire extension credential |
| Static valid card | Supported direct edit and valid scoped grant | Draft then submit exact mutation |
| Submitted | Server acceptance | Render confirmed returned snapshot |
| Submitted | Failure/stale/expired authority | Keep correction/retry state; never label optimistic edit saved |

### IOS-21: daily reminder preferences

Owners: `Game/Live/LiveGameService.swift::loadReminders/saveReminders`,
`Game/Prototype/GamePrototype.swift::changeReminders/reset`,
`Game/GameNotificationsScreen.swift`. The server owns time, push/text preferences,
text eligibility and per-game exclusions; the client has no durable save queue.

| State | Invariant |
| --- | --- |
| `unloaded` | Default values are not an editable server projection |
| `loading(UUID)` | One current GET; only its matching attempt/token/session can publish |
| `ready` | Loaded settings can be edited; save admission reserves this state before any await |
| `saving(UUID)` | One account-owned PUT; service owns optimistic display/rollback; controls are disabled |
| `failed` | Settings stay read-only until an explicit load/retry establishes a current projection |

| From | Event and guard | To / effect |
| --- | --- | --- |
| Unloaded/ready/failed | Admitted settings read; current token; no pending request | Loading with a new UUID; GET current settings |
| Loading | Another settings load | Keep the existing request; no duplicate GET |
| Loading | Matching attempt/token/session succeeds | Apply server settings; ready |
| Loading | Current request fails/cancels or credential changes | Failed; show Try again; no editable defaults |
| Unloaded | Initial account observation unavailable for the same member | Failed; retry remains available |
| Ready | Edit | Claim saving UUID before awaiting account observation; original member/attempt must survive before optimistic display and PUT |
| Saving | Further edit or ordinary settings load | Reject another PUT; skip GET while the same save owns state |
| Saving | Current token/session/attempt succeeds | Keep edit; ready |
| Saving | Current token/session/attempt PUT fails | Restore prior projection; ready with save error; explicit edit can retry |
| Saving | Admission/authority fails while its attempt still owns state | Failed; reload before another edit |
| Any | Sign-out/member replacement | Reset projection to unloaded; old completions cannot change a newer lifecycle |
| Any | Completion with an obsolete attempt | Ignore without publishing, rolling back or settling the successor |

SM-06 proves initial-load, account, admission and overlapping-save failures.
Prototype state starts ready and saves remain immediate; server preferences
remain canonical after any transport error.

## Verification and review ledger

| Finding / check | Baseline evidence | Corrected evidence |
| --- | --- | --- |
| SM-01 parser cancellation | Two failing cancellation interleavings on stale discovery revision; already fixed upstream before current audit baseline | Latest upstream parser suites 54 passed; inbox suites 25 passed; real SQLite owner preserves replacement attempt and recovered output; no local parser patch |
| SM-02 diagnostic transition loss | 6 new lifecycle cases failed; ordinary-success case passed | Lifecycle, feedback sanitizer and runtime route: 16 passed across 3 files |
| SM-03 iOS stale game projections | Four original tests fail with eight assertions; review adds red stale-denial, offline delete/create, and partial-post assertions | 288 tests across ten simulator suites pass after latest-main integration and narrowed cache writes; independent local review has no outstanding findings |
| SM-04 warmup cancellation | New case failed (1 failed, 5 passed): canceled preparation spawned child and returned timed_out | Six tests pass; direct synthetic proof returns aborted without starting child; Cloudflare typecheck passes |
| SM-05 reminder choice | Real PostgreSQL: two new recovery cases fail, six existing cases pass | Activation 14 passed; ordinary reminders 28 passed; both lock orders, optional fields, feature-disabled saves, replay, and 1,000-game constant-query proof |
| SM-06 iOS reminder ownership | Four account-boundary tests fail five assertions; overlap fails two; initial-load and pre-await reservation each fail four | Twelve reminder tests pass within the 288-test run; initial-load gating, duplicate reads, failure/cancellation/auth recovery, account isolation, admission ownership and retry covered |
| Web types | Not a baseline comparison | `pnpm --dir apps/web typecheck` passed |
| Complexity | Existing member-message handler hotspot 21 | Guard passed for five authored source files; hotspot unchanged; reminder helper maximum 4 |
| Changelog | Internal diagnostics/warmup need no public note; duplicate upstream parser note removed | Member-visible reminder correction has `game-reminder-choices-stay-saved`; production archive rendering: four tests pass |
| Document checks | New single reference | Drift/gardening and source-reference checks pass; retired paths are explicitly marked |
| Native full-suite proof follow-up | First main CI exposed shared Home-cache residue and an incorrect one-request assumption for idempotent ticket acknowledgements | [iOS #480](https://github.com/cobuildwithus/murph-ios/pull/480) isolates the image fixture and forces concurrent exact-ticket replay; 79 affected tests pass with no production changes |

Commands for SM-01: `pnpm --dir packages/parsers test test/prepared-attachment-jobs.test.ts test/parsers.test.ts`,
`pnpm --dir packages/inboxd test test/kernel/sqlite/parse-jobs.test.ts test/inboxd.test.ts`.
Regression source: `packages/parsers/test/parsers.test.ts` and
`packages/parsers/test/prepared-attachment-jobs.test.ts`.

SM-02 regression source:
`apps/web/test/hosted-operator-diagnostic-lifecycle.test.ts`.
The Web tests exercise real control code with stateful conditional-write mocks
and deterministic waits; they do not claim live PostgreSQL contention proof.
The existing route and feedback-control suites retain composition/sanitization
coverage. No schema, provider protocol or dependency changes were required.

SM-04 command: `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/container-codex-binary-warmup.test.ts`;
typecheck: `pnpm --dir apps/cloudflare typecheck`. The test uses real asynchronous
scratch creation and a synthetic child; it does not launch a real provider or
exercise deployed container shutdown.

SM-05 sources: `apps/web/test/game-private-activation-postgres.test.ts` and
`apps/web/test/game-reminders-postgres.test.ts`, run with
`MURPH_TEST_POSTGRES_CONCURRENCY=1` against a migrated isolated loopback test
database. PostgreSQL blocking evidence establishes the actual lock wait before
each concurrent completion; operation/pool instrumentation checks the 1,000-game
case. This is real local database contention proof, not a production send.

SM-03 and SM-06 used local Xcode build-for-testing/test-without-building with the
MurphCompanion unit suites: GameAPIClient 85, GameAccess 32, GameAttemptOwners 48,
GameBlockCache 11, GamePendingReplies 16, GamePendingShots 38, GamePostReply 28,
GameProfilePhoto 12, GameReminderSettings 12 and GameSafety 6. The original SM-03
lane has 276 tests, including seven new cases and extended overlap/privacy
restart assertions. SM-06 adds nine new cases to three existing reminder tests,
bringing the lane to 288. Four initial API failures reproduced on unchanged
production source; a per-test temporary pending store corrected fixture leakage.
The integrated 288 tests, build and tracked SwiftFormat pass. Independent local
review has no outstanding findings. The native PR owns current four-state UI
proof and hosted checks; no physical-device or hosted-backend proof is claimed.

Local JavaScript verification ran on Node 24.14.1 and emitted the repository's
24.22.1 minimum-version warning. These are local check results, distinct from
required CI, native simulator proof, deployment and live provider verification.

## Inspection dispositions and maintenance

- The inventory covers 88 active grouped families: 12 web-client, 27 package/runtime,
  28 hosted-backend and 21 native-iOS families, plus two retired interface entries.
  Each active family has a state owner, invariants and transitions.
  Related display or retry microstates stay with
  their owner rather than becoming invented independent durable machines.
- Unchanged families received source and contract inspection. The confirmed
  findings received focused failure schedules and regression work. This is not
  formal verification of every state combination or every provider behavior.
- Historical wearable command read/write sequences initially appeared racy,
  but supported callers took the member `FOR UPDATE` lock before them. The
  current revision retires this interface. No bug is claimed.
- Browser Vault loader abort checks and purchase-poll cancellation prevent
  several apparent stale-result paths. Suspicious local assignments without a
  complete reachable schedule are not confirmed findings.
- Catalog statuses such as completed, archived and paused are sometimes
  explicitly editable canonical facts. Do not apply queue-style irreversible
  terminal semantics to these records without their owner contract.
- Retired interfaces are marked explicitly after current-main revalidation;
  surviving schema or UI compatibility values do not establish reachable work.
- All confirmed defect issues are closed by their landed fixes. SM-01 was
  already fixed upstream. Source merge does not establish deployment; keep
  the baseline and fix PRs distinct from release receipts below.
- When a listed lifecycle changes, update its states, guards, terminal/replay
  rules, failure schedule and evidence here alongside its canonical owner doc.
  A new defect requires a concrete supported caller, interleaving and impact;
  group fixes at the owner that restores the invariant.

## Shipping and simplification follow-up

The subsequent shipping request removes a redundant player lock from reminder
activation: a new preference fact must acquire a foreign-key KEY SHARE lock on
the already-locked game, while an existing fact prevents that field from being
copied. Four real PostgreSQL contention cases preserve both orderings and the
independent optional field. No new state, schema or fallback was added. The two
immutable field facts remain necessary evidence of explicit choice. Diagnostic
CAS checks and their one shared durable-winner read remain the minimum behavior
needed by the demonstrated failures.

Native cache-write ownership is narrowed to accepted game merges, removals and
partial posts; generic Home presentation no longer writes the cache. Existing
fresh-read, profile and receipt writers remain at their owners, and mutation
writes preserve the absent-cache block tombstone. The iOS shipping baseline `60e6940` also
introduced the reminder machine, whose confirmed account/attempt failures are
landed under SM-06.

Merged source and release evidence are tracked separately:

- [Murph PR #4733](https://github.com/cobuildwithus/murph/pull/4733): merged as
  `1a78f7429bc8e26b353fc7a0d36c1663cad4983b` after all exact-head CI passed. Final ReviewGPT
  passed on `8367d979f29a4f0587ce4c6ecf3d8290f477a8d6` with no qualifying findings.
  The original accepted response was recovered through its exact capture receipt
  after the waiter was interrupted; no duplicate review was submitted.
  Managed Web production deployment `7616806236` and exact-source Temporal
  admission [run 42340015400](https://github.com/cobuildwithus/murph/actions/runs/42340015400)
  succeeded for that merged commit. Protected runner rollout also completed,
  including delivery/auth/image gates, endpoint smoke and verified live convergence.
  Its private release receipt is bound to the same public source; no rollback or
  admission bypass was used.
- [iOS PR #478](https://github.com/cobuildwithus/murph-ios/pull/478): merged as
  `2813742176f595a0fe9e762360df230119808926` after hosted checks passed, with 288 passing simulator tests and a
  completed independent local review. Eight simulator screenshots cover ready,
  saving, loading and failed states on SE and Pro Max; focused UI checks passed
  on both phones. One lifecycle now owns reminder loading,
  save admission and retry, without reminder-specific global revision checks.
- [iOS PR #480](https://github.com/cobuildwithus/murph-ios/pull/480) merged as
  `132a2279d2709e137290b6850fd580c7e4efe867` after both exact-head checks passed.
  Its 79 affected tests and the latest-main test build pass. Full post-merge
  verification is tracked by [main CI #42342494525](https://github.com/cobuildwithus/murph-ios/actions/runs/42342494525).
- Native delivery is main-only at the user’s request; no TestFlight upload or
  App Review submission is included. The test-only follow-up preserves the
  latest main’s build `1.1.24 (88)`.

The original completed audit plan remains historical evidence; the shipping
plan and linked PRs own current CI and release progression. Merge, managed Web
promotion, protected runner rollout and native upload require their own receipts;
none is inferred from local tests or review.
