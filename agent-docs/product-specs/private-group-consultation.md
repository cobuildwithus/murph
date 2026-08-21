# Private-to-Group Murph Ask

Status: Implemented

Last verified: 2026-08-21

## Decision

Add one durable **Assistant Ask** primitive:

```text
one authorized Murph asks another context's Murph one question
the target Murph reads its own context and returns one bounded answer
```

The first use is personal Murph asking a joined group Murph for group-owned
context. It is a real agent-to-agent request/reply, not private Murph reading
group files. The group runtime receives the question, runs its own Murph, and
owns the answer.

Use three small layers:

1. `murph.group(action="ask")` is the product action.
2. `assistant.ask.requested` and `assistant.ask.completed` are the generic
   encrypted mailbox protocol.
3. `executeReadOnlyAssistantAsk` is the target-owned, one-shot, read-only Codex
   execution primitive.

Keep the protocol generic but admission typed. The first target adapter is
`joined_group`. A future context type may reuse Assistant Ask only after adding
its own server-side resolver, authorization fence, disclosure policy, and
context builder. There is no arbitrary runtime-id escape hatch.

Do not reuse `assistant.notification.requested` for the answer. A notification
contains privileged instructions and delivery intent; an Assistant Ask answer
is untrusted correlated data. The paired completion event keeps data separate
from authority and lets a future caller consume an answer without pretending
it is a notification.

Do not add a context projection, agent registry, general message bus, database
table, workflow, timer, second container, cross-workspace mount, or
same-process Codex multiplexer.

## Separate target-authored group handoff

Assistant Ask remains the read-only consultation primitive above. A member may
also explicitly ask their private Murph to **post bounded verified context into
one joined group**. That is a separate `murph.group(action="handoff")` action,
not a result-routing mode for Assistant Ask.

Web binds one fresh accepted private input to one exact current membership
generation and the synthetic group runtime's current thread route. It appends
one expiring, deterministic `assistant.notification.requested` wake to that
group. The target group Murph receives the context as JSON-quoted untrusted data
with prompt-delimiter characters Unicode-escaped, uses its own committed group
conversation and tone, and authors one ordinary group message through the
existing notification and outbox owners.

The model supplies only `context` and an optional visible `groupLabel`. It never
supplies member, membership, runtime, thread, route, provider, callback,
idempotency, or mailbox identifiers. Exact replay reuses one global event/item
identity derived from the authenticated member and accepted input, decrypts and
validates the stored notification, and retains its pinned membership and route
even if the member's group count changed. Changed context, membership
generation, target group, or route conflicts instead of redirecting. `accepted`
proves only that the target mailbox item is durable.

The target turn uses the conversation prompt with an isolated output-only
provider thread. It has no tools, private-vault access, filesystem capability,
follow-up effect, recursion, or second delivery protocol. Fresh foreground
conversation input still preempts it, while the exact bounded handoff family may
run before the normal idle-checkpoint floor so it cannot starve indefinitely.

Do not add a table, queue, workflow, callback registry, delivery ledger, target
selector API, or generalized cross-context message type for this action.

## Smallest complete contract

The model-facing action is:

```ts
type AskGroupArguments = {
  action: "ask";
  question: string;
  groupLabel?: string;
};
```

The model supplies no member, membership, runtime, mailbox, session, callback,
or return-route identifier. Web derives all authority and routing from the
authenticated caller and stored request.

The target execution surface is:

```ts
executeReadOnlyAssistantAsk({
  workspaceRoot,
  question,
  requesterParticipantId,
  abortSignal,
}): Promise<ReadOnlyAssistantAskResult>

type ReadOnlyAssistantAskResult =
  | { outcome: "answered"; answer: string }
  | { outcome: "cannot_answer"; answer?: string };
```

The target runtime supplies its already restored workspace root and the
server-bound requester membership `participantId` after Web has revalidated the
request. That id is the exact `read_shared` identity for first-person references
such as “my”; the child must not infer identity from display name, handle, or
member order, and must return `cannot_answer` if it cannot bind the needed
evidence to the exact participant. The id is opaque context and is never
disclosed in the answer. The wrapper fixes the system contract, committed
conversation evidence, empty working directory, read-only permission profile,
and capability-free child configuration. The executor owns no routing,
persistence, membership, retry, or delivery state. Those remain with their
existing owners.

```text
private message
  -> private Murph asks
  -> Web resolves a current membership
  -> assistant.ask.requested enters the group mailbox
  -> isolated read-only group Murph answers
  -> assistant.ask.completed enters the bound private mailbox
  -> private Murph combines the answer with private context and replies
```

V1 is one asynchronous question and one answer, one hop deep. It has no
streaming, broadcast, recursion, autonomous follow-up, or target-side action.

## Final UX

Happy path:

> **Member:** Build my hotel workout around today's 100 Club exercises.
>
> **Private Murph:** I'm checking privately with 100 Club's Murph now — nothing
> will be posted there.
>
> **Private Murph, later:** Got it — today's group work is squats plus the
> pelvic sequence. Here's the hotel version...

If private messages intervene, the answer begins naturally, for example:
`quick follow-up from 100 Club...`.

- One joined group: choose it automatically.
- Several groups plus one exact label match: choose it automatically.
- Ambiguous: ask once using safe visible labels, such as
  `Which group did you mean: 100 Club or Wednesday Training?`
- No groups: offer the existing paste-or-screenshot fallback.
- Duplicate or unnamed labels: fail closed and ask the member to name or
  rename one; never expose an id.
- Cannot answer: say the group context was insufficient.
- Admission transport failure: return only an allowlisted Prisma `P####`
  diagnostic code when present, HTTP status, and opaque Assistant Ask request
  id so support can correlate the failed attempt. Do not expose raw database,
  provider, mailbox, question, answer, or routing details.
- Write request: explain that private Murph may ask and read but cannot post or
  change anything in the group.
- Membership ends, the request expires, or the original private route is no
  longer safe: suppress the answer.

There is no timeout notification or status UI. A later user message may retry.
Nothing is posted, reacted to, or shown as typing in the group.

## Routing, authority, and disclosure

Web owns target resolution because it owns current `HostedGroupMember` truth.

1. Allow `ask` only from fresh user-authored input in an authenticated personal
   direct turn, once per accepted input.
2. With one current membership and no label, select it.
3. With a label, normalize it and current display labels using Unicode NFC,
   trimming, whitespace collapse, and locale-independent lowercase matching.
   Preserve punctuation
   and emoji; select only one exact match.
4. Otherwise return a bounded set of visible labels for clarification.
5. Require a valid current synthetic group-runtime identity before accepting
   the ask. The runtime may be cold; the committed request wakes it.

Never fuzzy-match, pick the newest or owned group, inspect roster identities to
guess, or fan out. `list_memberships` is not required, and the model never
receives a membership id for an ask.

The exact membership row is a hidden generation fence. Web checks it at
admission, before the target reads context, and before appending the answer.
Leave and rejoin creates a new generation, so old work cannot cross it. Target
completion also requires the exact group runtime and its current write fence.

Membership permits the same class of read the member could request in the
room. The answer must be safe to post to the whole group. This reuses the
room's disclosure boundary rather than adding per-member ACLs.

The target may read the full committed group conversation, committed group
vault and challenge state, and server-approved group-shared projections already
visible in that runtime. It may not read another member's private Murph or
vault, unshared health data, other workspaces, operator state, secrets,
permission metadata, routes, provider sessions, or runtime internals.

Only the smallest standalone question crosses from private to group. Private
history, attachments, contacts, private vault data, and return routing do not.
If the question needs a fact from earlier private context, private Murph asks
for explicit consent first. The question, group context, and answer are quoted
untrusted prompt data, never developer instructions.

## Durable request/reply lifecycle

The request and completion mailbox items are the only durable operation state.

### Request admission

1. The runtime supplies a stable server-owned scope for the accepted private
   input.
2. Web derives an opaque global request id from the authenticated requester and
   that scope, then looks it up before resolving a group.
3. An exact retry reuses the stored request and pinned destination. Changed
   arguments conflict. Rename, leave, rejoin, or membership-count changes
   cannot redirect the same accepted input.
4. For a new id, Web resolves the membership and appends one encrypted
   `assistant.ask.requested` item. Its item id, event id, and dedupe key are the
   same value.
5. Hidden server fields bind origin, membership generation, destination, and
   expiry. The target model sees only the bounded question and normal
  group-visible question.
6. Web signals the existing group runtime after commit. `accepted` means
   durable, not answered.

The signed Web response carries the deterministic opaque request id in an
Assistant-Ask-specific response header, including for sanitized error
responses. A failed response may additionally carry only an allowlisted Prisma
`P####` code in its own diagnostic header. Those values are diagnostic
correlation only: callers may display them after a failure, but Web never
accepts them from the model or uses returned headers as authority.

This needs one narrow mailbox-store seam that accepts a server-derived item
id. It needs no new table or schema migration.

### Target execution and completion

Before reading, the group runtime rechecks expiry, membership generation,
target identity, and write fence. It runs one isolated ask and submits only the
request id plus structured answer through a narrow signed callback.

Web loads the original request, repeats the checks, derives one stable
completion id, and appends `assistant.ask.completed` to the original private
runtime. The target never receives a callback address or private route. The
request is acknowledged only when the completion is durable, already exists,
or is terminally expired or unauthorized.

If a lost callback response causes another model run, completion dedupe makes
the first committed answer win. Existing mailbox pending, retry, backoff,
expiry, checkpoint, and retention mechanisms own the rest; there is no
consultation lease, result table, or delivery ledger.

### Private continuation

The private runtime verifies the server-bound origin, reloads the original
accepted input and current private context, and treats the answer as untrusted
data. It may emit one reply on the revalidated original private route. The
delayed turn has neither Assistant Ask nor side-effecting tools; a later user
message can authorize more work.

If private Murph is already replying, the completion waits in the normal
mailbox and becomes a later follow-up. It never steals foreground authority.

A legacy joined-group `cannot_answer` is not provider-authored private copy. The
private runtime queues the fixed unavailable-evidence response exactly and does
not let another model reinterpret it as an expiry, provider error, or execution
failure.

After Web durably appends either side of the joined-group request/reply pair, it
signals the existing Temporal runtime workflow. Only after that signal is
accepted may Web issue the existing payloadless, no-retry direct
`ensure-processing` request as a latency hint. Temporal remains the sole durable
wake/retry owner. A dirty runtime may admit joined-group requests and legacy
joined-group completions through the existing pre-checkpoint-safe system prefix;
consented requests and reviewed completions remain checkpoint-gated. Completion
admission is still ordered against personal input using a read-only pending
index proof and fails closed on incomplete or invalid evidence. After fresh
personal input gets first priority, the existing bounded foreground pass loop
drains each progressed safe causal item before the idle checkpoint and stops on
no progress, retryable failure, cancellation, or mailbox-budget exhaustion.

## Foreground group lifecycle

One mailbox feeds two deliberately different execution lanes:

- the resident foreground Murph is the sole model-authored canonical-content
  writer and outbound sender; and
- at most one isolated, preemptible Assistant Ask reader may run beside it.

Trusted runtime owners still persist ordinary mailbox and process bookkeeping.

If group Murph is already replying when an ask arrives:

1. Its resident process keeps the active root turn, provider session,
   invocation-scoped tool authority, and outbox authority.
2. The existing mailbox watcher imports the ask.
3. A tiny detached controller starts a separate one-shot App Server process
   without awaiting it on the foreground path.
4. Foreground messages continue to start, steer, and deliver normally. The
   child cannot write, send, react, type, steer, or signal-interrupt the
   resident process.
5. More asks stay pending. When the child settles, the controller calls the
   same non-awaiting `kick()` once to claim the next due ask, if any. The
   existing mailbox remains the queue.
6. New foreground work does not cancel or await the child; the processes and
   authorities are independent.
7. Before invocation return, checkpoint, shutdown, fence loss, or workspace
   replacement, the runtime interrupts the exact child, waits for a bounded
   grace period, terminates only that proven-owned process if necessary,
   requeues its item, proves exit, and only then releases the workspace.

A controller owns only one promise and one `AbortController`, not a pool,
scheduler, lease, or persisted state. A child failure cannot interrupt,
replace, or poison the resident App Server.
This is the narrow answer to the larger mailbox-concurrency issue: one serial
writer lane plus one read-only ask lane, not general parallel mailbox
execution.

## Native Codex confinement

Use the existing `CodexAppServerProcess` plus Codex's native App Server and
permission-profile fields. Do not build a Murph sandbox.

The one-shot thread uses:

- the named `murph-group-read` permission profile;
- the exact group root in `runtimeWorkspaceRoots`;
- a fresh supervisor-owned empty working directory, not the group root;
- `ephemeral: true` using the trusted hosted Codex home; and
- native schema-constrained output on `turn/start`.

The hosted home contains the named profile and the minimum auth/config needed
by the App Server. On the pinned Codex version, request-level `permissions`
becomes the session `default_permissions` override even when the lower hosted
config retains its ordinary legacy sandbox default. The isolated request never
passes legacy `sandbox`, because request-level `permissions` and `sandbox` do
not compose. Assert the effective profile, roots, working directory,
instruction sources, and approval policy before model work, and fail closed on
any mismatch.

The named profile must OS-enforce read access only to Codex's `:minimal`
runtime and the exact `:workspace_roots`, no writes, explicit denial of
`.runtime/**`, environment files and operational paths, no other workspace or
operator-home access, no tool network, and approval policy `never`.

The child's only hosted dynamic tool is the consent-aware lazy
`murph.group/read_shared` read. It receives no mutation, delivery,
invocation-scoped automation, device-control authority, signing material,
memories, plugins, MCP servers, apps, web search, or multi-agent capability.
Project config and instruction discovery are
disabled, so a target workspace `.codex/config.toml`, hook, or skill cannot
expand behavior. Set
`shell_environment_policy.inherit = "none"` with only a tiny benign allowlist;
model-run commands cannot inherit provider credentials. A trusted group
context builder supplies the target system contract and committed transcript;
built-in read commands remain OS-confined.

The pinned App Server marks `permissions` and `runtimeWorkspaceRoots`
experimental. Initialize the child with `experimentalApi = true`, pin this
integration to the bundled Codex version, and verify its generated protocol
schema so an upgrade cannot silently drop either field.

Implement one small wrapper around the existing process and event parser with
exact process ownership and `try/finally` cleanup. Do not add another adapter or
process pool. Same-process multiplexing is rejected because the current adapter
has one scalar active turn and process-wide interruption. A Codex subagent is
also wrong because it would belong to the foreground session instead of the
target runtime.

Feature enablement requires a production-like runner test proving that the
named profile is enforced by the Linux sandbox. If it fails, fail closed and
fix the existing runner image or native Codex configuration. Do not substitute
prompt rules, prefix checks, or a custom wrapper.

## Read consistency

Read the currently restored live group workspace. Do not create a snapshot,
copy, projection, mount, or read lock.

This is a best-effort, non-transactional read. It may observe committed files
from slightly different moments and cannot see words the resident Murph is
currently generating but has not committed. That tradeoff is accepted. A
transient unreadable input retries through the mailbox rather than adding
coordination machinery.

If evidence later proves an immutable view necessary, it can replace the read
implementation behind `executeReadOnlyAssistantAsk` without changing the product
action or mailbox protocol.

## Bounds and retention

- group label: 120 Unicode code points
- question: 1,200 Unicode code points
- answer: 4,000 Unicode code points
- request lifetime: ten minutes
- asks per accepted private input: one
- ask depth: one
- detached asks per target runtime: one
- attachments: none

Expiry is the only deadline. There is no timer, sweeper, status endpoint, or
timeout message. Raw question and answer payloads may persist only in encrypted
mailbox data and bounded encrypted processing state, never normalized rows,
analytics, or logs. After private Murph uses the answer, its composed reply
follows ordinary private-conversation, provider, and channel retention.
Existing mailbox, workspace, and account rules remain authoritative.

## Implementation plan

### 1. Contracts and admission

- `packages/hosted-execution`: add strict `assistant.ask.requested` and
  `assistant.ask.completed` contracts, limits, origin binding, parsers,
  builders, and wake identities.
- `packages/assistant-engine`: add `murph.group(action="ask")` and the fresh
  personal-input/one-ask policy.
- `apps/web`: add automatic membership resolution, stable request-id replay,
  the narrow explicit-id append, target preflight, and idempotent completion.

### 2. Isolated execution

- `packages/assistant-engine`: extend the existing App Server request builder
  with `permissions`,
  `runtimeWorkspaceRoots`, `ephemeral`, and `outputSchema`.
- Reject native `permissions` plus legacy `sandbox`.
- Add `executeReadOnlyAssistantAsk` with exact child cleanup.
- `packages/assistant-runtime`: own the `murph-group-read` profile and minimal
  child environment.
- `apps/cloudflare`: add no coordinator; change only the existing runner
  bundle/image contract if the native sandbox proof requires it.

### 3. Target background lane

- `packages/assistant-runtime`: route `assistant.ask.requested` out of ordinary
  serial system-message
  execution and into one invocation-local detached controller.
- Kick it after initial mailbox restore and late request import.
- Reuse existing pending, retry, backoff, expiry, cancellation, checkpoint,
  usage, and fence owners.

### 4. Private completion

- `packages/assistant-runtime` and `packages/assistant-engine`: consume
  `assistant.ask.completed` as correlated untrusted data.
- Reload the bound accepted input and private context.
- Run one output-only continuation on the original revalidated route with the
  UX above.

### 5. Rollout

- Deploy disabled target consumers, native permission configuration, and
  completion handling first.
- Deploy the disabled Web producer second.
- Prove the production sandbox and warm-runtime convergence, then enable the
  producer.
- Update `ARCHITECTURE.md`, `agent-docs/SECURITY.md`,
  `agent-docs/RELIABILITY.md`, and the testing map with implemented behavior in
  the same code change.

No database migration is required. Rollback disables the producer first, lets
requests drain or expire for ten minutes, then rolls back consumers.

## Required proof

1. Automatic/exact-label resolution works; ambiguous, duplicate, unnamed, and
   truncated sets reveal safe labels only.
2. Model-supplied identities, destinations, callbacks, and routes are rejected.
3. Retry cannot retarget after rename, leave, rejoin, or membership changes.
4. Only a fresh personal direct input can ask, once, at depth one.
5. A group foreground turn continues while an isolated ask succeeds or fails;
   the resident process is never interrupted or poisoned.
6. Checkpoint, shutdown, fence loss, and workspace replacement cancel and
   requeue exact owned work before releasing its root.
7. Intended committed group context is readable, while writes, `.runtime/**`,
   other roots, secrets, and tool network are OS-denied; invocation-scoped
   automation and device tools are absent.
8. Prompt injection cannot gain instruction, write, network, delivery, or
   recursion authority.
9. Duplicate callbacks/model runs yield one completion and private follow-up.
10. Completion is bound to the original private conversation; leave, expiry,
    or an unsafe route suppresses it.
11. No group message, reaction, typing, session mutation, memory write, or
    model-authored canonical mutation occurs.
12. The exact requester membership id—not a display name or ordering guess—binds
    first-person group reads, and it never appears in output.
13. A typed `cannot_answer` delivers only the fixed unavailable-evidence copy
    and cannot be restated as expiry or failure.
14. Request and completion direct wakes start only after Temporal acceptance;
    dirty-runtime admission bypasses the idle checkpoint only for the exact safe
    joined-group shapes and never overtakes older personal input.
15. Question and answer content stays out of normalized rows, logs, and
    analytics.

The production-faithful concurrency test pauses an active group provider turn,
imports an ask, starts the child, delivers a new group message, and proves both
the group reply and private completion. A second test kills only the child and
proves foreground continuity plus mailbox retry.

## Final tradeoffs

No product question blocks implementation.

| Decision | Default | Accepted cost |
| --- | --- | --- |
| Transport | Async paired mailbox events | The answer may arrive later. |
| Target Murph | Fresh target-owned session | No uncommitted resident output. |
| Isolation | Cold one-shot process | Startup latency and process cost. |
| Read view | Live, non-transactional workspace | Slightly mixed freshness. |
| Concurrency | One detached ask per runtime | Further asks wait. |
| Capability | Read and answer only | Later input authorizes actions. |
| Expiry | Silent after ten minutes | No progress or timeout UI. |

The only hard technical gate is proving the named Codex filesystem profile in
the real production runner image. That is verification, not a new product
decision. Additional target types, higher concurrency, writes, or multi-turn
agent conversations require later evidence and a new authorization review.

## Non-goals

- Arbitrary assistant discovery or model-selected destinations
- General command bus, synchronous RPC, streaming, broadcast, or recursion
- Target writes or any visible group activity
- Projection, snapshot, cross-runtime mount, or copied transcript
- New table, queue, scheduler, workflow, timer, lease, or Durable Object
- Shared warm Codex process, provider thread, or interruption domain
- Process pool, priority manager, or general mailbox concurrency engine

## Platform references

- [Codex App Server](https://learn.chatgpt.com/docs/app-server.md)
- [Codex sandboxing](https://learn.chatgpt.com/docs/sandboxing.md)
- [Codex permissions](https://learn.chatgpt.com/docs/permissions.md)
- [Cloudflare container architecture](https://developers.cloudflare.com/containers/platform-details/architecture/)
- [Cloudflare container process execution](https://developers.cloudflare.com/containers/execute-commands/)
