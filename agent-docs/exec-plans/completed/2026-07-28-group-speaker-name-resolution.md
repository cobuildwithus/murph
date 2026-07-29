# Efficient group speaker name resolution

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Give Murph a useful natural speaker label beside each eligible message in an
  authenticated Linq group compound turn, preferring an explicitly shared
  profile name and otherwise using the human group owner's explicitly shared
  contact label as an unverified presentation fallback.
- Avoid repeated Web, database, crypto, and KMS work for the same sender during
  one compound turn.

## Success criteria

- One initial burst performs one bounded lookup for its unique Linq sender
  handles rather than per-message work.
- Later live admission reuses positive and negative results for already-seen
  handles during the same compound turn and batches only unresolved handles.
- An authorized `profile-name.v0` value wins over an owner contact label.
- A safe unique owner contact label can name an otherwise unnamed sender while
  remaining explicitly unverified presentation text.
- Names never become identity, membership, consent, routing, delivery, invite,
  signup, or effect authority; opaque message refs remain the model's action
  selector and the server derives the participant.
- Direct Linq and Telegram behavior remain unchanged, and optional lookup
  failure leaves the conversation safely unnamed without blocking it.

## Scope

- In scope: the Linq group participant-name control contract, Web's existing
  profile/contact resolvers, compound-turn name memoization, prompt metadata,
  focused tests, and current architecture/security/reliability/product docs.
- Out of scope: new canonical profile state, a persistent cache, a contact
  roster API, schema migration, participant-id model authority, direct-message
  naming changes, and Telegram ingress changes.

## Constraints

- Reuse the existing Web-owned `profile-name.v0` snapshot and member-scoped
  address-book advisory projection.
- Keep the cache compound-turn-local so authorization, suspension, consent, and
  projection changes are reconsidered on the next ordinary turn.
- Keep lookup set-based, cardinality-bounded, privacy-safe, and fail-soft under
  the existing short presentation deadline.
- Do not add a queue, cache invalidation service, durable cache, background
  worker, or second name source of truth.
- ReviewGPT supplies the implementation patch; the parent inspects, integrates,
  verifies, and completes the PR workflow.

## Evidence

- Initial prompt preparation deduplicates handles within one input batch.
- Separate live-admitted batches currently call the name reader again, and the
  existing runtime regression expects three reads for initial and successive
  admitted inputs.
- Telegram persists its trusted ingress display name on the durable input.
- Linq persists its sender handle and resolves `profile-name.v0` at prompt
  preparation time.
- Owner-shared address-book labels already exist, but their only assistant
  consumer is the model-triggered `read_chat_participants` operation.

## Tasks

1. [x] Trace current profile-name, address-book, compound-turn, prompt, and
   authority owners.
2. [x] Receive and inspect ReviewGPT's implementation patch.
3. [x] Apply the smallest correct patch and resolve verified integration issues.
4. [x] Run focused tests, typechecks, canonical diff verification, and
   acceptance verification.
5. [x] Complete required product, specialist, parent-final, verification,
   commit, push, and PR-body prerequisites for the post-plan final ReviewGPT
   and CI gates.

## Verification

- Focused Assistant Engine, Assistant Runtime, Hosted Execution, Web, and
  Cloudflare tests selected from the final touched paths.
- Focused package typechecks for every changed owner.
- `pnpm test:diff <touched paths>`.
- `pnpm verify:acceptance`.
- Required product-experience review, preliminary `completion-specialists`
  ReviewGPT pass, parent final review, and final PR-lane ReviewGPT gate.

## Review outcomes

- Product-experience review passed after preserving pre-membership owner-contact
  fallback and suspended/ambiguous-member suppression.
- Preliminary ReviewGPT found and the implementation resolved two bounded
  issues: a missing sender handle no longer renders through the authoritative
  `Sender:` grammar, and executable two-turn coverage proves the operation-local
  name memo expires before the next ordinary turn.
- The focused remediation suite passed 312 tests. The canonical remediation
  lane passed 2,853 Assistant Engine, 1,953 Assistant Runtime, 1,084 CLI, and
  2,052 Cloudflare Node tests plus Workers tests, typechecks, and repository
  guards.
- Full acceptance verification passed after remediation, including all package
  coverage, 7,239 Web tests, the Web production build, and Cloudflare app
  verification.
- Parent final review found no additional defect after rechecking the naming
  resolver, contact fallback, batch/memo lifecycle, prompt provenance,
  fail-soft deadline, effect-authority boundary, merge resolutions, and rollout
  contract. The final PR-specific ReviewGPT round and exact-head CI remain
  post-plan merge-readiness gates.
Completed: 2026-07-28
