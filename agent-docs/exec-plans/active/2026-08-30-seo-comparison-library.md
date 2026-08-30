# Source-backed competitor comparison library

Status: active
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Publish a source-backed library of at least 60 static public pages that help
  someone decide whether Murph should replace, complement, or be used instead
  of a named consumer health product.
- Make every page useful to a human reader and legible to search crawlers and
  answer agents through concise answers, semantic HTML, explicit source links,
  stable metadata, and honest product boundaries.

## Success criteria

- `/compare` provides a calm, scannable index grouped by the job a visitor is
  trying to do, with useful copy rather than a link farm.
- 102 `/compare/murph-vs-<competitor>` routes are pre-rendered from a
  typed catalog, have distinct titles/descriptions/verdicts/details/FAQs, and
  include current first-party source links plus a visible verification date.
- Each detail page answers the replacement-versus-complement question above
  the fold, includes a responsive semantic comparison table, discusses who
  each product is for, names material limitations, and links to relevant peer
  comparisons.
- Metadata includes canonical URLs and share metadata; the routes appear in the
  XML sitemap and remain crawlable under the existing robots policy.
- Machine-readable markup is limited to truthful page, breadcrumb, and FAQ
  semantics that match visible content. No unsupported ratings, winners, or
  medical outcome claims are emitted.
- Automated tests reject duplicate slugs, missing research sources, too-short
  authored copy, invalid URLs, non-unique metadata, and fewer than 60 entries.
- Desktop and mobile browser proof show no horizontal viewport overflow and a
  repository-owned `/design?tab=components#public-comparison-table` study
  renders the production comparison UI with synthetic content.
- Focused tests, hosted Web typecheck, lint for touched files, production build,
  required review passes, and exact-head PR checks complete successfully.

## Scope

- In scope:
  - Direct consumer health assistants and adjacent products across wearables,
    health records/dashboards, labs/longevity, sleep/recovery, fitness,
    nutrition/weight, and mental wellbeing.
  - Current first-party product facts verified on 2026-08-30, with volatile
    pricing phrased cautiously and linked to the current official source.
  - Static route generation, comparison UI, metadata/structured data, sitemap,
    internal navigation, focused catalog/rendering tests, design proof, and a
    public changelog entry.
- Out of scope:
  - B2B data infrastructure, discontinued products, and utilities that are not
    plausible consumer alternatives, except where a short educational contrast
    materially prevents confusion.
  - Live pricing APIs, review scores, affiliate links, scraped testimonials,
    competitor logos, medical efficacy rankings, or claims that Murph directly
    integrates with every compared product.
  - Product changes to Murph, new data connectors, paid acquisition pages, or
    localization in this task.

## Constraints

- Technical constraints:
  - Use one server-rendered route and typed authored catalog with
    `generateStaticParams`; do not create dozens of copy-pasted page modules or
    introduce a CMS/dependency for static editorial content.
  - Keep the route useful without client JavaScript. Preserve Next.js 16 async
    route conventions and existing public-origin ownership.
  - Use semantic table, heading, link, definition-list, and structured-data
    markup. Structured data must exactly reflect visible page content.
- Product/process constraints:
  - Murph is a private, conversation-first health relationship, not a medical
    provider and not a replacement for hardware that measures the body.
  - Complement framing is the default for wearables, record repositories, and
    clinical services. “Better” is used only for a named job-to-be-done, never
    as an absolute ranking.
  - Use the warm flat-paper visual system, Fraunces/DM Sans/DM Mono hierarchy,
    sage as the sole affirmative accent, hairline dividers, no shadows, no
    gradients, no nested cards, and no em dashes in interface copy.
  - Treat each organic visitor as potentially privacy-sensitive, clinically
    vulnerable, mobile-first, or already invested in the competing product.
  - The user's request is the explicit approval for this comparison-library
    product path. Material exclusions above preserve that intent while avoiding
    unsafe or misleading scope expansion.

## Risks and mitigations

1. Risk: A large route set becomes thin scaled content or doorway pages.
   Mitigation: enforce individually authored verdicts, descriptions, fit and
   limitation copy, FAQs, product-specific table values, official citations,
   and category-aware internal links; omit candidates without enough evidence.
2. Risk: Fast-changing names, pricing, device generations, or availability make
   claims stale.
   Mitigation: show a per-guide verification date, link to first-party sources,
   avoid volatile exact prices when no stable public price exists, and keep the
   catalog simple to update.
3. Risk: The table implies unsupported equivalence or medical superiority.
   Mitigation: compare capabilities and operating models, not health outcomes;
   use plain “yes/no/varies” explanations and explicit medical boundaries.
4. Risk: Sixty pages harm build time or create accidental dynamic rendering.
   Mitigation: pure immutable data, static params, server components, no remote
   fetches at render time, and production-build inspection of generated routes.
5. Risk: Dense comparison content overflows or becomes unreadable on phones.
   Mitigation: responsive table treatment, short cells, visible row labels,
   mobile and desktop screenshots, and the viewport-overflow check.

## Tasks

1. Finish primary-source competitor and search/answer-agent research; choose the
   strongest evidence-backed set and record exclusions.
2. Inspect existing public-route, metadata, design-system, sitemap, robots,
   screenshot-study, changelog, and test patterns.
3. Implement the typed comparison catalog and invariant tests.
4. Implement the `/compare` index, static detail route, shared production view,
   semantic metadata/JSON-LD, sitemap entries, and design-catalog study.
5. Add a changelog fragment and any required living-document updates.
6. Run focused tests, lint/typecheck/build, inspect desktop/mobile output, and
   review the final diff for claim accuracy, privacy, accessibility, and scope.
7. Close the plan with scoped commit, open a draft PR, attach design proof, run
   required specialist/final review gates, remediate accepted findings, mark
   ready, and wait for exact-head required checks.

## Decisions

- Use `/compare/murph-vs-<competitor>` so route intent is explicit while one
  canonical catalog keeps authored facts and internal links maintainable.
- Prefer official product/help/pricing/legal pages over third-party summaries.
- Do not create a special `llms.txt` or speculative AI-only markup unless the
  primary-source discovery research establishes a supported contract.
- Avoid competitor imagery and trademarks beyond plain-text nominative use.

## Product UX plan

- Effort: Feature. This creates a new public decision surface and a new promise
  that Murph will explain product relationships without fake winner theater.
- Outcome: A visitor can quickly understand whether Murph replaces,
  complements, or differs from a named health product, then inspect the facts
  and official sources behind that answer.
- Entry and promise: A visitor enters through `/compare`, search, an answer
  agent citation, or a direct `/compare/murph-vs-<competitor>` link. The useful
  relationship answer appears before the exhaustive evidence and requires no
  sign-in, live data, or client JavaScript.
- Affected people:
  - A narrow-phone visitor comparing a product they already own needs the named
    relationship and choice guidance before dense evidence, with no clipped
    competitor content.
  - A desktop researcher needs a fast way to find one product among more than
    100 guides, scan the main differences, and verify claims against official
    sources.
  - A privacy-sensitive or clinically vulnerable visitor needs neutral
    language, a visible research-method disclosure, and clear medical and
    measurement boundaries.
- Deliberate exclusions: No rankings, affiliate calls to action, hands-on-test
  claims, review scores, medical outcome claims, or implied integrations that
  Murph does not provide.
- Proof: Real index and WHOOP/BodyBuddy routes at phone and desktop widths,
  responsive comparison-table captures, a 320-pixel overflow matrix, semantic
  render tests, and a production build containing the static route family.

## Product UX walkthrough

- Result: Ready.
- Narrow-phone path: `/compare` remains searchable and scannable; a detail page
  presents the relationship and choice guidance before evidence; every paired
  Murph/product value is visible in a stacked comparison layout; 320, 375, 390,
  and 768 pixel checks found no remaining horizontal overflow.
- Desktop path: the directory provides search and category navigation without
  hiding server-rendered links; detail pages preserve the concise relationship,
  decision strip, semantic table, tradeoffs, FAQs, and sources in a clear
  editorial hierarchy at 1280 pixels.
- Trust path: the visible desk-research, non-hands-on, non-affiliate disclosure
  matches structured provenance; official sources are grouped by product and
  connected to comparison rows through stable evidence references.
- Difference from the first pass: the original mobile table hid the competitor
  column, the index was a long single-column wall, and the useful answer arrived
  too late. The final candidate uses paired mobile rows, a compact multi-column
  searchable directory, and answer-first detail-page ordering.

## Verification

- Completed local proof:
  - Focused Vitest: 3 files and 22 tests passed for catalog invariants, rendered
    comparison pages, metadata/search, sitemap, and public agent guidance.
  - Scoped ESLint passed for every changed Web source, comparison data, test,
    and Playwright proof file.
  - `pnpm --dir apps/web typecheck:prepared` passed after the final responsive
    changes.
  - `pnpm --dir apps/web build` completed all 385 static pages and emitted the
    comparison index, detail, and Open Graph route families. The build retained
    an existing optional Privy/Farcaster dependency warning.
  - The task-scoped Playwright design-proof spec passed for the index, WHOOP,
    and BodyBuddy at desktop and phone widths with browser/page error
    assertions enabled.
  - The viewport-overflow proof passed for `/compare`, WHOOP, and BodyBuddy at
    320, 375, 390, 768, and 1280 pixels. A genuine 320-pixel index overflow was
    found during the first run, fixed, and independently rerun green.
  - Three independent official-source claim audits corrected the accepted
    wearable, health-data, assistant, lab, nutrition, fitness, sleep, and mental
    wellbeing findings; targeted stale-claim searches and scoped checks passed.
- Remaining external proof:
  - One exact-pushed-head `completion-specialists` ReviewGPT pass with Product
    UX, frontend, and coverage lenses as applicable.
  - Required exact-head pull-request checks and final current-base merge-tree
    proof.
