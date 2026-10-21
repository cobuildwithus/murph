# Health Commons

Last verified: 2026-10-19

## Current State

Murph maintains Health Commons content for assistant evidence, goal templates,
biomarker knowledge, measurement methods, source pages, exact reusable revisions,
and redirects. It stays forkable and reviewable like a small wiki while remaining
structured enough to bind private goals to exact public versions. The standalone
public `/goals` guides and `/knowledge` marketing page are retired.

The public experiment catalog is retired. Commons no longer publishes protocol
variants, experiment families, their onboarding blocks, test plans, media, or
protocol run-spec artifacts, and there is no public experiment website.
Assistant-led private experiments remain in the vault and do not depend on
Commons content; see `experiment-onboarding.md`.

## Product Boundary

The Health Commons is not a private user vault, not a raw research warehouse, and not a feed of raw personal results.

- Public reusable health knowledge belongs in `packages/health-commons/content/**` as typed pages and small manifests.
- Generated runtime projections and catalog artifacts materialize under `packages/health-commons/generated/**` as ignored build artifacts.
- Private goals and experiments live outside the Health Commons. Historical runs may retain a saved `commonsProtocolRef` and immutable protocol snapshot; those private records stay readable without a current Commons page and are never rewritten from Commons.
- Raw private run records never become article prose.
- Large PDFs, screenshots, and extracted full text stay outside Git and are referenced by artifact manifests.

## Canonical Objects

The storage primitive is a typed wiki page plus generated projections.

| Product concept | Stored form |
| --- | --- |
| Biomarker reference entity | `entityType: biomarker` |
| Outcome-first Goal guide | `entityType: goal_template` |
| Measurement method | `entityType: measurement_method` |
| Source | `entityType: source_artifact` |
| Source person | `entityType: source_person` |

Claims must cite source pages.

## Biomarker Reference Guidance

Authored biomarker entities may carry calm educational context for measured
health data under `referenceGuidance`. This content does not diagnose,
prescribe, or decide whether a saved result is in or out of range. For saved
laboratory results, the reporting source's flag and per-result reference
interval remain authoritative in result UI. Commons guidance always uses
`use: context_only`; it must never relabel a result, synthesize an absent flag,
or override the source range.

The contract lives in `packages/contracts/src/health-commons.ts`; authored
guidance remains in `packages/health-commons/content/biomarkers/*.md`, and the
canonical knowledge readers carry the parsed structure. The retired Biomarkers
website has no browse/detail projections, browser presentation selectors, or
curated navigation grouping. Raw lab replica rows and export remain supported.
Do not create a frontend-only guidance lookup or commit generated catalog artifacts.

```yaml
referenceGuidance:
  classification: conditional_numeric
  reviewStatus: reviewed
  use: context_only
  items:
    - kind: decision_limit
      guidance: "What the reviewed source says, in concise member-readable language."
      applicability: "The population, specimen, timing, assay, method, or clinical context in which it applies."
      numericValues:
        - label: "Named comparator"
          unit: "mg/dL"
          upperBound:
            value: 100
            inclusive: false
      source:
        title: "Source title"
        organization: "Issuing organization or journal"
        year: 2026
        sourceType: clinical_guideline
        url: "https://example.org/source"
```

A source records its title, organization or journal, year, source type, and at
least one stable locator (`url`, `doi`, or `pmid`). For a living assay catalog
without a stated publication date, `year` records the reviewed revision year;
the exact title and URL identify the living document.

| Classification | Meaning |
| --- | --- |
| `generally_applicable_numeric` | A broadly used numeric decision framework with explicit exclusions and assay requirements; it remains context, not a result label. |
| `conditional_numeric` | Numeric guidance changes materially with population, age, sex, pregnancy, fasting state, collection time, risk stratum, treatment context, or another named condition. |
| `qualitative` | The result is categorical, narrative, titer-based, or otherwise not represented by a manufactured numeric interval. |
| `calculated_or_method_specific` | The value depends on a formula, component inputs, instrument, specimen, or named assay and retains that provenance. |
| `source_range_only` | A local laboratory or assay interval is the defensible numeric source, so Commons does not substitute a portable interval. |
| `no_universal_range` | Evidence does not support one universal numeric range for the requested entity; this is a reviewed conclusion, not missing work. |

Guidance may retain conflicting sources as separate items instead of choosing a
false consensus. Numeric values store explicit lower and upper bounds with an
`inclusive` flag. A comparator such as `<10` is an exclusive upper bound at 10,
never the exact point 10. Keep each source's units; add equivalents only for
straightforward, dimensionally valid, verified conversions. Never merge
non-equivalent assays, particle and mass concentrations, percentages and
absolute counts, direct and calculated values, specimen types, or similarly
named analytes.

Metric identities are canonicalized in `@murphai/health-metrics`. Reuse an
existing authored Commons entity only through
`packages/health-commons/src/biomarker-entity-mappings.ts` and only for a true
analyte identity. Percentage and absolute differential counts; generic,
CKD-EPI, and historical MDRD eGFR outputs; LDL calculation methods; fatty-acid
panels and components; specimen-specific exposures; and point-of-care troponin
assays remain distinct when their provenance or interpretation differs.

Every measured biomarker admitted to the reviewed content set has an authored
page or an explicit mapping to the correct page. Its `summary` is one
non-placeholder sentence explaining what the marker measures and why it can
matter without diagnosis, hype, commands, or treating one result as a verdict.
It also has reviewed guidance or an explicit reviewed `no_universal_range`
classification. `packages/health-commons/test/requested-biomarker-content.test.ts`
locks these identity, summary, source, classification, comparator, and coverage
rules.

## Assistant Skill Boundary

Health Commons owns reusable public health facts, evidence limits, safety guidance, and symptom-sensitive care decisions. This includes knowledge-only topics that have no public UI page.

Assistant skills must not duplicate that topic knowledge. A skill can still own a tool procedure or a stateful product workflow, such as booking care after the Health Commons result establishes the destination. General eye-health and recovery-modality guidance therefore live in Health Commons rather than topic skills.

## Literature Evidence

Commons pages describe what cited sources say. They do not publish community
outcome summaries or results derived from private runs.

## Versioning

Generated entities carry:

- `pageRevisionId` for the whole page.
- `workflowSpecRevisionId` for the reusable outcome and private setup contract on a Goal guide.
- `catalogHash` for the build-time catalog release and generated artifact cohort.

`runSpecRevisionId` and `recipeHash` survive only as historical values in saved
private experiment lineage.

The full catalog is a build-time generator structure, not a runtime artifact.
Runtime surfaces consume scoped generated artifacts instead of a monolith:
web route bundles and projections for public pages, the compact Goal browse
index, the compact `biomarker-desired-directions.json` projection for progress-card
sentiment, and separate source indexes only for tools that explicitly need
source lookup. The generated `knowledge.sqlite` FTS projection
gives the assistant a bounded claim-level read path for ordinary health
questions. Authored Markdown and JSONL remain authoritative. The SQLite file is
read-only build output, contains no user data, and returns at most a small
evidence packet instead of loading the catalog or source files into a turn. One
command accepts the complete health question. It resolves a contiguous authored
title or alias before using a conservative title-and-alias token fallback. A
canonical title ranks above an alias, and a longer specific phrase ranks above a
shorter phrase. Equal owners remain ambiguous and return at most three
candidates. Evidence text, source titles, citations, categories, and stems
never admit a topic.

After topic resolution, the reader removes the matched topic phrase and small
grammar terms. It uses the remaining medical terms only inside that owner. A
broad question runs a bounded owner-wide lookup without a reserved phrase.
Evidence and safety use separate internal queries but one assistant call.
Unrelated equal aliases fail closed. Source findings enter the projection only
with one unambiguous owner target; multi-target and untargeted findings stay
out until their ownership is authored more precisely. Safety comes only from a
directly sourced safety claim or typed source finding. Page-wide `safety`
arrays do not enter the source-backed projection. The default packet contains
three distinct sourced evidence items, up to one safety item that matches the
question terms, and at most four source locators per item. Unsourced overview
text and all editorial evidence-appraisal rows are not part of the assistant
projection. Claims and extracted typed findings are the only member-facing
evidence shapes. The CLI returns the resolved topic or ambiguity candidates,
not query internals, `focus`, or catalog-hash merge work.
The assistant does one lookup. It does not create an experiment unless the
member authorizes setup. In a private direct conversation, it may suggest one
context-grounded bounded trial without experiment vocabulary when a persistent
or recurring problem remains unresolved, the member is seeking help, and one
safe reversible uncertainty could change the next decision. That exception does
not apply to factual questions, logging or record updates, requests to be heard
without problem-solving, acute or unstable situations, cases primarily owned by
urgent or clinician-led evaluation, decisions the existing record already
resolves, or cases where one clearly indicated direct action makes comparison
unnecessary. A proposal never authorizes a run, reminder, check-in, or tracking
plan; each requires its own applicable authorization.
An authored knowledge page can support this lookup without a UI.
Hosted runner packaging must include that compact direction projection, the
knowledge index, and the compact public Goal index without shipping the rest of
the web artifact tree. A missing direction
projection is auxiliary availability loss: progress cards remain available with
neutral mover sentiment
and a visible caveat on the private card itself. Raster delivery preserves the
same accessible description: when an image channel has no native alt-text
field, its adapter appends the media description once to the existing reply or
photo caption. The command also returns the exact warning for diagnostics.
Malformed direction data remains a hard error.

## Artifact Storage

Research artifacts are represented by `murph.commons.artifact-manifest.v1` JSON manifests. A manifest entry can point to a Cloudflare R2 object key, local staging path, content type, byte size, hash, rights status, and redistributability flag. Source pages may also declare small snapshot pointers in their own `artifacts` block; generated artifact manifests must collect those into a synthetic artifact manifest so Cloudflare/R2 sync sees every declared artifact.

The upload script must refuse unknown, permission-required, or non-redistributable artifacts by default. Operators may only override that after legal review. Journal PDFs should not be committed directly to Git.

## Success Criteria

1. A new biomarker, Goal guide, measurement method, or source page can be added as one Markdown file plus optional manifests.
2. Generated artifacts are deterministic and checkable in CI.
3. Artifact manifests make Cloudflare/R2 storage possible without storing large copyrighted files in the repo.
4. Saved private experiments remain readable without any Commons protocol content.
