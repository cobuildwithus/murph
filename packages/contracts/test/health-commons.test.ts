import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
  HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
  HEALTH_COMMONS_CHANGE_SCHEMA_VERSION,
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  healthCommonsArtifactManifestSchema,
  healthCommonsArtifactPointerSchema,
  healthCommonsCatalogEntitySchema,
  healthCommonsCatalogSchema,
  healthCommonsChangeRecordSchema,
  healthCommonsClaimSchema,
  healthCommonsPageFrontmatterSchema,
  healthCommonsRedirectsFileSchema,
  isHealthCommonsEntityType,
} from "../src/health-commons.ts";
import { safeParseContract } from "../src/validate.ts";

const validArtifactPointer = {
  artifactId: "art_pmid_29849692_pdf",
  kind: "pdf",
  storage: "cloudflare-r2",
  objectKey: "commons/research/sauna/pmid-29849692/source.pdf",
  localPath: "research-artifacts/sauna/pmid-29849692.pdf",
  rightsStatus: "permission_required",
  redistributable: false,
} as const;

const validSourceArtifactPage = {
  schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  entityType: "source_artifact",
  key: "source_artifact:pmid-29849692",
  slug: "sources/pmid-29849692",
  title: "PMID 29849692",
  source: {
    kind: "web_page",
    url: "https://example.com/pmid-29849692",
  },
  artifacts: [validArtifactPointer],
} as const;

const validCatalogEntity = {
  ...validSourceArtifactPage,
  body: "Source body",
  relativePath: "content/sources/pmid-29849692.md",
  revision: {
    pageRevisionId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runSpecRevisionId: null,
    recipeHash: null,
  },
} as const;

describe("@murphai/contracts health commons schemas", () => {
  it("accepts the source-artifact page and manifest shapes used by Health Commons", () => {
    expect(safeParseContract(healthCommonsArtifactPointerSchema, validArtifactPointer)).toEqual({
      success: true,
      data: validArtifactPointer,
    });
    expect(
      safeParseContract(healthCommonsArtifactManifestSchema, {
        schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        manifestKey: "source_artifact:pmid-29849692/research-artifacts",
        artifacts: [validArtifactPointer],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
        manifestKey: "source_artifact:pmid-29849692/research-artifacts",
        artifacts: [validArtifactPointer],
      },
    });
    expect(safeParseContract(healthCommonsPageFrontmatterSchema, validSourceArtifactPage)).toEqual({
      success: true,
      data: validSourceArtifactPage,
    });
    expect(safeParseContract(healthCommonsCatalogEntitySchema, validCatalogEntity)).toEqual({
      success: true,
      data: validCatalogEntity,
    });
    expect(
      safeParseContract(healthCommonsCatalogSchema, {
        schemaVersion: HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
        catalogHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        entities: [validCatalogEntity],
        redirects: [],
        changes: [],
        artifactManifests: [
          {
            schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
            manifestKey: "source_artifact:pmid-29849692/research-artifacts",
            artifacts: [validArtifactPointer],
          },
        ],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
        catalogHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        entities: [validCatalogEntity],
        redirects: [],
        changes: [],
        artifactManifests: [
          {
            schemaVersion: HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION,
            manifestKey: "source_artifact:pmid-29849692/research-artifacts",
            artifacts: [validArtifactPointer],
          },
        ],
      },
    });
    expect(
      safeParseContract(healthCommonsRedirectsFileSchema, {
        schemaVersion: "murph.commons.redirects.v1",
        redirects: [
          {
            from: "experiment_family:sauna/finnish-dry",
            to: "experiment_family:dry-sauna",
          },
        ],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: "murph.commons.redirects.v1",
        redirects: [
          {
            from: "experiment_family:sauna/finnish-dry",
            to: "experiment_family:dry-sauna",
          },
        ],
      },
    });
    expect(
      safeParseContract(healthCommonsChangeRecordSchema, {
        schemaVersion: HEALTH_COMMONS_CHANGE_SCHEMA_VERSION,
        changeId: "pmid-29849692-artifact-update",
        entityKey: "source_artifact:pmid-29849692",
        changeType: "artifact_change",
        minor: false,
        editSummary: "Add the source artifact manifest entry.",
        sourceKeys: ["source_artifact:pmid-29849692"],
      }),
    ).toEqual({
      success: true,
      data: {
        schemaVersion: HEALTH_COMMONS_CHANGE_SCHEMA_VERSION,
        changeId: "pmid-29849692-artifact-update",
        entityKey: "source_artifact:pmid-29849692",
        changeType: "artifact_change",
        minor: false,
        editSummary: "Add the source artifact manifest entry.",
        sourceKeys: ["source_artifact:pmid-29849692"],
      },
    });
    expect(isHealthCommonsEntityType("source_artifact")).toBe(true);
    expect(isHealthCommonsEntityType("not-an-entity")).toBe(false);
  });

  it("rejects the guarded source-artifact and artifact policy branches", () => {
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        ...validSourceArtifactPage,
        source: undefined,
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
        entityType: "protocol_variant",
        key: "protocol_variant:dry-sauna/example",
        slug: "protocols/dry-sauna/example",
        title: "Example protocol",
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsPageFrontmatterSchema, {
        schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
        entityType: "disambiguation",
        key: "disambiguation:example",
        slug: "disambiguation/example",
        title: "Example disambiguation",
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsArtifactPointerSchema, {
        ...validArtifactPointer,
        objectKey: undefined,
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsArtifactPointerSchema, {
        ...validArtifactPointer,
        redistributable: true,
        rightsStatus: "not_redistributable",
      }),
    ).toMatchObject({
      success: false,
    });
    expect(
      safeParseContract(healthCommonsClaimSchema, {
        claimId: "example-claim",
        type: "mechanistic",
        text: "Example claim text",
        strength: "low",
      }),
    ).toMatchObject({
      success: false,
    });
  });
});
