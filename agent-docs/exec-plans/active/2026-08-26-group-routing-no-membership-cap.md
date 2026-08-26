# Route explicitly named groups regardless of membership count

Status: active
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- Let a private member consult or post to one explicitly named joined group
  regardless of how many other groups they have joined. Keep bounded tool
  output as a presentation safeguard, never as a product-availability gate.

## Success criteria

- A unique normalized `groupLabel` resolves across every current membership,
  including when the matching group is outside the first 25 memberships.
- `group_consult.ask` and `group_consult.handoff` admit the selected membership
  and preserve their existing authority and replay checks.
- An omitted label with multiple memberships returns at most 25 safe,
  de-duplicated labels for clarification instead of `too_many_groups`.
- Duplicate normalized labels remain ambiguous and never fan out.
- Deterministic 26+ membership regressions and one focused real-Codex journey
  prove both the host boundary and the member-visible reply.

## Scope

- In scope:
  - Web-owned private-to-group target resolution for Assistant Ask and context
    handoff, including exact replay.
  - Bounded clarification output, focused regressions, product contract,
    assistant journey, and public changelog.
- Out of scope:
  - Fuzzy label matching, newest/role guessing, multi-group fanout, and changes
    to the bounded `list_memberships` response.
  - New membership limits, pagination UI, schema migrations, or new services.

## Constraints

- Technical constraints:
  - Preserve exact NFC/whitespace/case-normalized matching semantics and
    current membership/runtime authority revalidation.
  - Keep database query count and pooled-connection use bounded at maximum
    admitted membership cardinality; do not add per-membership queries or
    provider/crypto work inside target selection.
- Product/process constraints:
  - Product UX Patch: affected people are private members with one, several,
    or more than 25 joined groups, plus people whose group names collide after
    normalization. The no-fanout privacy boundary remains unchanged.
  - Use synthetic names and scenarios in tests, docs, changelog, and PR text.

## Risks and mitigations

1. Risk: An uncapped in-memory scan moves the availability bug into database
   load growth.
   Mitigation: use one slim membership query with no per-membership fanout only
   for an explicit label, preserving the exact JavaScript normalization
   contract and duplicate detection. Retain the existing 26-row query for
   unnamed clarification. At current production cardinality this changes the
   largest observed read from 26 to 27 rows; query count and peak pooled
   connections remain one.
2. Risk: A case/Unicode mismatch changes which group is selected.
   Mitigation: prove persisted display-name normalization and add exact,
   whitespace, case, out-of-window, and duplicate-label regressions.
3. Risk: A replay redirects an already accepted request.
   Mitigation: preserve pinned membership checks and test replay after the
   member's group count grows beyond 25.

## Tasks

1. Add failing deterministic regressions for named and unnamed 26+ membership
   behavior in both private-to-group paths.
2. Split named target lookup from bounded clarification lookup and delete the
   `too_many_groups` availability branch.
3. Update the private-group consultation contract and add the member-visible
   changelog entry.
4. Add and run a focused real-Codex journey with synthetic 26+ memberships;
   inspect the exact tool call and reply.
5. Run focused tests, Web typecheck, diff/privacy checks, preliminary
   specialists, final ReviewGPT, and required PR CI.

## Decisions

- `25` is a response-size budget only. It is not a join limit or a routing
  availability limit.
- Exact named selection stays fail-closed: one match selects, zero asks for a
  bounded clarification, and multiple matches remain ambiguous.
- Product UX effort is Patch because this restores an existing specified flow
  without adding a new interaction or state.
- Exact matching uses one slim all-membership query only when a label is
  supplied. This preserves the existing JavaScript Unicode normalization and
  duplicate detection without a schema migration or per-membership fanout.

## Progress

- Failing proof reproduced all three 27-membership failures before the source
  fix: named consult, unnamed clarification, and named handoff.
- The corrected target-admission suite passes 31 tests; Web typecheck passes.
- Hosted execution contracts pass 52 files and 557 tests. Cloudflare control
  port and exact replay pass 2 files and 8 tests.
- The adjacent Assistant Engine slice passes 115 tests. Its unrelated
  512-receipt continuation stress test repeatedly reaches its existing
  60-second timeout on this shared host.
- The focused real-Codex journey is `Hold`: the default local subscription
  returned `ASSISTANT_CODEX_USAGE_LIMIT` before any provider action, and no
  explicitly authorized alternate home was available.
- Draft PR: #2361.
- Final ReviewGPT round 1 returned one accepted `Complexity Collapse`: exact
  handoff replay already owns a pinned membership and route, so repeating the
  global membership selection can only add load or let an unrelated duplicate
  label invalidate recovery. The correction compares the supplied normalized
  label directly with the locked target label and deletes the replay scan.
- The preliminary specialist packet was invalid because the audit ZIP omitted
  the repository-owned assistant-verification skill. Its provisional live
  coverage finding was accepted: the focused journey now exposes both group
  tools so its exactly-one-handoff assertion forbids `list_memberships`. Its
  replay finding was superseded by deleting replay membership selection.

## Verification

- Commands to run:
  - Focused Vitest for `apps/web/test/hosted-group-assistant-ask.test.ts`.
  - `pnpm --filter @murphai/hosted-web typecheck`.
  - Focused `pnpm test:assistant:live -- --test "<unique journey name>"`.
  - `git diff --check`, targeted privacy/stale-string searches, and required
    exact-head PR review/CI gates.
- Expected outcomes:
  - Named 26+ membership asks and handoffs are accepted exactly once.
  - Unnamed 26+ membership requests return no more than 25 labels and never
    return `too_many_groups`.
  - Duplicate exact labels remain unavailable as ambiguous.
  - The real assistant calls the named group handoff and truthfully reports a
    queued post rather than claiming it was sent.
