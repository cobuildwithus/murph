# Public blog and case-study publishing surface

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Ship a public Murph blog that can publish guides, field notes, and verified
  case studies, plus an operator-run Search Console intake that surfaces
  promising topics without creating a weekly report or auto-publishing claims.

## Success criteria

- `/blog` and `/blog/[slug]` are indexable, responsive, and use Murph's shared
  public navigation, footer, metadata, and design system.
- A typed content registry supports `guide`, `field-note`, and `case-study`
  entries and rejects duplicate or invalid publication data.
- Initial published articles are useful and factual without presenting current
  hypotheses or private-beta anecdotes as customer proof.
- A manual command can fetch twelve months of Search Console query-and-page
  rows for `sc-domain:withmurph.ai` and rank likely dedicated-content gaps.
- Focused tests, typecheck, browser proof, required review, exact-head CI, and
  the scoped PR workflow complete successfully.

## Scope

- In scope: public blog routes, article content model, initial editorial
  content, navigation/discovery links, design-catalog study, SEO metadata,
  sitemap/feed discovery, and a manual Search Console opportunity command.
- Out of scope: a CMS, scheduled or weekly reports, automatic article
  generation or publishing, fabricated customer outcomes, and committing or
  downloading Google credentials into the repository.

## Constraints

- Technical constraints: keep the App Router surface static, use existing
  dependencies and shared public-site primitives, and keep Search Console
  credentials outside the repository.
- Product/process constraints: public claims must distinguish product facts
  from hypotheses; case studies publish only after their evidence is verified;
  every production UI surface must render in the design catalog.

## Risks and mitigations

1. Risk: a case-study label implies proof Murph does not have yet.
   Mitigation: support the content type now, seed only guides and field notes,
   and encode an explicit evidence note for future case studies.
2. Risk: Search Console access introduces a long-lived secret.
   Mitigation: read a service-account JSON file from an operator-supplied path,
   never persist its contents, and keep generated opportunity files ignored.
3. Risk: a content system becomes a speculative CMS abstraction.
   Mitigation: use a small typed registry and existing Markdown renderer with
   no database, admin surface, or new dependency.

## Tasks

1. Build and test the typed editorial registry and initial content.
2. Build the blog index, article page, metadata, feed/sitemap discovery, and
   public navigation links from shared production components.
3. Add the production blog surface to the design catalog and capture desktop
   and mobile proof.
4. Add and test the manual Search Console opportunity intake and its operator
   documentation.
5. Run focused verification, exact-head review/CI, close this plan, and finish
   the scoped PR.

## Decisions

- Use `Blog` as the discoverable route and navigation label; use `Field notes`
  as the editorial voice inside the page.
- Treat Search Console gaps as high-impression query/page mismatches, not as
  queries with literally no ranking URL.
- Do not seed a customer case study until a result and permission are verified.

## Verification

- Commands to run: focused Vitest files for the editorial registry, routes,
  footer/navigation, and Search Console ranking; web typecheck; Playwright
  desktop/mobile design proof; preliminary ReviewGPT specialist pass; required
  exact-head GitHub Actions.
- Expected outcomes: all checks pass, rendered pages have no overflow or broken
  links, generated discovery output contains every published article, and the
  opportunity command fails closed on missing or malformed credentials.
