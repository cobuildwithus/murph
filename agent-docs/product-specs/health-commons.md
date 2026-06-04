# Health Commons

Last verified: 2026-05-13

## Current State

Murph needs a public, living Health Commons for protocol pages, biomarker pages, evidence/source pages, exact protocol revisions, and redirects/disambiguation. This layer must stay forkable and reviewable like a small wiki while remaining structured enough to bind private runs, outcome cards, and future cohort learning to exact protocol versions.

## Product Boundary

The Health Commons is not a private user vault, not a raw research warehouse, and not a feed of raw personal results.

- Public reusable health knowledge belongs in `packages/health-commons/content/**` as typed pages and small manifests.
- Generated runtime projections and catalog artifacts materialize under `packages/health-commons/generated/**` as ignored build artifacts. Generated projections may include authored or placeholder community outcome fields, but run-derived aggregate summaries from opted-in Murph runs are future work.
- Private user runs and private outcome cards continue to live outside the Health Commons, bound to exact commons keys and revisions.
- Explicit public contributions may inform generated cohort summaries, but raw private run records never become article prose.
- Large PDFs, screenshots, and extracted full text stay outside Git and are referenced by artifact manifests.

## Canonical Objects

The storage primitive is a typed wiki page plus generated projections. Product/domain nouns map onto that shape like this:

| Product concept | Stored form |
| --- | --- |
| Biomarker page | `entityType: biomarker` |
| Intervention page | `entityType: experiment_family`, `familyKind: intervention` |
| Modality page | `entityType: experiment_family`, `familyKind: modality` |
| Protocol spec | `entityType: protocol_variant` |
| Source | `entityType: source_artifact` |
| Source person | `entityType: source_person` |
| Ambiguous name | `entityType: disambiguation` |
| Aggregate community outcome summary | future generated projection attached to biomarker and/or protocol entities after an explicit contribution pipeline exists |

Protocol pages must include lineage, attribution, a performable protocol block, safety, and at least one test plan. Claims must cite source pages unless they are explicitly labeled as community outcomes.
Protocol pages may also include an optional compact `experimentOnboarding` block that stores only protocol-specific onboarding deltas, such as start intent, safety-screen questions, setup slots, selected test plan, first-session guidance, adaptation policy, and tracking/support hints. Generic vault-read behavior, plan timing, adherence targets, readable logging labels, and stable session log ids come from assistant instructions plus canonical `testPlans`, `protocol.logFields`, `protocol.sessionFieldIds`, `protocol`, and `safety` fields; only stable extra confounder log ids belong in `trackingHints.confounderFields`, while prose confounder guidance stays in `trackingHints.confounders` or `notes`.
Protocol and source pages may also include an optional `media` array for small public presentation assets such as header imagery. Keep those assets lightweight and repo-local, and do not use `media` as a substitute for research artifact manifests, PDFs, or other large external files.

## Protocol Summary Copy

Protocol frontmatter `summary:` copy is governed by `agent-docs/product-specs/protocol-summary-copy.md`. Use that file as the source of truth when generating or reviewing the `/experiments` card description below a protocol title.

## Literature And Community Evidence

The Health Commons carries two different kinds of public truth and they must stay visibly distinct:

- **Literature-backed claims** describe what the cited sources say.
- **Community outcome summaries** describe what opted-in Murph runs appear to show.

Community outcome summaries must never silently rewrite the literature-backed page body. Today, generated Health Commons artifacts may carry authored or `coming_soon` placeholders only. When run-derived summaries exist, they should surface as generated blocks with clear caveats such as cohort size, confidence, trust-tier mix, and confounders or selection limits when known.

If the contribution pool is too small, too noisy, or too privacy-sensitive, the correct output is no public summary.

## Family Key Style

Prefer user-facing experiment-family keys for modalities people recognize in the product. Use `experiment_family:dry-sauna` and `experiment_family:infrared-sauna` as sibling families under the broader `experiment_family:sauna` parent instead of hiding them under nested keys such as `experiment_family:sauna/finnish-dry`.

This keeps browse, search, disambiguation, and future forks easier to understand while preserving typed parent links for the broader passive-heat graph. Old nested keys should be represented as redirects, not duplicated active pages.

## Protocol Variants And Forks

Exact protocol variants should remain separate pages with explicit lineage rather than collapsing materially different routines into one generic article.

When Murph later supports community forks, those forks should be structured diffs against a parent protocol version with named changed fields such as frequency, modality, dose, or timing. The commons should not accept anonymous free-form rewrites with no lineage.

## Versioning

Generated entities carry:

- `pageRevisionId` for the whole page.
- `runSpecRevisionId` for performable protocol fields, experiment-onboarding setup policy, and test plans.
- `recipeHash` for duplicate-protocol detection.
- `catalogHash` for the generated catalog release.

Private runs, outcome cards, and future contributions should store commons references by key and revision instead of copying protocol prose. Future aggregate community summaries must be traceable back to the exact protocol revisions they summarize.

## Artifact Storage

Research artifacts are represented by `murph.commons.artifact-manifest.v1` JSON manifests. A manifest entry can point to a Cloudflare R2 object key, local staging path, content type, byte size, hash, rights status, and redistributability flag. Source pages may also declare small snapshot pointers in their own `artifacts` block; generated catalogs must collect those into a synthetic artifact manifest so Cloudflare/R2 sync sees every declared artifact.

The upload script must refuse unknown, permission-required, or non-redistributable artifacts by default. Operators may only override that after legal review. Journal PDFs should not be committed directly to Git.

## Success Criteria

1. A new biomarker, source, or protocol page can be added as one Markdown file plus optional manifests.
2. Multiple protocol variants remain distinct by key, lineage, attribution, modality, and recipe hash.
3. Generated catalog output is deterministic and checkable in CI.
4. Artifact manifests make Cloudflare/R2 storage possible without storing large copyrighted files in the repo.
5. User experiment results can later reference exact commons revisions and contribute aggregate outcomes without rewriting literature truth.
6. Public pages can later show community outcome summaries without exposing raw personal data or confusing aggregate outcomes with source-backed claims.
