# Polish comparison positioning and visual identity

Status: completed
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Make the comparison library immediately recognizable as Murph, substantially
  more persuasive without overstating competitor gaps, and faster to scan on
  both desktop and phone.
- Preserve the existing source-backed, server-rendered catalog architecture
  while improving the shared page shell, hero, decision copy, quick table, and
  expandable evidence presentation across all 102 guides.

## Success criteria

- Comparison pages reuse the normal public Murph navigation and authenticated
  CTA behavior; no comparison CTA links to a homepage section anchor.
- Every detail hero includes the Murph mark and a locally stored competitor
  logo or high-resolution brand mark, with a name fallback and no runtime
  third-party logo request. The index hero includes a restrained representative
  brand mosaic instead of relying on display copy alone.
- Hero and decision copy is shorter, clearer, and specific enough to explain
  when to keep the competitor, add Murph, or switch without declaring a
  universal winner.
- Every quick comparison contains 8 to 10 sourced rows. Close alternatives such
  as BodyBuddy show genuine overlap as well as the concrete Murph advantages of
  broader context, continuity across changing questions, and practical support.
- The detailed comparison remains in server HTML, but its expanded desktop and
  phone states are compact, scannable, and use understandable source labels
  instead of cryptic bracketed numbers as the primary interaction text.
- Focused catalog/render tests, scoped lint, hosted Web typecheck, direct
  desktop/phone/no-JavaScript browser proof, viewport-overflow proof, and the
  production build pass for the final candidate.
- The exact pushed PR head receives the required Product UX and frontend
  ReviewGPT lenses concurrently with required CI, and the PR remains unmerged.

## Scope

- In scope:
  - Shared public navigation, signup handoff, comparison index/detail heroes,
    concise decision copy, quick-table depth, expanded evidence UI, and source
    presentation.
  - Local competitor logo assets sourced from official sites or a reviewed
    brand-asset catalog, plus explicit asset provenance and a graceful name
    fallback.
  - Focused test and design-proof updates for the changed states.
- Out of scope:
  - New comparison targets, unsupported product claims, rankings, review scores,
    affiliate links, or changes to Murph product behavior.
  - A runtime logo API, CMS, live research fetch, logo-tracking request, or new
    visual dependency.
  - Merging the existing pull request or deploying to production.

## Constraints

- Technical constraints:
  - Keep the existing typed catalog, one dynamic route, static parameter
    enumeration, semantic HTML, and server-rendered evidence/FAQ content.
  - Reuse `StickyNav`, the existing authentication owner, shared footer, design
    tokens, and comparison evidence dimensions. Keep assets local and bounded.
  - Preserve accessibility, no-JavaScript usefulness, stable source anchors,
    and narrow-phone layouts without horizontal page overflow.
- Product/process constraints:
  - Acknowledge each competitor's real strength and overlap. Sell Murph through
    specific continuity, context, conversation, and follow-through advantages,
    not manufactured absences or unsupported superiority.
  - Follow the flat-paper design system: one sage accent, warm hairlines, no
    shadows, no nested cards, no generic logo wall, and no oversized prose.
  - Keep logo use nominative and unmodified; preserve brand proportions and
    record where each asset came from.

## Risks and mitigations

1. Risk: A shared row expansion makes inaccurate blanket claims across very
   different competitors.
   Mitigation: use explicit source-mapped statuses, conservative `Limited`
   labels, category defaults only where the sourced operating model supports
   them, and product-specific overrides for materially different cases.
2. Risk: One hundred logo assets create a brittle or legally unclear runtime
   dependency.
   Mitigation: freeze reviewed assets locally, keep a provenance manifest, do
   not hotlink, and fall back to the competitor name if an asset is absent.
3. Risk: The richer hero or longer table becomes another dense wall on phones.
   Mitigation: treat phone and desktop as separate walkthroughs, keep the main
   decision above detail, and inspect the real expanded state at narrow widths.
4. Risk: Reusing authenticated navigation makes the route dependent on an
   unrelated data or client boundary.
   Mitigation: reuse the same public-page auth fallback already used by About,
   Security, Knowledge, and Contact; retain fully rendered comparison content
   independently of authentication state.

## Tasks

1. Recover the exact PR head, inspect the current public shell and evidence
   model, and record the follow-up Product UX plan.
2. Acquire, validate, and freeze competitor brand assets with provenance.
3. Reuse the public navigation/auth owner and redesign the index/detail hero
   and closing signup path.
4. Shorten decision copy, expand all quick tables to 8 to 10 sourced rows, and
   correct close-alternative positioning beginning with BodyBuddy.
5. Redesign the expanded evidence table and source references while retaining
   semantic, server-rendered content.
6. Update focused tests and design proof, then run the Product UX walkthrough,
   local verification, candidate review, commit, push, ReviewGPT, and CI gates.

## Decisions

- Product UX effort: Product change. The public comparison promise already
  exists; this pass materially changes how quickly and convincingly it is
  understood without creating a new audience or authority relationship.
- Outcome: A visitor who knows the competitor can recognize both products,
  understand the honest choice in seconds, scan a substantive sourced table,
  and start with Murph without an unrelated homepage-anchor detour.
- Entry and promise: Search, answer-agent, direct detail, and `/compare` entry
  paths remain public and immediate. The main relationship and decision appear
  before expandable evidence; signup opens the existing Murph auth journey.
- Affected people: a competitor-literate desktop researcher, a narrow-phone
  visitor comparing a product they already use, an authenticated visitor who
  expects the normal dashboard-aware navigation, and a no-JavaScript crawler or
  reader that still needs complete evidence and FAQs.
- Deliberate exclusions: no hands-on-use claim, universal winner, medical
  outcome claim, hotlinked logo, or implied integration.
- Proof path: compare index plus WHOOP, BodyBuddy, CommonHealth, and one long-name
  guide at desktop and phone widths; open the detailed evidence; exercise the
  signup/nav path in both auth states; disable JavaScript; run the route/table
  invariants and production build.

## Verification

- Commands to run:
  - Focused comparison Vitest files and any directly affected public-page tests.
  - Scoped ESLint for changed TypeScript/TSX files.
  - `pnpm --dir apps/web typecheck:prepared`.
  - Task-scoped Playwright design proof and comparison viewport-overflow cases.
  - `pnpm --dir apps/web build` after focused proof is stable.
- Expected outcomes:
  - Every guide has a unique local logo mapping or deliberate fallback, 8 to 10
    quick rows, valid evidence keys, and no duplicate capability labels.
  - Representative desktop, phone, expanded-evidence, logo-fallback, auth, and
    no-JavaScript states render without clipping, misleading copy, or errors.

## Outcome

- Replaced the comparison-only shell with the normal public Murph navigation,
  auth-aware CTA, footer, and a single light closing invitation. Comparison
  routes no longer link to the homepage pricing anchor.
- Added 102 locally frozen official competitor marks with explicit provenance,
  a resilient name fallback, logo-led detail heroes, and a representative index
  mosaic. A final visual provenance audit rejected and replaced 20 generic,
  partner, or publisher marks that an earlier domain-only pass had mistaken for
  product logos. No comparison page hotlinks a logo at runtime.
- Expanded all 102 quick comparisons from five to ten evidence-mapped rows.
  BodyBuddy now shows six areas of genuine overlap while distinguishing Murph's
  broader records context and continuity from BodyBuddy's accountability and
  game-based strengths.
- Removed the oversized decision essay, tightened the index and detail copy,
  and rebuilt the expanded evidence presentation as a compact semantic ledger
  with human-readable source controls.

## Verification evidence

- Focused catalog/render tests: 12 passed.
- Scoped ESLint: passed with zero warnings or errors.
- Hosted Web typecheck: passed.
- Final visual and no-JavaScript Playwright proof: 2 passed; desktop and phone
  captures cover the directory, WHOOP, BodyBuddy, CommonHealth, quick tables,
  and expanded evidence.
- Comparison viewport proof: all 20 directory/detail cases passed at 320, 375,
  390, 768, and 1280 pixels; narrow evidence targets passed separately at 320
  and 390 pixels.
- Production Web build: passed, including all 385 static pages and emitted OG
  runtime checks. The build retained the existing non-fatal Privy optional
  Farcaster Solana module warning.
- Exact-head Product UX, frontend ReviewGPT, and CI gates begin immediately
  after this implementation commit is pushed; the pull request remains
  unmerged.
Completed: 2026-09-01
