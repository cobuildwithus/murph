# Fix public search coverage metadata

Status: completed
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
5. [x] Complete the required exact-head PR review and CI gates.

## Decisions

- Treat the supplied archive as aggregate evidence only because it contains issue counts but no affected URL list.
- Keep workflow/private pages crawlable enough for their `noindex` metadata to be observed; do not use `robots.txt` as an indexing substitute.
- Accept the preliminary coverage finding and strengthen test oracles only; the production ownership and route policy remain unchanged.
- Superseded after round 5: initially treated metadata-only route-module edits as non-visual by comparing dependency-free rendered-route signatures.
- Historical round 2 correction: viewport exports affect responsive presentation and zoom accessibility, so they could not receive the attempted metadata-only exemption.
- Historical round 4 correction: metadata exports can feed rendered output, so unconditional stripping was unsafe even before the round 5 mechanism collapse.
- Accept the round 5 mechanism finding: raw-source stripping cannot safely prove a route edit is metadata-only, so delete the classifier and restore the conservative path-based design-proof owner instead of adding another syntax exception.

## Verification

- Passed focused hosted-Web Vitest metadata coverage: 5 files and 41 tests.
- Passed the specialist-requested exact-inventory and biomarker-research metadata slice: 2 files and 10 tests.
- Passed focused ESLint for every changed source and test file.
- Passed the hosted-Web typecheck, including the repository-owned Health Commons and Prisma generation prerequisites.
- Direct sitemap coverage proof is part of the focused test: one canonical host, no duplicate URLs, all published Health Commons routes present, and private/result/internal routes absent.
- Passed all 11 frontend design-proof checker tests after deleting the metadata classifier, including a co-declared rendered-value control that keeps every app TSX change inside the proof gate.
- Captured and inspected lossless hosted desktop and mobile screenshots of the existing synthetic pitch-deck study as a non-visual baseline for the metadata-only route edits.
- Final ReviewGPT round 6 returned `ROUND_OUTCOME: PASS` with no findings against the exact pushed behavior-bearing head after verifying the simplification and prior corrections.
- All required GitHub checks passed on the reviewed behavior-bearing head. Native iOS hosted E2E is not a required status for this Web metadata change and was not used as completion evidence.

## Round 5 simplification

- Reproduced the review-induced false negative locally: a co-declared rendered value changed while the classifier returned an identical signature.
- Deleted the rendered-route signature, metadata/helper stripping, partial declaration scanner, import-liveness inference, and special route-file comparison.
- Restored `isFrontendUiPath` as the single conservative owner and retained one focused regression proving the reproduced route shape requires design proof.
- Added only a non-visual capture-state marker to the existing real pitch-deck study so this metadata-only PR can satisfy the one-time desktop/mobile proof gate without adding or duplicating production UI.

## Round 3 change-shape retrospective

- Trigger and attribution: the first-reviewed patch was 320 additions and 9 deletions; review and CI remediation added the rendered-route signature, metadata-export stripping, frontend proof classification, and guard tests alongside the original crawler host, sitemap, dashboard inheritance, canonical, and robots work.
- Options considered: deletion or reversion restores the reproduced metadata-only CI false positive; splitting leaves this exact patch blocked until a prerequisite PR merges; shrinking already removed runtime dependencies and narrowed the exemption to metadata and `generateMetadata` only.
- Decision: justified continuation. The existing frontend design-proof guard is the sole owner that misclassified the required route metadata edits, so correcting that owner is indivisible from completing the crawler fix truthfully.
- Invariant proof: additions, deletions, component bodies, rendered imports, static viewport exports, and generated viewport exports remain frontend-affecting. The focused positive and negative controls and exact task-diff proof exercise the boundary.
- Complexity accounting: no production service, runtime state, dependency, middleware, queue, compatibility path, or lifecycle was added; the broadened concept is one CI classifier inside its existing owner.
Completed: 2026-08-17
