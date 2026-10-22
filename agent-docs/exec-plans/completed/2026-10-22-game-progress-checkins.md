# Shared game progress and explicit chat check-ins

## Outcome

Players can ask about daily check-in status and settled results. In iMessage,
explicitly saving a received photo uses the existing game posting rules. A
contextually relevant photo may introduce this option once per person; that
offer never enables automatic saving of future photos.

## Boundaries and design

Use canonical game settlement, private game media, accepted sender identity and
current exact-pair chat authority. Shared progress contains metadata only; no
private labels, captions, excuses or locked images. Fetch only the selected
accepted provider attachment, never a model-selected URL. A pending offer binds
its sender, room, source, game and current day. Member-owned game profile state
records the introduction across games. Ordinary human conversation stays quiet.
No reminders, autonomous score messages or backdated photos are added.

## Product UX and proof

Cover first relevant offer, repeated quiet photos, explicit save, same-sender
continuation, replacement confirmation, time rollover, unavailable attachment,
wrong sender/room, heart-rate challenges, progress and finished results. Run
focused boundary tests, Web/package typechecks and production-derived real-Codex
journeys before parent review. Parent owns final review, merging and deployment.

## Steps

- [x] Trace current shared reads, media ownership and accepted sender authority.
- [x] Implement shared progress and canonical settled results.
- [x] Implement explicit photo import and once-per-person introduction.
- [x] Verify deterministic boundaries, live journeys, docs and changelog.

## Candidate evidence and handoff

Focused proof passed: 74 Web game tests, 16 PostgreSQL game tests, 14 assistant
game-tool tests, two signed transport tests, and Web, assistant-engine,
assistant-runtime hosted-execution and Cloudflare typechecks. The full 122-case turn-planning
suite and 167 dispatcher tests also pass. Complexity and docs drift
guards passed. Eight real-Codex journeys were reviewed as Ready: introduction,
repeat silence (including a new room with no introduction history), explicit save, selected-photo yes, replacement confirmation,
daily progress and settled results. These journeys prove dialogue and tool
effects; they do not claim visual activity verification or production delivery.

The introduction records a conservative once-only attempt, not a delivered
question. Pending approval lasts at most 30 minutes and never beyond the game
day. No qualifying developer-friction entry was created.

## Integrated candidate

Integrated lifecycle head `e850940a74`, including the negotiated-terms and reader
floor changes. Shared discovery uses the same-pair candidate owner. Photo saves
carry its provider-verified pair through the normal post transaction; no save
rebinds the announcement room. The current requester and original source sender
are revalidated in that room, and the stored offer remains room/day scoped.
Negotiation, encrypted v2 pending words, proposal origin and bootstrap metadata
are preserved. The reader-floor photo-unavailable stub is replaced by the
participant-aware handler now that its feature is present.

All eight live journeys were rerun with read/update/photo tools jointly present
and remain Ready. Combined deterministic proof includes same-pair secondary-room
posting and settlement, wrong-pair rejection, PostgreSQL offer/yes/retry through
the normal post owner, and a stored offer rejected from a different room. The
local PostgreSQL database was initialized with the standard runtime-cutover seed
needed by the existing allowance proof; no production database was touched.

Full first-provider-input capture uses identical fixtures across the rollout
stages. Direct turns remain 155,921 bytes. Group input is 136,129 bytes at base,
138,595 after negotiated terms (+2,466), 138,977 after lifecycle (+382), and
144,355 after progress/photos (+5,378). The combined increase is 6.043%; the
photo slice increases lifecycle input by 3.870%. Exact model tokenization is
unavailable, so no token estimate is substituted. Exact historical tool
snapshots live with the optional measurement fixture.

Parent owns final review, CI, plan closure and deployment. Compatible runtime
consumers and the nullable profile migration must precede the new Web producers;
refresh active runtimes. No native app release or production replay has occurred.


## Review remediation: accepted attachment identity

The first importer incorrectly expected a URL in an accepted Linq wake. Real
webhook normalization intentionally strips signed URLs and retains attachment ID
and MIME. Selection now uses that durable identity, so offers require no network.
Consented saves refresh metadata through the existing Linq SDK boundary (3-second
budget, 16 KiB metadata bound, no SDK retries) outside the database transaction.
Exact returned ID, supported MIME, declared size and the fixed CDN origin are
checked before the existing bounded download, private media storage and guarded normal post.
No signed URL is stored in the mailbox, pending offer or game state.

Proof now exercises the actual group webhook planner's URL-free mailbox append,
and the production mailbox normalizer feeds the PostgreSQL offer/yes/save/retry
journey. The latter uses the real importer, a synthetic provider metadata/byte
boundary and the canonical post: offer performs no metadata or byte fetch, yes
fetches once, retry creates no second fetch or entry. Previous forged URL-bearing
wake fixtures have been removed. Provider-boundary tests exercise real SDK
retrieval, no retry on failure and the metadata byte cap; media tests preserve
unsafe locator, changed identity/MIME, size, magic and redirect safeguards.

The Cloudflare local expectation helper also now represents the independently
gated photo tool, fixing its stale all-tools/base-tools expectation. Production
tool advertisement and prompts are unchanged by this remediation; the existing
eight live-model journeys and complete-input measurements remain applicable.

Remediation checks: 193 focused Web media/provider/group-ingress tests, three
isolated PostgreSQL game proofs and 40 Cloudflare local advertisement tests pass.
Web and Cloudflare typechecks, Web lint (existing warnings), docs drift, diff
whitespace and changed-source complexity checks pass. No new model instructions,
schema fields, migration or production mutation are part of this correction.


Integrated reviewed lifecycle correction `ba8f3363e6`, including clean bootstrap
retry, durable failed-generation outcome, link-safe provider message parts,
migration-guard/test remediation and the completed runtime-reader plan. The
photo migration is included in the combined expected migration inventory. No
production changes, deployments or member messages were performed in this lane.

On the combined tree, Web typecheck, 68 photo/tool/bootstrap/provider tests,
three PostgreSQL progress/photo proofs, the PostgreSQL bootstrap-recovery proof,
and ten migration-inventory tests pass. Docs drift, whitespace and privacy
checks pass. The original source remains URL-free through offer and yes; retry
performs no second metadata lookup, download or post. Parent owns aggregate
review, CI, plan closure and release.


## Main integration: private game Images

Merged current main, including private Cloudflare Images delivery. Chat imports
still call canonical `putGameMedia`; that owner now sends validated bytes to the
member-bound Worker Images operation and retains the same content-addressed game
key. No chat-specific storage or delivery path is added. Post-to-unlock and viewer
authorization remain in the ordinary game media route; capability URLs never
enter the shared game state. Updated the composed PostgreSQL photo proof to use
real media selection/upload orchestration with only the hosted control boundary
stubbed. It verifies no upload before consent and one owner-bound Images upload
across save/retry. Provider download and hosted upload remain outside transactions.

After this merge, all 48 focused photo/media/tool tests, three PostgreSQL
progress/photo proofs and the Web typecheck pass. Docs drift passes. The Images
provider itself remains a synthetic control boundary in local proof; production
variant admission/deployment is separately owned by the parent release lane.


## Round-two phone allowance finding: rejected with composed proof

The review treated phone-call reservation as if it used the asynchronous game
access gate. Its default store instead calls the existing pure active-access
assertion, which requires an ordinary active owner for thread containers. That
same owner access makes allowance attribution remain with the source room.
Game-only access therefore cannot reserve a call; historical requester activation
alone is insufficient. No phone capability, accounting behavior or schema changes
are needed.

The new isolated PostgreSQL proof exercises the default reservation, real current
membership and historical activation, with synthetic accepted-message decoding and
provider boundaries. It proves that a game-funded alternate room passes AI usage
admission but fails phone reservation before a call, provider effect, usage row or
period is created. Activating ordinary owner access admits the same request. Both
terminal webhook and reconciliation paths then charge the source room once across
replay, leave the game primary balance untouched, and retain source accounting
when the game binding changes. Provider metadata cannot redirect attribution.
This is a proof-only addition; production behavior and migration inventory remain
unchanged. Parent owns final finding disposition and release.

Validation: 25 tests pass across the new PostgreSQL phone-allowance proof,
`phone-calls-usage.test.ts` and `phone-calls-group-requester.test.ts`. The local
PostgreSQL lane uses the final committed schema, with no draft phone funding
column. Web typecheck, focused Oxlint, docs drift and whitespace checks pass;
the aggregate complexity guard passes without new production source. No new
member-facing behavior means no additional changelog or live-model journey.


## Final implementation review and release handoff

The parent reviewed the aggregate implementation and remediation. Full sensitive
ReviewGPT round2 at `5adc524367ff91b8044aae381c352169482dc1fc` resolved the original
photo and lifecycle findings and reported one phone allowance finding. Parent
rejected that claim after tracing the default reservation gate and reviewing the
composed negative/positive PostgreSQL proof above. No accepted findings remain.
The exact committed turn, guarded snapshot, GPT-6 Pro selection and approximately
12-minute substantive response were verified. Review result is FINDINGS with one
rejection, not a model PASS. Review: https://chatgpt.com/c/6ada3e1a-fcec-83ea-acba-a3384677cf04

The post-review delta contains only isolated regression proof and explanatory plan
closure/index changes. It changes no production source, schema, runtime contract,
model instructions or provider input. The current review policy exempts these
changes from another substantive round. Required CI passed on the reviewed
implementation; final-head CI remains the release gate for the proof/closure head.

Compatible reader floor PR #4312 is merged. The parent holds the combined writer
PR #4311, including canonical #4304 and lifecycle #4313, until protected runtime
deployment converges. Deployment run39831471426 attempts1 and2 stopped before
Worker upload at the existing Images variants admission read. Account/credential
verification remains outstanding. This completed plan records implementation and
local proof; it does not claim production convergence, a real member delivery,
or completed aggregate merge. No member messages or private production rows were
used in the proof.
Status: completed
Updated: 2026-10-22
Completed: 2026-10-22
