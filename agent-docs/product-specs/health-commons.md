# Health Commons

Last verified: 2026-04-20

## Current State

Murph needs a public/reference knowledge layer for protocol pages, biomarker pages, evidence/source pages, redirects, disambiguation, and future community outcome summaries. This layer must stay forkable and reviewable like a small wiki while remaining structured enough for the experiment engine to run exact protocol revisions.

## Product Boundary

The Health Commons is not a private user vault and not a raw research warehouse.

- Public reusable health knowledge belongs in `packages/health-commons/content/**` as typed pages and small manifests.
- Runtime projections belong in `packages/health-commons/generated/**` and may be consumed by local Murph, hosted web, or Cloudflare execution.
- Private user runs continue to live in `bank/experiments/**` and ledgers, referencing exact commons keys and revisions.
- Large PDFs, screenshots, and extracted full text stay outside Git and are referenced by artifact manifests.

## Canonical Objects

The storage primitive is a typed wiki page. Product/domain nouns map onto page roles:

| Product concept | Stored page role |
| --- | --- |
| Biomarker page | `entityType: biomarker` |
| Intervention page | `entityType: experiment_family`, `familyKind: intervention` |
| Modality page | `entityType: experiment_family`, `familyKind: modality` |
| Protocol spec | `entityType: protocol_variant` |
| Source | `entityType: source_artifact` |
| Source person | `entityType: source_person` |
| Ambiguous name | `entityType: disambiguation` |

Protocol pages must include lineage, attribution, a performable protocol block, safety, and at least one test plan. Claims must cite source pages unless they are explicitly labeled as community outcomes.

## Versioning

Generated entities carry:

- `pageRevisionId` for the whole page.
- `runSpecRevisionId` for performable protocol fields and test plans.
- `recipeHash` for duplicate-protocol detection.
- `catalogHash` for the generated catalog release.

Private experiments should store commons references by key and revision instead of copying protocol prose.

## Artifact Storage

Research artifacts are represented by `murph.commons.artifact-manifest.v1` JSON manifests. A manifest entry can point to a Cloudflare R2 object key, local staging path, content type, byte size, hash, rights status, and redistributability flag.

The upload script must refuse unknown, permission-required, or non-redistributable artifacts by default. Operators may only override that after legal review. Journal PDFs should not be committed directly to Git.

## Success Criteria

1. A new biomarker, source, or protocol page can be added as one Markdown file plus optional manifests.
2. Multiple sauna protocols are distinct by key, lineage, attribution, modality, and recipe hash.
3. Generated catalog output is deterministic and checkable in CI.
4. Artifact manifests make Cloudflare/R2 storage possible without storing large copyrighted files in the repo.
5. User experiment results can later reference exact commons revisions and contribute aggregate outcomes without rewriting article truth.
