# Private-to-Group Murph Consultation

Status: Proposed

Last verified: 2026-07-15

## Decision

Add one membership-routed consultation primitive:

```text
private Murph asks -> joined group Murph answers -> private Murph continues
```

It is asynchronous because hosted runtimes are independently scheduled. A
synchronous call would hold the private model turn open through another
runtime's cold start and model call, while current runtime signaling reports
acceptance rather than a returned answer.

Use the existing encrypted mailboxes for the request and result. Do not add a
group-context projection, consultation table, workflow, timer, active-group
state, cross-runtime mount, or general agent bus.

The only mailbox extension is a narrow source-bound append: Web may supply an
opaque deterministic item id. The global mailbox primary key then prevents one
private input from moving to a different group during retry. The same value is
the request item id, event id, and dedupe key. It is not a new state owner.

## User behavior

For example:

> Build a hotel workout around today's exercises from 100 Club.

Private Murph asks 100 Club's Murph for the current prescription. When the
answer returns, private Murph combines it with the member's private equipment,
preferences, and health context.

- With one joined group, resolution is automatic.
- With several groups, an exact current display label such as `100 Club`
  resolves automatically.
- If the group is unclear, Murph shows safe group labels and asks the member to
  choose. The member never sees or copies an internal id.
- Private Murph says it is asking the group and will use the answer if it
  arrives. It does not promise a follow-up or claim to have an answer early.
- The result appears only in the private conversation. The consultation creates
  no group message, reaction, typing indicator, or visible activity.
- An expired request produces no timeout message. A later user request can try
  again without a consultation timer, status row, or background notifier.

## Assistant interface

Extend the existing `murph.group` tool:

```ts
type ConsultGroupArguments = {
  action: "consult";
  question: string;
  groupLabel?: string;
};
```

- `question` is the smallest standalone question the group Murph needs.
- `groupLabel` is an optional user-visible label, not authority.
- The schema accepts no membership, member, group, runtime, chat, mailbox,
  route, callback, session, or attachment field.
- `list_memberships` is not a prerequisite.

The runtime maps the existing `AssistantHostedToolRequestKeyScope` into an
equivalent strict wire-origin type owned by `packages/hosted-execution`, outside
model arguments: accepted input ids, inbound mailbox item ids, conversation
identity, and recipient identity. This preserves the package dependency
direction. Consultation is allowed only during an authenticated personal direct
turn with fresh user-authored input. Group, email, scheduled, notification, and
consultation-result turns cannot start one. One accepted input can append at
most one consultation request.
Any consult result closes the consultation capability for that model turn, so
clarification or retry requires later user-authored input. Transport retry of
the same in-flight tool call remains automatic and does not reopen the model
capability.

Submission returns:

```ts
type ConsultGroupSubmissionResult =
  | { status: "accepted"; groupDisplayName: string | null }
  | {
      status: "needs_group";
      reason: "duplicate_label" | "label_not_found" | "multiple_memberships";
      candidates: Array<{ displayName: string | null }>;
    }
  | { status: "no_memberships" }
  | {
      status: "unavailable";
      reason:
        | "candidate_set_truncated"
        | "group_runtime_unavailable"
        | "request_expired"
        | "request_conflict";
    };
```

`accepted` means the request mailbox item committed. It does not mean the
group has answered.

## Automatic group resolution

Web resolves the group because it owns `HostedGroupMember` truth and the
signed callback supplies the personal member.

1. The runtime proves the tool is executing in a personal direct user turn.
   Web proves the signed personal caller and owns the membership checks.
2. Read only current memberships for that member.
3. If `groupLabel` is absent, select only when exactly one membership exists.
4. If `groupLabel` is present, normalize it and current display labels using
   Unicode NFC, trimming, whitespace collapse, and full case folding. Preserve
   punctuation and emoji.
5. Run a membership-scoped exact-match query that returns at most two rows.
   An explicit nonmatching label never falls back to a sole membership.
6. Select only one exact match. Otherwise return safe candidates.
7. Require the selected group to own an active synthetic runtime before
   accepting the request.

The bounded candidate list contains only current display labels. It contains no
ids, group metadata, roster identities, handles, emails, or sharing state. If
Web cannot prove the list is complete, it returns `candidate_set_truncated`
rather than a false not-found result.

Private Murph may use a label from the current user message. After Murph has
shown candidates, it may use a candidate's label only following a later
user-authored selection. Duplicate or unnamed groups that remain
indistinguishable require one group to be named or renamed. V1 adds no opaque
selection token or persisted active-group preference for that rare edge case.

Never fuzzy-match, choose the newest or owned group, inspect roster identities,
fan out, or let a model resolve authority.

## Authority and disclosure

`HostedGroupMember` remains the sole consultation authority.

- Web derives the selected membership and group runtime internally.
- The request carries that membership row id as a hidden generation fence.
- Web checks the exact row at admission, group preflight, and result append.
- Leaving and rejoining creates a new row, so old work cannot cross the rejoin.
- The completion callback must be signed by the selected group's exact runtime
  and current runtime write fence.

V1 treats current Murph membership as permission to ask the group Murph the
same kind of question the member could ask inside the group. It does not grant
access to another member's private Murph, private vault, identity, email, or
unshared health data.

The group answer follows one simple rule: it must be safe to post to the whole
group. This reuses the room's existing disclosure semantics and does not add a
new per-member ACL system. The answer must not quote raw transcript history or
expose protected notes, ids, vault paths, secrets, contact details, permission
metadata, private health projections, or another member's non-room-visible
facts.

## Private question boundary

The only private-to-group content field is the bounded `question`. The request
does not include the private transcript, private vault, provider session,
attachments, contact details, or return route. The runtime may expose the same
group-visible member identity that a normal group turn would show, derived from
the verified membership rather than model arguments. No other requester data
crosses.

Private Murph follows these semantic rules:

- Ask only for group-owned facts needed by the current user request.
- Do not include facts from earlier private messages or the private vault
  unless the member explicitly asks to share that fact.
- If a private fact is necessary, ask the member before including it.

The narrow field mechanically limits the egress surface, but Web cannot prove
the meaning of free text. These are model-policy rules, not a semantic data-loss
prevention claim.

Treat the question, group-visible member label, group knowledge, and group
answer as untrusted prompt data. Keep them out of developer instructions.

## Request mailbox flow

The existing request mailbox item is the durable job, operation record, and
idempotency fence.

1. The runtime supplies the stable request-key scope from the accepted private
   input. No tool-call ordinal is used.
2. Before group resolution, Web derives one opaque request identity from a
   fixed, domain-separated SHA-256 digest over a canonical encoding of the
   authenticated requester and the already-opaque request-key scope. It
   excludes the question, label, membership, and destination so one accepted
   input always has one consultation identity. Authorization does not depend on
   digest secrecy, and no raw personal or conversation identifier appears in
   the resulting id.
3. Web looks up that identity by the mailbox's global primary key before group
   resolution.
4. If the row exists, Web first requires the consultation request kind and
   schema. An expired row returns `request_expired` without payload access or
   group resolution. For a live row, Web decrypts it, verifies the same
   requester and origin, and compares the exact canonical tool arguments. Exact
   replay reuses the stored mailbox item and its original group-runtime
   destination. Changed arguments or any identity, kind, or schema collision
   return `request_conflict`. Web never resolves a group again for that request
   identity, even if labels or memberships changed.
5. Only when no row exists does Web resolve the membership and attempt to append
   one encrypted `group.consultation.requested` system-mailbox item with that
   exact identity. Hidden server fields contain the canonical arguments,
   requester, membership generation, originating private conversation and
   accepted-input references, and selected group display label. The model sees
   only the bounded question plus the normal group-visible member identity. The
   exact item id is bound into the mailbox payload's existing encryption AAD.
6. The request identity is also the event id and destination dedupe key, so the
   request has no second identity. The global primary key serializes concurrent
   inserts. A unique conflict is rolled back, globally reread, and verified
   through step 4. If the exact global id is absent, it fails as
   `request_conflict`; it never triggers another append or becomes a
   destination-local duplicate.
7. Web signals the group's existing runtime workflow after commit. The signal
   carries only the mailbox pointer; it is not a second source of truth.
8. Web returns `accepted` after the mailbox append commits or exact live replay
   finds it. Replay re-signals only the stored destination; it never selects a
   replacement group. Exact expired replay returns `request_expired`.

The request mailbox row's existing `expiresAt` field is the sole ten-minute
deadline. Expired work is no longer fetched; pending work that reaches preflight
after expiry is completed without a model call. Metadata remains available for
ordinary mailbox retention, but the encrypted payload follows the existing
fail-closed expiry rule and is not read after expiry. V1 adds no timeout
notification, consultation status endpoint, or sweeper. A later user request
can try again from a new accepted input.

A post-commit runtime-signal failure does not reverse `accepted`. Exact live
replay finds the globally addressed item before membership resolution and
signals that same item again. A later ordinary group-runtime wake processes it
only while it is live; after expiry the normal mailbox projection skips it.

A tool transport timeout after append is safe: the runtime retries only the
same stable request. The global item lookup returns an exact live replay,
`request_expired`, or a conflict. A group rename, leave, rejoin, or
membership-count change cannot redirect that retry.

## Group consultation turn

`group.consultation.requested` uses a dedicated mailbox route. It is not
imported as a group message and does not resume the room's provider session.

Before model work, the group runtime asks Web to recheck the hidden membership
generation, row expiry, active access, group runtime identity, and current write
fence. Invalid or expired work is completed without a model call.

Valid work runs with existing primitives:

- a fresh temporary Codex thread and isolated provider home, discarded after
  the result;
- the normal group-mode system and skill contract;
- the existing read-only Codex sandbox over an OS-enforced read view containing
  only the group workspace and runtime transcript needed for the turn,
  including the conversation history, committed group vault, and group-shared
  data available to a normal group turn; and
- a positive capability profile that can only read that view and emit one
  structured consultation result. Every other model capability is absent.

The fresh session does not resume the room's provider thread. The runtime
assembles its group context from existing durable group sources.

Read-only mode alone is not a read-confinement boundary. Consultation tool
processes inherit no provider credentials, signing material, secret environment
values, unrelated host files, or operational runtime paths. Provider auth and
callbacks remain in the supervising runtime outside the model-visible
filesystem view. A working-directory convention is not sufficient.

Read-only describes the consultation model, not required runtime bookkeeping.
Normal system-mailbox import, pending-item removal, and watermark progress are
checkpointed. Those checkpoints may persist only operational mailbox state;
they cannot persist model-authored group content or the temporary provider home.
Success and terminal membership or expiry outcomes checkpoint that progress so
the request does not replay forever.

The consultation runs inside the group container; it does not copy that read
set into the private container. The read-only sandbox and closed capability
profile prevent canonical mutation or delivery, but they do not make every
group-vault field member-visible. Only the bounded answer crosses containers,
and confidentiality still relies on the whole-room disclosure policy above.

The turn returns one structured result:

```ts
type GroupConsultationAnswer =
  | { outcome: "answered"; answer: string }
  | { outcome: "cannot_answer"; answer?: string };
```

If the runner crashes before the result commits, ordinary mailbox retry may run
the read-only turn again. No consultation-specific lease or running state is
needed.

## Private result flow

The group runtime sends only the request mailbox item id and structured answer
to a narrow signed Web callback. The item id stays outside model output. Web
loads that exact request row's metadata and requires the row's owner to be the
completing group runtime. Expired work receives a terminal acknowledgement
without payload access or result append. Only for live work does Web decrypt
the original payload; the completing runtime therefore cannot replace its
requester, membership generation, origin, question, or row expiry.

Web:

1. binds the completing runtime, checks its current write fence, and verifies
   the exact request-row owner, kind, schema, and metadata;
2. returns terminal success without decryption when the row is expired;
3. for live work, decrypts the payload, derives the deterministic private result
   event id, and returns success when that exact result item already exists;
4. rechecks the exact membership generation for a new result;
5. bounds the stored question and structured answer;
6. revalidates the stored member-owned private conversation and resolves its
   private return route;
7. appends one encrypted `group.consultation.completed` system-mailbox item to
   the private runtime; and
8. returns success only after that append commits.

The result event id is derived from the stored request mailbox item id. Existing
mailbox dedupe makes the first committed result win. If a lost callback response
causes another model run with a different answer, the duplicate result append
does not replace or deliver it. A result committed before expiry is already
durable even if its callback response is lost; an after-expiry retry returns the
generic terminal outcome without decrypting the request again.

The group request is completed and its mailbox progress checkpointed only after
result append succeeds, returns the existing duplicate, or reaches a terminal
membership or expiry failure. If no safe private route exists, result append
remains retryable until the request's `expiresAt`, then the answer is suppressed.

The private result wake separates trusted routing from untrusted data:

```ts
type GroupConsultationCompleted = {
  route: ServerResolvedPrivateRoute;
  origin: HostedGroupConsultationOrigin;
  data: {
    groupDisplayName: string | null;
    originalQuestion: string;
    result: GroupConsultationAnswer;
  };
};
```

`HostedGroupConsultationOrigin` is the strict wire type owned by
`packages/hosted-execution`; the engine maps it to and from its local tool-scope
type at the boundary.

The origin contains no return route. To resolve one, Web loads the exact stored
personal inbound mailbox item or items referenced by `inboundMailboxItemIds`,
verifies that they belong to the requester and the same user-authored direct
conversation, decrypts them, and invokes the existing channel-specific resolver
for that conversation. The opaque conversation and recipient identities must
match. Web never substitutes the member's current notification route.

The private runtime uses `origin` to load its own durable accepted input and
private context without sending either to the group. It requires the input to
belong to the same personal runtime and a user-authored direct conversation;
missing, stale, foreign, or non-direct origins fail closed. Fixed
server-authored instructions supply `data` as quoted untrusted context, never as
`assistant.notification.requested.instructions`. It runs a positive output-only
profile that can read the bound private origin and context and emit one reply on
the server-bound route. Every other model capability is absent.

The reply is bound to the verified originating private conversation, not a
model-selected or merely current route. It does not persist the original
invocation's route grant: Web re-derives current authority for that stored
conversation at completion. If the origin is no longer safely replyable or the
accepted input is unavailable, the answer is suppressed instead of being
retargeted. If newer messages intervened in the same conversation, private
Murph introduces the answer as a delayed group result. Existing private-outbox
idempotency owns channel-delivery retries; consultation adds no delivery ledger.

## Bounds and retention

- group label: 120 Unicode code points
- question: 1,200 Unicode code points
- answer: 4,000 Unicode code points and 1,500 output tokens
- request lifetime: ten minutes
- consultations per accepted private input: one
- consultation depth: one
- attachments: none

Both runtimes use their existing active-access and AI-usage gates. The group
model call records usage against the group runtime through existing usage
fields. V1 adds no requester usage field, quota table, subscription, or billing
state.

Question and answer bodies traverse authenticated TLS callbacks and the model
provider boundary. Within Murph-owned storage, durable copies may exist only in
encrypted mailbox payloads and bounded encrypted runtime operational state used
to process those payloads. They do not enter a normalized Web row, projection,
analytics, or logs. Provider processing and retention follow the existing
runtime-provider contract.

The result may remain in ordinary private provider and channel history after
delivery. Leaving later cannot erase that delivered copy. Existing mailbox,
workspace, and account-deletion retention owners remove undelivered operational
copies; there is no consultation-specific cleanup owner.

## Non-goals

- A group-context projection or reverse Vault Share grant
- A consultation database table, status API, timeout workflow, or sweeper
- General agent discovery, messaging, delegation, or recursion
- Synchronous cross-runtime RPC or runtime coordination locks
- Mounting or decrypting one runtime's workspace inside another
- Copying group chat history into a personal prompt or vault; full read access
  stays inside the group runtime and only the bounded answer crosses
- Consulting several groups from one accepted input
- Model-authored group-content mutation or sending anything into the group chat
- A new per-member ACL system inside group knowledge
- Hard semantic detection of private facts inside free text

## Implementation ownership

- `packages/assistant-engine`: closed tool action, use policy, isolated group
  turn, and output-only private result turn
- `packages/hosted-execution`: two strict mailbox event contracts, the wire
  origin type, parsers, and builders
- `packages/assistant-runtime`: request/result mailbox routing and turn profiles
- `apps/web`: automatic membership resolution, the narrow source-bound mailbox
  append using the existing global item id, preflight and completion checks,
  private-route resolution, and idempotent result append
- `apps/cloudflare`: signed transport, runtime write-fence checks, and runtime
  signaling

Do not add another state owner unless implementation proof shows that existing
mailbox dedupe, expiry, retry, and retention cannot preserve this contract.

## Deployment compatibility

1. Deploy both mailbox parsers and consumers, the isolated turn profiles, and
   signed callbacks with production disabled.
2. Deploy Web resolution and producer code disabled.
3. Prove warm runner convergence and both event paths.
4. Enable the Web producer.

Web must not emit a request to a runner that cannot parse it. Disable the
producer or roll Web back before rolling the runner below the new contract.
No database migration is required. The mailbox store gains only an explicit-id
append path; ordinary append behavior continues to generate random ids.

## Direct proof

At minimum, verify:

1. One membership and one exact label resolve without a membership id or list
   call; a nonmatching explicit label never falls back.
2. Multiple, duplicate, unnamed, and truncated membership sets produce safe,
   truthful clarification without ids or roster data.
3. Only a personal direct user turn can consult, and every model-supplied
   identity, route, attachment, and callback field is rejected.
4. Exact live request replay deduplicates while changed arguments under the same
   accepted-input key conflict; expired replay returns only `request_expired`.
   After the first commit, a rename, leave, rejoin, label collision, or
   membership-count change cannot append to another group.
5. Foreign runtimes, ended membership generations, expired requests, and later
   rejoins cannot authorize work or result delivery.
6. The group turn uses a fresh thread, normal group-mode context, the full
   intended group-data read set, an OS-confined read-only sandbox, and a
   read-result-only capability profile. Only normal operational mailbox progress
   is checkpointed; no model-authored group content is. A prescription present
   only in group conversation remains answerable, while injected instructions
   cannot read a canary outside the view or recover an environment secret.
7. Prompt injection in the question, group knowledge, or answer never gains
   developer-instruction or outbound-tool authority.
8. A lost completion response or changed second model answer produces at most
   one private result mailbox item.
9. The result reloads and decrypts the stored originating inbound item,
   revalidates its member-owned private route, and can never fall back to a
   current notification route, the group route, or another member.
10. Request expiry needs no timer or status row. Expired payloads remain
    unreadable, and a late completion reveals no answer.
11. Question and answer bodies stay out of normalized rows, projections, logs,
    and analytics.
12. No group message, reaction, typing event, memory write, or model-authored
    canonical group-content mutation occurs.
