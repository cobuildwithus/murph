---
name: write-changelog
description: Write, backfill, or review Murph's public changelog. Use when a PR ships a member-visible feature, improvement, recovery, performance change, copy or UX change; when adding an entry under `apps/web/changelog/entries`; when adding changelog visuals; when auditing merged work for missing release notes; or when deciding and documenting why a PR is not changelog-worthy.
---

# Write Changelog

The changelog is part of the shipped product: complete, backed by what
shipped, useful to members, and visual where a picture teaches.

## The decision every PR makes

- **Updated**, in the same PR, when a member can experience a new capability
  or a meaningful improvement in behavior, reliability, recovery, performance,
  accessibility, copy or UX. A later catch-up PR is only for omissions that
  already merged.
- **Not applicable** when the diff is internal: tests, docs, process,
  telemetry, a refactor with no behavior change, or hardening with no safe
  public outcome to describe. Give the concrete reason in the PR body and stop
  here; the rest of this skill is for changelog content.

Put this in the PR body. The PR check reads these fields:

```md
## Changelog

- Changelog: updated
- Items: 2026-08-09 · stable-item-id
```

```md
## Changelog

- Changelog: not applicable
- Reason: Test-only coverage; no member-visible behavior changed.
```

`updated` must come with a change under `apps/web/changelog/entries/`,
`apps/web/changelog/editions/`, or the legacy owner
`apps/web/src/lib/changelog.ts`, and `Items:` names the stable item IDs it
touches. A `not applicable` reason says why members cannot experience the
change; "not needed" does not pass.

## Before writing

Read `apps/web/changelog/README.md` and the newest entry directory. For voice
and claims, read the changelog archive contract in
`agent-docs/PRODUCT_SENSE.md` and `agent-docs/product-marketing-context.md`.
For visuals, read the changelog visual language in `DESIGN.md`,
`apps/web/app/changelog/page.tsx` and `apps/web/app/changelog/visuals.tsx`.
Read the spec that owns the behavior you describe; a PR title is not
evidence.

## Find what shipped

For a normal PR, work from the diff. For a catch-up edition, find the last
source PR in the newest accurate edition, list first-parent merges after it,
and read each plausible PR's body, diff, tests and contract. Sort each change
into member-visible, internal, duplicate of another outcome, or not yet
shipped, and keep every contributing PR number.

A claim is a fact only when shipped code and its contract prove it. Leave out
plans, unmerged work, foundations with no usable behavior, internal metrics,
and implementation detail a member never meets. Three kinds of claim are easy
to overstate, so trace them through their production owners:

- **Scheduled, asynchronous or detached work.** A tool available in a private
  conversation is not automatically available to scheduled work, a group,
  another channel or a detached continuation. Confirm the invocation scope,
  channel, audience, destination and retry behavior.
- **Consent.** Each scope a member can approve separately stays a separate
  claim, even when one of them got simpler.
- **Feedback and support summaries.** Say feedback was recorded or sent only
  when the production owner guarantees the member sees that outcome, and
  describe scrubbing as the bounded pattern scrub it is.

## Write the item

Add one JSON file per item at
`apps/web/changelog/entries/YYYY-MM-DD/<stable-item-id>.json`. The directory
date, `publishedOn`, item `id` and filename agree. The frozen
`LEGACY_CHANGELOG_EDITIONS` array in `apps/web/src/lib/changelog.ts` takes
corrections to existing historical claims only, never a new item.

- `order` sets position within the date; higher renders first, and ties fall
  back to the item ID, so concurrent PRs need no coordination. Leave gaps of
  100 and don't renumber other items.
- Edition title and summary live in
  `apps/web/changelog/editions/YYYY-MM-DD.json` and are optional: a date
  without one gets a fallback. Add or edit it only when the edition copy helps
  the archive.
- Keep edition IDs, item IDs, cursor windows, permalinks, card paths and feeds
  stable.

Group PRs that create or finish the same member outcome into one item, and
keep unrelated changes apart. An item tells the member what they can now do
or understand, where, the boundary or recovery behavior that keeps the claim
honest, and which PRs shipped it.

- `title`: short, concrete, recognizable in the product.
- `summary`: the member-visible behavior in one sentence.
- `details`: the most important authority, privacy, recovery or limit.
- `kind`: `feature` for a new capability, `improvement` for a better one.
- `priority`: 5 for major new behavior or important recovery and safety;
  lower for narrower changes.
- `relevanceTags`: stable lowercase product concepts.
- `sourcePullRequests`: every PR needed to back the item.
- `tryIt`: only when one exact supported route or prompt exercises the claim.

Write in Murph's voice: plain verbs, specific nouns, no hype, jargon or em
dashes, and no "instant" or "seamless" unless measured.

## Keep it public-safe

The changelog is public. Private evidence, screenshots, transcripts, names,
handles, account identifiers, production data, secrets and distinctive member
scenarios stay out of copy, fixtures, visuals, tests and PR text. For
privacy, security, billing and reliability work, describe the safe member
outcome and its boundary, not the exploit or the architecture. When no useful
safe outcome exists, the PR is not applicable as internal hardening.

## Visuals

Give priority-5 features and interaction-heavy changes a compact visual when
a truthful one shows behavior, sequence, state or comparison better than
prose.

- Build from the primitives in `apps/web/app/changelog/visuals.tsx` and
  `phone-mock.tsx`. Add a new primitive only when none fits, and make it
  reusable.
- Use synthetic content and show the real interaction, at mobile and desktop
  widths inside the 320-pixel frame, in the changelog's palette and type.
- Facts in a visual come from the product: reuse canonical data or
  components, or add an assertion against the owner. Connection status,
  consent scope, route capability and similar state are not restated in a
  fixture. If that is not simple, drop the visual and let the prose carry it.
- Show only what the product does: no connected or syncing state for a
  guide-only integration, no generic visual for a channel-specific capability,
  and no completed scheduled effect unless that exact invocation can deliver
  it to that audience.
- Keep semantic text, table headings, labels and accessible names; mark
  decorative marks as decorative.
- Register the visual in the page's `VISUALS` map by item ID, and update
  `/screenshots/ops#changelog-archive` with the real archive component and
  synthetic props. A new reusable production component also goes in the
  components catalog.
- Generated bitmap art fits only when the released behavior is itself
  image-driven.

## Proof

The fragment loader already checks path and content agreement, allowed
fields, unique IDs, ordering and publication, and the archive tests cover the
seven-edition window and older navigation, so there is no hand-kept inventory
to update. Add focused coverage for claim-critical source PRs, boundaries and
`tryIt` behavior, for the visual and its design study, and for feed, card,
API, cursor or permalink behavior only when the item changes them.

Run the smallest Vitest set that covers the changed changelog files, then the
Web typecheck. Render the design study and the latest archive at desktop and
mobile widths and look at the full screenshots for overflow, wrapping,
contrast and accessible labels. The completion workflow owns the rest.
