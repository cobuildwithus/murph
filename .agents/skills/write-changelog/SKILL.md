---
name: write-changelog
description: Write, backfill, or review Murph's public changelog. Use when a PR ships a member-visible feature, improvement, recovery, performance change, copy or UX change; when updating `apps/web/src/lib/changelog.ts`; when adding changelog visuals; when auditing merged work for missing release notes; or when deciding and documenting why a PR is not changelog-worthy.
---

# Write Changelog

Publish release notes that are complete, evidence-backed, useful to members,
and visually explanatory. Treat the changelog as part of the shipped product,
not a marketing dump or a list of commit titles.

## Required outcome

For every PR, make one explicit decision:

- Update the changelog in the same PR when a member can experience a new
  capability or a meaningful improvement in behavior, reliability, recovery,
  performance, accessibility, copy, or UX.
- Mark the changelog not applicable only when the diff is truly internal, such
  as tests, docs, process, telemetry, refactoring with no behavior change, or
  sensitive hardening with no safe public outcome to describe. Give a concrete
  reason in the PR body.

Do not defer eligible entries to a later catch-up PR. A follow-up changelog is
acceptable only when reconstructing already-merged omissions.

## 1. Read the product contract

Before editing, read the repository's required first-read documents and the
current versions of:

- `agent-docs/PRODUCT_SENSE.md`, especially the changelog archive contract.
- `DESIGN.md`, especially the changelog visual language.
- `agent-docs/product-marketing-context.md` for voice and factual boundaries.
- `agent-docs/operations/completion-workflow.md` for PR requirements.
- `apps/web/src/lib/changelog.ts`, the latest edition, and the last recorded
  source PR.
- `apps/web/app/changelog/page.tsx`,
  `apps/web/app/changelog/visuals.tsx`, and the design-catalog study before
  adding or changing visuals.

Read any product spec or invariant that owns the behavior being described.
Never rely on a PR title alone.

## 2. Inventory the exact shipped work

For a normal PR, inventory the current diff. For a catch-up edition:

1. Find the last source PR represented in the newest accurate edition.
2. Enumerate first-parent merges after that cutoff through the target date.
3. Read the PR body, relevant diff, tests, and durable product contract for
   every plausible member-facing change.
4. Classify each change as member-visible, internal-only, duplicate of another
   outcome, or not yet shipped.
5. Keep a complete list of contributing PR numbers for every included outcome.

Treat claims as facts only when the shipped code and contract prove them.
Exclude draft plans, unmerged work, future foundations with no usable behavior,
internal metrics, and implementation details that do not change the member's
experience.

## 3. Shape editions around member outcomes

Use one dated `ChangelogEdition` per release day. Preserve stable edition IDs,
item IDs, cursor windows, permalinks, card paths, and feed contracts.

Group related PRs into one item when they create or finish the same member
outcome. Do not group unrelated changes merely to shorten the page. A good item
answers:

- What can the member do or understand now?
- Where does it happen?
- What important boundary or recovery behavior makes the claim honest?
- Which PRs shipped the complete outcome?

Write fields this way:

- `title`: concrete, short, and recognizable in the product.
- `summary`: the user-visible behavior in one sentence.
- `details`: the most important authority, privacy, recovery, or limitation.
- `kind`: `feature` for a new capability; `improvement` for a better existing
  behavior.
- `priority`: use 5 for major new behavior or important recovery and safety;
  use lower values for narrower improvements.
- `relevanceTags`: stable lowercase product concepts, not campaign language.
- `sourcePullRequests`: every PR needed to substantiate the final item.
- `tryIt`: only when one exact supported route or prompt exercises the claim.
  Do not invent a deep link, command, or outcome.

Use Murph's clean, precise, warm voice. Prefer plain verbs and specific nouns.
Avoid hype, implementation jargon, em dashes, and claims such as "instant" or
"seamless" unless measured behavior proves them.

## 4. Protect privacy and security

The changelog is public. Never copy private evidence, screenshots, transcripts,
names, handles, addresses, account identifiers, raw production data, secrets,
or distinctive user scenarios into copy, fixtures, visuals, tests, or PR text.

For privacy, security, billing, and reliability work, describe the safe member
outcome and the meaningful boundary without publishing an exploit recipe or
sensitive architecture. If no useful safe outcome exists, mark the changelog
not applicable and explain that the change is internal hardening.

## 5. Add a visual when it teaches

Give priority-5 features and interaction-heavy changes a compact explanatory
visual whenever a truthful one is possible. A visual must show behavior,
sequence, state, comparison, or hierarchy more clearly than prose.

Prefer existing primitives from `apps/web/app/changelog/visuals.tsx` and
`phone-mock.tsx`, including phone conversations, dialogs, checklists, device
lists, compact tables, schedules, metric cards, and reasoning steps.

Visual rules:

- Use synthetic, private-free content only.
- Show the real interaction contract. Do not create decorative stock art or an
  aspirational screen that the product does not have.
- Keep it legible at mobile and desktop widths and within the established
  320-pixel visual frame.
- Preserve semantic text, table headings, labels, and useful accessible names.
  Mark purely decorative marks and images appropriately.
- Reuse the changelog palette, typography, border, radius, and shadow language.
- Add a new primitive only when an existing one cannot express the behavior.
  Make it reusable and simple.
- Register each production item visual in the page's `VISUALS` map by stable
  item ID.
- Update `/design?tab=sections#changelog-archive` with the real archive
  component and synthetic props. If a genuinely new reusable production
  component is introduced, register it in the components catalog too.

Generated bitmap imagery is appropriate only when the released behavior is
itself image-driven and the generated asset explains it better than a product
mock. Follow the repository image-generation and asset rules when that rare
case applies.

## 6. Update proof and tests

At minimum, update focused coverage for:

- the exact edition order and item-ID inventory;
- claim-critical source PRs, boundaries, and `tryIt` behavior;
- the latest seven-edition page and older navigation;
- explanatory visual rendering and the synthetic design study;
- stable feed, card, API, cursor, and permalink behavior affected by the new
  latest items.

Run the smallest focused Vitest set that covers the changed changelog files,
then the Web typecheck. Render the design study and latest archive at desktop
and mobile widths, inspect the full screenshots, and check overflow, wrapping,
contrast, accessible labels, and visual rhythm.

Follow the repository completion workflow for specialist review, exact-head
CI, design-proof uploads, commit, and PR creation.

## 7. Complete the PR declaration

Add this section to the PR body:

```md
## Changelog

- Changelog: updated
- Items: 2026-08-09 · stable-item-id
```

For a truly internal-only change:

```md
## Changelog

- Changelog: not applicable
- Reason: Test-only coverage; no member-visible behavior changed.
```

The `updated` disposition must correspond to a change in
`apps/web/src/lib/changelog.ts`. The `not applicable` disposition must explain
why members cannot experience a change. Never use a placeholder or a generic
reason such as "not needed."

## Final review checklist

- Every member-visible outcome in the diff is represented or grouped honestly.
- Every claim is supported by shipped code, tests, and the owning contract.
- Every source PR is present, with no unmerged or unrelated PRs.
- Copy describes outcomes, limits, and recovery without internal leakage.
- Important behavior has a useful responsive visual where possible.
- The design catalog, registry tests, page tests, and stable archive behavior
  are updated.
- The PR has one valid changelog disposition and the required evidence.
