# Single group sleep-stage permissions

## Goal

Expose one user-facing permission for deep sleep and one for REM sleep. Each
new permission includes the canonical value plus the available public source
breakdown, so members do not have to understand or approve separate
provider-neutral and by-source choices.

## Constraints

- Do not silently broaden existing provider-neutral grants. Production has
  active legacy deep-sleep grants and no source-aware grants at the start of
  this work.
- Keep legacy grant parsing and reads available for existing rows and rolling
  deploys. Derive the one complete current permission from legacy requested
  policies without rewriting their rollback-readable stored scope.
- Reuse the current exact-scope consent, encrypted projection, capability
  negotiation, and group-read owners. Add no table, migration service, queue,
  scheduler, or reconciliation loop.
- Preserve truthful stored-snapshot, selected-source, disagreement, and
  recorded-time semantics.

## Implementation

1. Make the source-aware v1 scopes the only selectable deep- and REM-sleep
   scopes and label them simply `Deep sleep` and `REM sleep` with complete,
   concise disclosure copy.
2. Treat legacy v0 grants as read-only compatibility contracts. Read every
   legacy requested policy as v1 at the current join-view and acceptance
   boundaries so existing groups immediately have one complete choice, while
   preserving exact v0 policy storage for rollback. Existing v0 share rows
   remain narrow compatibility evidence until that member explicitly approves
   v1. Keep a legacy-active grant visible in the same checked permission row:
   saving preserves it, opting into source details atomically adds v1 alongside
   v0 in policy storage while replacing the grant with v1, and turning the row
   off revokes both grant versions without changing policy.
3. Remove the model-facing source-neutral opt-down and default every new sleep
   stage access offer/read request to v1.
4. Let a frozen v0 shared-read request fall back to the matching v1 grant's
   canonical top-level value only. Preserve the requested v0 scope shape,
   remove all source metadata, and prefer an exact v0 grant when present.
5. Update focused contract, consent, group-store, prompt, and end-to-end proof.
6. Update the durable group-data specification and design-catalog study.

## Verification

- Join-policy projection proves exactly one selectable deep-sleep choice and
  one selectable REM-sleep choice.
- Policy merge tests prove existing v0 storage remains exact, a new v1 request
  is additive for rollback compatibility, and unrelated scopes are preserved.
- Existing v0 records still parse and remain readable without source fields.
- A new v1 approval still projects encrypted multi-source data and returns it
  through the authorized group read.
- Focused tests and typechecks pass for every changed owner, followed by the
  required exact-head ReviewGPT and CI gates.

## Evidence

- Focused Web group-policy, group-store, consent-client, acceptance-route,
  reaction-offer, and shared-read tests: 291 passing.
- Focused assistant capability-offer and prompt-budget tests: 90 passing.
- Prepared Web and assistant-engine typechecks: passing.
- Exact v0 shared-read tests prove v1 canonical-value fallback strips every
  source-detail field and that an exact v0 grant wins when both grants exist.
- Desktop and mobile design-catalog studies render exactly `Deep sleep` and
  `REM sleep`, with no source-specific duplicate choice.
- Complete first provider-input requests measured through the pinned Codex App
  Server with `gpt-5.6-terra`, low reasoning, representative dynamic tools,
  and `gpt-tokenizer` 3.4.0 `o200k_harmony`: direct 152,837 bytes / 33,201
  tokens at base and 152,817 / 33,191 at head; group 128,560 bytes / 27,754
  tokens at base and 128,540 / 27,744 at head. Both deltas are -20 bytes and
  -10 tokens; repeat captures were byte-identical after normalization.
- Claude Fable 5 visual review could not run because the configured account had
  no remaining usage credits; Playwright and native-resolution inspection
  supplied the required rendered proof.
- Preliminary specialist ReviewGPT and final ReviewGPT round 1 both found that
  canonicalized policy display hid active v0 grants. Final round 1 additionally
  found that frozen v0 reads did not converge after v1 approval. Both findings
  are accepted and covered by the corrected one-row legacy state, atomic grant
  replacement/revocation, and narrow v1-to-v0 read fallback. The immutable
  first-reviewed head is `dc5b970118325d99e933355105633f446c48766c`.
- Final ReviewGPT round 2 found that ordinary link activity still rewrote a
  legacy stored policy to v1 while leaving its v0 grant active, so the previous
  Web could hide that authority after rollback. The required retrospective
  chose deletion of that rollout seam: stored v0 policy stays exact and the
  current Web derives v1 only in memory. A production-path link-creation test
  proves the legacy policy remains visible and revocable to the previous Web.
- Final ReviewGPT round 3 found that explicit v1 approval under a v0-only policy
  could create a v1 grant that the previous exact-scope Web could not see after
  rollback. The accepted correction materializes v1 alongside v0 in the same
  locked Web-acceptance transaction as the grant replacement. Focused tests
  cover existing-member upgrade, new-member approval, unchanged v0
  preservation, full revoke, and native-offer policy non-mutation.
- Final ReviewGPT round 4 verified every prior implementation correction. Its
  sole Purpose Drift finding was body-only: disclose that a member's explicit
  v1 approval performs the necessary same-transaction group-policy expansion
  for rollback visibility. The corrected intent contract passed the permitted
  disclosure-only retry on the same reviewed head with verified
  `gpt-5-6-pro` metadata and `ROUND_OUTCOME: PASS`.
- Exact-head GitHub Actions on `ec625b5dfc2b731d96e1ddfa0a9d8b051fdc9944`
  passed both CLI hosts, build/typecheck, app verification, assistant/CLI/
  platform package coverage, fixtures, design proof, overflow, tracked
  artifact checks, and the aggregate release gate. The merge tree against the
  current `origin/main` is clean.

Status: completed
Updated: 2026-08-06
Completed: 2026-08-06
