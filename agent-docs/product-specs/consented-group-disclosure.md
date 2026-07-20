# Consented Group-to-Member Disclosure

Status: Implemented

Last verified: 2026-07-20

## Decision

Add one narrow composition of the existing Assistant Ask protocol:

```text
an authenticated group Murph receives one trusted invocation
it asks one current member's private Murph one bounded question
under that member's exact active disclosure grant
the private Murph proposes one answer
one fresh outgoing reviewer either allows those exact bytes or denies them
```

Consent, invocation, and delivery are separate authorities. The grant is standing,
revocable consent. An accepted group input or a claimed scheduled automation
occurrence supplies one request's causal and replay identity. An accepted-input
answer is delivered exactly to its group conversation; a scheduled answer resumes
the current canonical automation through the existing controlled group
notification path.

Group membership is necessary but never sufficient. The member must separately
grant the exact immutable natural-language permission shown in the room. The
group can then ask only through the opaque grant selector Web returns for that
member and permission.

This is an AI-mediated disclosure boundary, not raw group access to a personal
vault. Deterministic Web authorization establishes who may ask, which member
may answer, and which immutable permission applies. The models only produce and
review the candidate disclosure inside that boundary.

## Product flow

1. During an authenticated group-chat turn, group Murph calls
   `murph.group(action="post_disclosure_request")` with one concise
   `permissionText`.
2. Web canonicalizes that exact text and posts a server-owned consent message;
   after Linq returns its provider message id, Web stores and binds the
   permission to the current group and exact provider message. A stable request
   id binds the current group and trusted accepted input without private text. A
   separate domain-separated provider idempotency key hashes the group id, trusted
   accepted-input id, and exact public consent-message bytes, so exact retries
   dedupe while changed text cannot inherit an earlier provider message id. The
   stored encrypted text plus its group-scoped, server-keyed, versioned blind
   index then bind that request to the exact provider message. The model does
   not write the consent copy.
3. An already-current member grants the permission only by adding the exact
   Like reaction to that exact Murph-authored message. Web derives the actor
   from the verified route and live roster, then creates a new per-membership
   grant. Only the provider reaction token `like` counts; love, heart,
   thumbs-up, and custom emoji do not. Liking never creates or restores group
   membership.
4. `read_current` exposes each active grant to the group runtime as an opaque
   `grantId` beside the exact `permissionText` and bound member. The selector is
   authority metadata, not a fact supplied by a person or model.
5. During either a fresh accepted group input or a claimed scheduled group
   automation occurrence, group Murph calls `murph.group(action="ask_member")`
   with one self-contained question and the exact `grantId` returned by the
   current read. Trusted runtime code injects the invocation origin, and
   delivery behavior is derived from that origin; the model supplies neither.
   For a claimed canonical schedule, the initial notification receives the
   existing group port only after route authority proves a non-direct thread;
   runtime-minted scheduled invocation authority is required for the turn to
   retain it.
   One invocation owns at most one request per
   grant. Exact retry reuses it, while a changed question for that grant
   conflicts. The same occurrence may ask other grants independently.
6. The member's private runtime runs one read-only candidate pass against its
   restored workspace. A separate fresh-context pass reviews only the immutable
   permission text, incoming question, and proposed answer.
7. An accepted-input answer returns to the originating group conversation
   byte-for-byte. A scheduled answer re-reads the active canonical automation
   and current non-direct Linq route, then resumes that automation through the
   ordinary group notification and outbox path with a deterministic key derived
   from the completion. That model decision uses an isolated one-shot thread:
   it reads no conversation or assistant memory and persists no prompt, model
   output, transcript, receipt, session, or provider-resume state. The existing
   outbox remains the only durable delivery owner. The answer is untrusted data,
   not consent for an external action; every available tool still applies its
   existing independent authority checks. Group-safe accountless service tools
   may be available, but the continuation receives no member's connected
   account or private runtime.
   A denied or candidate-declared cannot-answer becomes the fixed
   non-disclosing result. Infrastructure failure retries under the existing
   mailbox policy and may expire without disclosing anything.

In a private conversation, `list_memberships` returns the member's own active
grants in a top-level `disclosureGrants` array. A member may revoke one only
after selecting the exact server-returned `grantId` with
`revoke_disclosure_grant`. These actions are private and self-only. Revocation
prevents future disclosure; it cannot erase an answer already shared with the
group.

## Authority and lifecycle invariants

- A consented request must have one trusted group invocation: either an
  accepted, authenticated, non-direct group route bound to the exact synthetic
  group runtime, or the claimed occurrence of a canonical scheduled automation
  running in that group runtime. Direct, email-derived, unknown, stale, or
  model-supplied invocation data is not authority.
- The scheduled initial-turn group port is operation-scoped, not part of the
  base runtime context. Ordinary notifications and manual, direct,
  unknown-audience, or local cron runs must not receive it.
- The model never supplies invocation, delivery mode, member, membership,
  runtime, mailbox, session, callback, or return-route identity. It may use only
  a current server-issued `grantId` from the live group read.
- One immutable permission record owns the canonical text and digest. One
  append-only grant generation binds that permission to one membership. The
  exact text is encrypted through the existing hosted member private-field
  secure-box under the synthetic group runtime, with AAD bound to the permission
  row and encrypted field. It is decrypted only after the exact group or member
  structure authorizing the read has been established. The digest remains
  bounded operational integrity and replay metadata.
  Materially different permission text requires a new request and Like.
- Permission-post replay succeeds only when the stored group, provider-message
  lookup, text, and digest all match. Each verified provider reaction event
  derives one grant id, so duplicate delivery is idempotent and cannot recreate
  a revoked grant.
- If a provider accepts consent message A but Web cannot bind its row, a changed
  retry B uses another provider idempotency key and may become the sole bound
  permission. The unbound A message is an inert orphan: without a permission row
  its reactions cannot create a grant. This availability/UX residual is
  preferred to adding a pending reservation or second reconciliation lifecycle.
- Permission canonicalization is deterministic: CRLF becomes LF, Unicode is
  NFC, outer whitespace is trimmed, and the result is limited to 1,000 Unicode
  code points. Every Unicode control, format, surrogate, private-use, or
  unassigned code point except LF is rejected before posting. A
  domain-separated, group-scoped, server-keyed, versioned blind index binds
  that exact displayed text through request completion without making common
  permission scopes offline-dictionary-testable or cross-group comparable from
  a database snapshot.
- Web revalidates the exact group, personal runtime, membership generation,
  grant generation, permission digest, origin, expiry, and runtime fence at
  admission, immediately before the personal read, and immediately before
  completion append. Reviewed exact delivery atomically carries that completion
  mailbox id, deterministic delivery key, and authority expiry into the
  existing outbox. For scheduled continuations, that same Web-owned predicate
  runs before model work, immediately before each tool call, and before delivery
  or skip commit. Before expiry the final Linq egress transaction repeats the
  paired request and grant authority check before claiming provider dispatch.
  Missing or malformed outbox proof is terminal before provider entry. When a
  structurally bound completion loses live grant authority or reaches its
  outbox-owned expiry after the reviewed answer was queued, the existing intent
  durably replaces the complete answer payload, including all media, with the
  fixed text-only cannot-answer copy and retries before provider entry. Only
  that exact text with empty media counts as fallback. It remains deliverable
  after retention removes the expired mailbox rows.
- Leave/rejoin creates a new membership generation. Revoke/regrant creates a
  new grant generation. Old requests cannot cross either boundary.
- Request identity is the group runtime, exact grant, and trusted invocation.
  One invocation therefore owns at most one question per grant. Exact replay
  reuses it; a changed question conflicts; a different grant in the same
  invocation and the same grant in a later occurrence are independent. There is
  no implicit roster fan-out, label matching, fallback member, or arbitrary
  target id.
- The existing ten-minute Assistant Ask lifetime, deterministic request and
  completion ids, encrypted mailbox retry, first-committed-completion rule, and
  outbox-owned queued-delivery deadline own durability. Retried work cannot
  select a new target or permission.
- Candidate and reviewer provider usage uses the existing hosted usage ledger.
  Request, claimed attempt, answer/review stage, and provider ordinal form the
  deterministic identity; usage recording is best-effort and cannot change or
  retry the disclosure outcome.

The permission and grant rows are queryable product truth owned by
`apps/web`/Postgres. The paired `assistant.ask.requested` and
`assistant.ask.completed` mailbox items own the active operation; once an exact
completion is queued, the existing outbox owns only its pending delivery and
minimum immutable expiry proof through terminal disposition. Mailbox retention
may delete expired rows without ordering against that outbox obligation. The
personal vault, group vault, runner, and assistant session do not gain another
permission store.

Permission text is bounded to 1,000 code points. Each group may retain at most
25 permission rows, and grant-generation history is capped at 25 per group and
25 per member under the existing group/member locks. Exact request and reaction
replays resolve before the history counts, so they remain idempotent at the
cap; only a fresh row returns `limit_reached`. Live group/member projections
also return at most 25 active grants. Authority and replay use the existing
indexed permission id, provider-message lookup, membership, and
permission/grant relations; immutable history is not copied into hosted
workspace snapshots or mailbox payloads. Rows remain retained for the owning
group's lifetime and cascade with group/account deletion; no retention
scheduler is introduced.

Complete group summaries include active disclosure grants on `read_current`,
`create_join_link`, `post_join_offer`, and `update_display_name`. Those actions
therefore depend on opening permission text through the group secure-box. Join
link/offer creation reads the summary inside its existing transaction before
provider send. Display-name mutation opens the summary before renaming the Linq
chat, then performs the existing provider-first name update and database write
using that operation-start snapshot; a missing decrypt key cannot rename the
provider chat and then fail solely while building the disclosure summary.

## Disclosure review

There is deliberately no incoming model reviewer. Authorization, freshness,
payload shape, and size are deterministic code checks; the candidate model is
also instructed to treat the permission, question, and vault evidence as
untrusted data.

The sole model safety gate is the outgoing reviewer:

- It runs as a separate read-only one-shot child with fresh context, an empty
  workspace root, and no access to the member's vault, conversation history,
  application tools, delivery route, network, or other runtime authority.
- It receives only the exact immutable permission text, the bounded incoming
  question, and the proposed answer. The question is required context because
  even `yes` or `no` can reveal the premise of a question.
- It returns only `allow` or `deny`. It never rewrites, redacts, explains, or
  repairs an answer.
- It allows only when every type of information disclosed by the answer is
  clearly inside the permission. Ambiguity denies.
- Invalid output, refusal, timeout, provider failure, revocation, stale
  authority, or failed completion revalidation fails closed. A denied candidate
  is never written to Murph durable state or operational logs, delivered, or
  included in an error.

This keeps the user-facing permission text as the single disclosure policy. It
does not introduce an incoming classifier, prompt-injection service, policy
DSL, rewrite loop, or chain of reviewers.

## Explicit non-goals

- No broad vault browse or group-mounted personal workspace.
- No membership-implied access or owner override.
- No write access to the member's vault or side-effecting target tools.
- No multi-member query, implicit fan-out API, aggregation service, or broadcast.
  A normal group automation may call the one-to-one primitive repeatedly under
  one bounded occurrence.
- No new scheduler. Existing group-runtime automations own recurring wakeups.
- No new queue, workflow, service, container, result table, policy engine, or
  general cross-agent registry.

Add those only for a concrete product need with a separately reviewed authority
and disclosure contract.

## Rollout and rollback

Deploy Web support for scheduled use of the existing completion-derived
reviewed-delivery key first with the producer gate off. Then deploy Cloudflare/runner support for the
new `consented_member` request target, trusted accepted-input and
scheduled-automation origins, disclosure-context preparation, reviewed exact
group delivery, and canonical scheduled continuation before Web may emit new
work.
Keep `HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED` unset or `0` through that
deployment and the runner fingerprint/confinement smoke. The synchronous
history caps satisfy the cardinality prerequisite; enable exact `1` only after
both planes have converged and smoke has passed.

Rollback disables and redeploys the Web producer first. Keep compatible
consumers deployed until every consented request and accepted-input or automation completion
has drained from Web mailboxes, imported runtime state, and existing outbox
obligations. Prefer a forward fix once new work has been produced.
