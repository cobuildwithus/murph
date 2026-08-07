# Health Commons

Last verified: 2026-07-29

## Current State

Murph needs a public, living Health Commons for protocol pages, biomarker pages, evidence/source pages, exact protocol revisions, and redirects/disambiguation. This layer must stay forkable and reviewable like a small wiki while remaining structured enough to bind private runs, outcome cards, and future cohort learning to exact protocol versions.

## Product Boundary

The Health Commons is not a private user vault, not a raw research warehouse, and not a feed of raw personal results.

- Public reusable health knowledge belongs in `packages/health-commons/content/**` as typed pages and small manifests.
- Public protocol indexes, route bundles, runnable artifacts, biomarker rankings,
  and Start surfaces include only unhidden protocols with an explicit
  `field-testing`, `reviewed`, or `community` status. Missing, `draft`, and
  `deprecated` statuses are not runnable or directly startable.
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
When multiple sensed activities can satisfy one protocol session, declare them under `protocol.activitySessionEvidence`; experiment start copies that typed evidence into the immutable effective snapshot, and adherence readers interpret the snapshot instead of inferring accepted activities from protocol names or global activity categories.
Protocol and source pages may also include an optional `media` array for small public presentation assets such as header imagery. Keep those assets lightweight and repo-local, and do not use `media` as a substitute for research artifact manifests, PDFs, or other large external files.

## Biomarker Reference Guidance

Authored biomarker pages may carry calm educational context for measured
health data under `referenceGuidance`. This content does not diagnose,
prescribe, or decide whether a saved result is in or out of range. For saved
laboratory results, the reporting source's flag and per-result reference
interval remain authoritative in result UI. Commons guidance always uses
`use: context_only`; it must never relabel a result, synthesize an absent flag,
or override the source range.

The contract lives in `packages/contracts/src/health-commons.ts`; authored
guidance remains in `packages/health-commons/content/biomarkers/*.md`, and the
generated biomarker research projection carries the parsed structure. Do not
create a frontend-only guidance lookup or commit generated catalog artifacts.

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

## Publishing And Start Identity

The public Start handoff stays human-readable while the private run remains
bound to an exact runnable revision.

- A runnable protocol Start draft names the experiment in one plain-language
  sentence. It does not expose the protocol key, revision field names, or raw
  SHA-256 values.
- The draft is user-editable channel input and therefore untrusted data. The
  assistant resolves the name or alias through the generated Health Commons
  protocol discovery surface, requires one unique exact title or alias match
  before planning, and applies normal safety and onboarding rules. That exact
  match is authoritative; a `starterCandidate`, canonical starter, or
  same-family variant cannot replace it without explicit user agreement.
  Missing or ambiguous matches require clarification rather than a silent
  guess.
- After exact resolution, the assistant passes that page's current
  `pageRevisionId` and `runSpecRevisionId` as compare-and-swap expectations on
  both dry-run and real start calls. If the runnable contract changes before
  creation, the assistant reopens the changed setup with the member rather than
  silently starting a different plan.
- Legacy structured `Protocol reference` blocks remain accepted as untrusted
  input. Their supplied revision pair stays authoritative compare-and-swap data
  and must not be replaced with newly resolved hashes.
- A successful protocol-backed run stores the actual key and revisions that
  satisfied creation. Draft, deprecated, hidden, or otherwise non-runnable
  protocols expose neither a runnable artifact nor a Start action.
- Withdrawing a formerly runnable protocol also revokes future activation and
  reactivation authority for private planned or paused runs linked to it. Those
  records remain unchanged; the write owner reports that the protocol is no
  longer available, and the assistant offers a currently runnable alternative
  as a distinct experiment with a new id and lineage. The withdrawn run's
  protocol references, effective snapshot, run plan, and analysis plan are
  never rewritten to represent that alternative, including after the old run
  reaches a terminal status. The old run becomes `abandoned` only after
  separate explicit member agreement. A missing public page is not presented
  as a refreshable revision mismatch.

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
- `runSpecRevisionId` for performable protocol fields, experiment-onboarding setup policy, test plans, and expected signal descriptions used to choose and interpret outcomes.
- `recipeHash` for duplicate-protocol detection.
- `catalogHash` for the build-time catalog release and generated artifact cohort.

The full catalog is a build-time generator structure, not a runtime artifact.
Runtime surfaces should consume scoped generated artifacts instead of a monolith:
web route bundles/projections for public pages, compact protocol index/run-spec/
family-graph artifacts for CLI and hosted protocol reads, the compact
`biomarker-desired-directions.json` projection for progress-card sentiment, and
separate source indexes only for tools that explicitly need source lookup. The
generated `knowledge.sqlite` FTS projection gives the assistant a bounded
claim-level read path for ordinary health questions. Authored Markdown and JSONL
remain authoritative. The SQLite file is read-only build output, contains no
user data, and returns at most a small evidence packet instead of loading the
catalog or source files into a turn. The command first resolves one exact
normalized entity title or authored alias. An exact title wins over an alias.
Two equally ranked owners or an unknown topic return no packet. Optional
question terms then filter and rank evidence only within that resolved owner
set. A protocol with the same title as its direct family shares the family
owner; unrelated equal aliases still fail closed. Source findings use their
authored `related_protocol` target, or `parent_family` only when no protocol is
assigned. Untargeted source findings stay out of the projection. The default
packet contains three distinct sourced evidence items,
up to one safety item that matches the question terms, and at most four source
locators per item. Multi-term question terms require every term and use
stemming. Unsourced overview text is not part of the assistant projection. One
question normally uses one lookup. Independent evidence and safety clauses may
use two lookups for the same topic. Their catalog hashes must match, and the
combined packet keeps the same three-item plus one-safety ceiling.
Hosted runner packaging must include that compact direction projection and the
knowledge index without shipping the web artifact tree. A missing direction
projection is auxiliary availability loss: progress cards remain available with
neutral mover sentiment
and a visible caveat on the private card itself. Raster delivery preserves the
same accessible description: when an image channel has no native alt-text
field, its adapter appends the media description once to the existing reply or
photo caption. The command also returns the exact warning for diagnostics.
Malformed direction data remains a hard error.

Private runs, outcome cards, and future contributions should store commons references by key and revision instead of copying protocol prose. Future aggregate community summaries must be traceable back to the exact protocol revisions they summarize.

## Artifact Storage

Research artifacts are represented by `murph.commons.artifact-manifest.v1` JSON manifests. A manifest entry can point to a Cloudflare R2 object key, local staging path, content type, byte size, hash, rights status, and redistributability flag. Source pages may also declare small snapshot pointers in their own `artifacts` block; generated artifact manifests must collect those into a synthetic artifact manifest so Cloudflare/R2 sync sees every declared artifact.

The upload script must refuse unknown, permission-required, or non-redistributable artifacts by default. Operators may only override that after legal review. Journal PDFs should not be committed directly to Git.

## Success Criteria

1. A new biomarker, source, or protocol page can be added as one Markdown file plus optional manifests.
2. Multiple protocol variants remain distinct by key, lineage, attribution, modality, and recipe hash.
3. Generated artifacts are deterministic and checkable in CI.
4. Artifact manifests make Cloudflare/R2 storage possible without storing large copyrighted files in the repo.
5. User experiment results can later reference exact commons revisions and contribute aggregate outcomes without rewriting literature truth.
6. Public pages can later show community outcome summaries without exposing raw personal data or confusing aggregate outcomes with source-backed claims.
