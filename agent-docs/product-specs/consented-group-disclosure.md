# Consented Group-to-Member Disclosure

Status: Implemented

Last verified: 2026-07-16

## Decision

Add one narrow composition of the existing Assistant Ask protocol:

```text
an authenticated group Murph asks one current member's private Murph
one bounded question under that member's exact active disclosure grant
the private Murph proposes one answer
one fresh outgoing reviewer either allows those exact bytes or denies them
```

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
2. Web canonicalizes and stores that exact text, binds it to the current group,
   and posts a server-owned consent message. A stable request id and provider
   idempotency key bind the current group, trusted accepted input, and exact
   permission digest. The model does not write the consent copy.
3. An already-current member grants the permission only by adding the exact
   Like reaction to that exact Murph-authored message. Web derives the actor
   from the verified route and live roster, then creates a new per-membership
   grant. Only the provider reaction token `like` counts; love, heart,
   thumbs-up, and custom emoji do not. Liking never creates or restores group
   membership.
4. `read_current` exposes each active grant to the group runtime as an opaque
   `grantId` beside the exact `permissionText` and bound member. The selector is
   authority metadata, not a fact supplied by a person or model.
5. For a fresh accepted group input, group Murph calls
   `murph.group(action="ask_member")` with one self-contained question and the
   exact `grantId` returned by the current read. Web resolves all member,
   membership, runtime, route, mailbox, and callback identity. That accepted
   input owns at most one request; another grant or question requires another
   fresh group input.
6. The member's private runtime runs one read-only candidate pass against its
   restored workspace. A separate fresh-context pass reviews only the immutable
   permission text, incoming question, and proposed answer.
7. An allowed answer returns to the originating group byte-for-byte. No later
   model rewrites, summarizes, expands, or contextualizes it. A denied or
   candidate-declared cannot-answer becomes one fixed non-disclosing response.
   Infrastructure failure retries under the existing mailbox policy and may
   expire without disclosing anything.

In a private conversation, `list_memberships` returns the member's own active
grants in a top-level `disclosureGrants` array. A member may revoke one only
after selecting the exact server-returned `grantId` with
`revoke_disclosure_grant`. These actions are private and self-only. Revocation
prevents future disclosure; it cannot erase an answer already shared with the
group.

## Authority and lifecycle invariants

- The originating turn must have an accepted, authenticated, non-direct group
  route bound to the exact synthetic group runtime. Direct, email-derived,
  unknown, stale, or model-supplied routing is not authority.
- The model never supplies a member, membership, runtime, mailbox, session,
  callback, or return-route id. It may use only a current server-issued
  `grantId` from the live group read.
- One immutable permission record owns the canonical text and digest. One
  append-only grant generation binds that permission to one membership.
  Materially different permission text requires a new request and Like.
- Permission-post replay succeeds only when the stored group, provider-message
  lookup, text, and digest all match. Each verified provider reaction event
  derives one grant id, so duplicate delivery is idempotent and cannot recreate
  a revoked grant.
- Permission canonicalization is deterministic: CRLF becomes LF, Unicode is
  NFC, outer whitespace is trimmed, and the result is limited to 1,000 Unicode
  code points. Every Unicode control, format, surrogate, private-use, or
  unassigned code point except LF is rejected before posting. A domain-separated
  v1 SHA-256 digest binds that exact displayed text through request completion.
- Web revalidates the exact group, personal runtime, membership generation,
  grant generation, permission digest, origin, expiry, and runtime fence at
  admission, immediately before the personal read, and immediately before
  completion disclosure.
- Leave/rejoin creates a new membership generation. Revoke/regrant creates a
  new grant generation. Old requests cannot cross either boundary.
- One accepted group input owns at most one request targeting one grant and one
  question. Exact replay reuses it; a different grant, question, or session
  conflicts. There is no implicit roster fan-out, label matching, fallback
  member, or arbitrary target id.
- The existing ten-minute Assistant Ask lifetime, deterministic request and
  completion ids, encrypted mailbox retry, and first-committed-completion rule
  own durability. Retried work cannot select a new target or permission.

The permission and grant rows are queryable product truth owned by
`apps/web`/Postgres. The paired `assistant.ask.requested` and
`assistant.ask.completed` mailbox items remain the only durable operation
state. The personal vault, group vault, runner, and assistant session do not
gain another permission store.

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
- No multi-member query, fan-out, aggregation, broadcast, or scheduler.
- No autonomous follow-up, recursion, background polling, or standing agent.
- No new queue, workflow, service, container, result table, policy engine, or
  general cross-agent registry.

Add those only for a concrete product need with a separately reviewed authority
and disclosure contract.

## Rollout and rollback

Deploy consumers first. Cloudflare/runner and Web must tolerate the new
`consented_member` request target, prepare disclosure context, and optional
`deliveryMode: "reviewed_exact"` completion before Web may emit new work.
Keep `HOSTED_GROUP_DISCLOSURE_PRODUCER_ENABLED` unset or `0` through that
deployment and the runner fingerprint/confinement smoke. Enable exact `1` only
after both planes have converged.

Rollback disables and redeploys the Web producer first. Keep compatible
consumers deployed until every consented request and reviewed-exact completion
has drained or expired from Web mailboxes and imported runtime state. Prefer a
forward fix once new work has been produced.
