# anonymous-product-feedback

Status: completed
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Keep assistant-captured product feedback useful for product triage without
  retaining the submitting member's identity or private health/conversation
  details by default.

## Success criteria

- New hosted product-feedback rows store `member_id = NULL` on the ordinary
  authenticated runtime path.
- Existing hosted product-feedback member associations are cleared during the
  schema migration.
- The callback remains authenticated and member-bound for write authority, but
  the authenticated identity is not forwarded into persistence.
- Feedback idempotency no longer depends on member identity.
- The model-facing contract requires abstraction of private facts to generic
  product concepts, while deterministic contact/secret redaction remains a
  final guardrail.
- Optional member linkage remains server-controlled and nullable for an
  explicitly justified future path; the model and runtime payload cannot choose
  it.
- Focused schema, service, route, assistant-tool, privacy, and migration tests
  pass, along with affected typechecks and exact-head CI.

## Invariants

- Authentication and runtime write-fence checks still authorize every feedback
  submission.
- Feedback storage never receives raw conversation text or health truth.
- Product feedback remains operational product-intake state, not canonical
  member or health state.
- Existing unrelated working-tree changes are preserved.

## Implementation

- Add a forward Prisma migration that clears existing `member_id` values and
  makes the column nullable.
- Make the Prisma relation optional and default the persistence service to an
  unlinked row.
- Stop the authenticated callback route from passing its bound member identity
  into product-feedback persistence.
- Derive deterministic feedback ids from the runtime idempotency key alone.
- Tighten the model-facing privacy rubric and update durable architecture,
  security, and account-data documentation.
- Add focused regression tests proving anonymous persistence, authenticated
  routing without identity forwarding, migration behavior, idempotency, and
  private-detail abstraction.

## Verification

- Production was inspected only through aggregate read-only SQL: all 91
  existing feedback rows were member-linked before this migration, and the
  table has no inbound foreign keys. No feedback summary or member identifier
  was selected.
- Applying the actual migration inside a rolled-back temporary-table scenario
  proved the member column becomes nullable, linked rows become anonymous, and
  former member-derived feedback ids are replaced.
- Focused Web Vitest passed 95 tests across the product-feedback service,
  callback route, privacy migration, migration inventory, and account-data
  service.
- Product-feedback digest and cron tests passed independently after the current
  base added that consumer.
- Focused Assistant Engine Vitest passed 14 tests with 21 opt-in real-model
  scenarios skipped; Hosted Execution Vitest passed 9 tests.
- Web, Assistant Engine, and Hosted Execution typechecks passed. Prisma client
  generation passed.
- Complete provider-input capture through the pinned Codex App Server used
  `gpt-5.6-terra`, low reasoning, production code mode, identical synthetic
  inputs, 16 representative direct tools, 13 representative group tools, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. The complete content-candidate capture
  plus the current base-only prompt-line merge measured the direct fixture at
  30,078 to 30,258 tokens and 138,389 to 138,950 bytes (+180 tokens, +0.5984%,
  +561 bytes); the group fixture measured 26,573 to 26,753 tokens and 122,788
  to 123,349 bytes (+180 tokens, +0.6774%, +561 bytes). The base-only change
  was one exact rendered system-prompt line and added 16 tokens/88 bytes to
  both sides when measured with its newline boundaries. The shorter no-prose
  instruction contributes -19 tokens/-100 bytes;
  the closed enum schema and Codex-generated declaration contribute +199
  tokens/+661 bytes; other provider-visible input contributes zero. The
  capture excluded only `client_metadata` and `prompt_cache_key` and normalized
  temporary paths identically. Each reconstructed base replacement was
  asserted to occur exactly once.
- The original exact-head CI passed. Correction-verification ReviewGPT round 2
  inspected the exact content candidate with the requested Pro model, returned
  `ROUND_OUTCOME: PASS`, and reported no qualifying findings. It confirmed the
  closed payload, independent Web parsing/catalog validation, identity discard,
  server-built summary, two-phase historical/drain cleanup, and fail-closed
  rolling deployment. Every required CI check passed on that exact candidate.
- Main advanced after the zero-finding review. Its automatic conflict-free
  merge changes no authored PR diff and is review-exempt under the base-only
  rule; final exact-head CI remains for the archived-plan commit.
- The remediation passed 451 Hosted Execution tests and 2,247 Cloudflare tests;
  162 focused assistant guidance/tool tests plus the durable-handoff,
  reconnect, and real-model-definition cases; and 130 focused Web privacy,
  migration, digest, and account-data tests. Hosted Execution, Assistant
  Engine, Web, and Cloudflare typechecks passed.
- A rolled-back local PostgreSQL proof applied the exact forward migration to a
  synthetic linked free-text row, then simulated an old Web writer and applied
  the exact post-drain contract migration. Both passes preserved row counts,
  cleared member linkage and summaries, and replaced old ids.
Completed: 2026-07-31

## Owner decision: restore free-text summaries (2026-07-31)

- After the closed-enum remediation passed review, the owner directed that
  assistant-captured feedback keep a raw free-text summary; the requirement
  that stands is anonymity (no member linkage), not the removal of prose.
- The prose-removal change was reverted: the contract again accepts a
  model-authored `summary` (1-500 characters, deterministic contact/secret
  redaction applied at the parser), the closed `productArea`/`action`/`outcome`
  enums are removed, and the forward migration no longer clears historical
  summaries. The post-drain contract migration again clears only member links
  and member-derived ids for rows written by draining old Web functions.
- Anonymity invariants are unchanged: `member_id` stays nullable and null by
  default, the authenticated callback still discards its resolved identity
  before persistence, and ids derive only from the runtime idempotency key.
- Verification of the restored free-text state (focused suites, typechecks,
  provider-input capture, exact-head CI, and a new ReviewGPT round) is recorded
  in the PR for this plan.
- ReviewGPT round 3 on the restored design found compound blood-pressure
  readings partially redacted; the correction adds one compound pattern ahead
  of the scalar unit pattern with parser- and persistence-boundary proof.
  Round 4 confirmed the correction but flagged the open-ended
  spelling-by-spelling direction and required a requirement-level decision.
- Requirement decision (owner-aligned): "no exact health value reaches
  anonymous storage" is explicitly a best-effort mitigation, not a hard
  admission invariant. The model-facing contract is the primary boundary for
  summary content; the deterministic redaction pass is defense-in-depth over
  recognizable shapes and is not extended per natural-language spelling.
  `agent-docs/SECURITY.md` is reconciled to that single position. A fail-closed
  semantic boundary was rejected because it would drop or truncate feedback,
  contradicting the owner's direction to keep raw free-text summaries.
