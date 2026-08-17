# Fix public search coverage metadata

Status: active
Created: 2026-08-17
Updated: 2026-08-17

## Goal

- Give search crawlers one explicit, canonical inventory of Murph's public pages while keeping private, transitional, and internal routes out of that inventory.

## Success criteria

- `/robots.txt` returns a valid crawler policy and advertises `/sitemap.xml`.
- `/sitemap.xml` contains only intended public, canonical URLs on the production host.
- Public static pages linked from the site have explicit canonical metadata.
- Internal presentation routes that should not appear in search declare `noindex` explicitly.
- Focused metadata tests and the hosted Web typecheck pass.

## Scope

- In scope: Next.js metadata routes, canonical metadata for public static pages, explicit indexing policy for internal static pages, and focused tests.
- Out of scope: Search Console validation requests, redirects whose current behavior is intentional, dynamic product inventory submission, and content rewrites intended only to influence ranking.

## Constraints

- Technical constraints: use Next.js metadata conventions, keep the production host centralized, and avoid runtime/database reads in crawler metadata routes.
- Product/process constraints: preserve user-facing routes and product behavior, expose no private route or member data, and complete the PR/coverage review workflow.

## Risks and mitigations

1. Risk: accidentally publishing authenticated or tokenized routes in the sitemap.
   Mitigation: use an explicit allowlist of static public routes with a focused exact-list test.
2. Risk: changing crawl policy without changing indexability.
   Mitigation: use page-level canonical or `noindex` metadata as the authority and keep robots permissive for renderable pages.

## Tasks

1. [x] Audit production responses and repository metadata against the supplied coverage categories.
2. [x] Add the canonical public-site URL owner plus robots and sitemap metadata routes.
3. [x] Add missing canonical metadata and explicit internal-route `noindex` declarations.
4. [x] Add focused tests for exact crawler outputs and metadata intent.
5. [ ] Complete the required exact-head PR review and CI gates.

## Decisions

- Treat the supplied archive as aggregate evidence only because it contains issue counts but no affected URL list.
- Keep workflow/private pages crawlable enough for their `noindex` metadata to be observed; do not use `robots.txt` as an indexing substitute.
- Accept the preliminary coverage finding and strengthen test oracles only; the production ownership and route policy remain unchanged.
- Treat metadata-only route-module edits as non-visual in the design-proof gate by comparing dependency-free rendered-route signatures; keep the catalog and screenshot requirement for any remaining UI change.
- Accept the final-audit viewport finding: viewport exports affect responsive presentation and zoom accessibility, so only metadata and generateMetadata exports qualify for the non-visual exemption.

## Verification

- Passed focused hosted-Web Vitest metadata coverage: 5 files and 41 tests.
- Passed the specialist-requested exact-inventory and biomarker-research metadata slice: 2 files and 10 tests.
- Passed focused ESLint for every changed source and test file.
- Passed the hosted-Web typecheck, including the repository-owned Health Commons and Prisma generation prerequisites.
- Direct sitemap coverage proof is part of the focused test: one canonical host, no duplicate URLs, all published Health Commons routes present, and private/result/internal routes absent.
- Passed all 13 frontend design-proof checker tests, including metadata-only helpers plus rendered-body, import, static viewport, and generated viewport controls; the checker reports no UI change for the exact task diff.

## Round 3 change-shape retrospective

- Trigger and attribution: the first-reviewed patch was 320 additions and 9 deletions; review and CI remediation added the rendered-route signature, metadata-export stripping, frontend proof classification, and guard tests alongside the original crawler host, sitemap, dashboard inheritance, canonical, and robots work.
- Options considered: deletion or reversion restores the reproduced metadata-only CI false positive; splitting leaves this exact patch blocked until a prerequisite PR merges; shrinking already removed runtime dependencies and narrowed the exemption to metadata and `generateMetadata` only.
- Decision: justified continuation. The existing frontend design-proof guard is the sole owner that misclassified the required route metadata edits, so correcting that owner is indivisible from completing the crawler fix truthfully.
- Invariant proof: additions, deletions, component bodies, rendered imports, static viewport exports, and generated viewport exports remain frontend-affecting. The focused positive and negative controls and exact task-diff proof exercise the boundary.
- Complexity accounting: no production service, runtime state, dependency, middleware, queue, compatibility path, or lifecycle was added; the broadened concept is one CI classifier inside its existing owner.
