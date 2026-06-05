import { describe, expect, it } from "vitest";

import {
  HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
  HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
  type HealthCommonsCatalog,
  type HealthCommonsCatalogEntity,
  type HealthCommonsRelation,
} from "@murphai/contracts";

import { buildHealthCommonsProtocolGeneratedArtifacts } from "../src/protocol-artifacts.ts";
import {
  HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
  type HealthCommonsWebRouteIndex,
} from "../src/web-artifacts.ts";

const TEST_CATALOG_HASH =
  "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const TEST_PAGE_REVISION_ID =
  "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const TEST_RUN_SPEC_REVISION_ID =
  "sha256:3333333333333333333333333333333333333333333333333333333333333333";

function createFamily(input: {
  key: string;
  relations?: HealthCommonsRelation[];
  slug: string;
  title: string;
}): HealthCommonsCatalogEntity {
  return {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "experiment_family",
    key: input.key,
    slug: input.slug,
    title: input.title,
    relations: input.relations,
    body: `${input.title} body.`,
    relativePath: `${input.slug}.md`,
    revision: {
      pageRevisionId: TEST_PAGE_REVISION_ID,
    },
  };
}

function createProtocol(input: {
  key: string;
  relations?: HealthCommonsRelation[];
  slug: string;
  title: string;
}): HealthCommonsCatalogEntity {
  return {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "protocol_variant",
    key: input.key,
    slug: input.slug,
    title: input.title,
    relations: input.relations,
    body: `${input.title} body.`,
    relativePath: `${input.slug}.md`,
    revision: {
      pageRevisionId: TEST_PAGE_REVISION_ID,
      runSpecRevisionId: TEST_RUN_SPEC_REVISION_ID,
    },
  };
}

function createCatalog(entities: HealthCommonsCatalogEntity[]): HealthCommonsCatalog {
  return {
    schemaVersion: HEALTH_COMMONS_CATALOG_SCHEMA_VERSION,
    catalogHash: TEST_CATALOG_HASH,
    entities,
    redirects: [],
    changes: [],
    artifactManifests: [],
    evidenceAppraisals: [],
  };
}

function createRouteIndex(): HealthCommonsWebRouteIndex {
  return {
    schemaVersion: HEALTH_COMMONS_WEB_ROUTE_INDEX_SCHEMA_VERSION,
    catalogHash: TEST_CATALOG_HASH,
    routes: [],
  };
}

describe("buildHealthCommonsProtocolGeneratedArtifacts", () => {
  it("keeps parent-owned child family edges and protocol parent family edges", () => {
    const artifacts = buildHealthCommonsProtocolGeneratedArtifacts({
      catalog: createCatalog([
        createFamily({
          key: "experiment_family:sauna",
          slug: "families/sauna",
          title: "Sauna",
          relations: [
            {
              type: "child_family",
              target: "experiment_family:dry-sauna",
            },
          ],
        }),
        createFamily({
          key: "experiment_family:dry-sauna",
          slug: "families/dry-sauna",
          title: "Dry Sauna",
          relations: [
            {
              type: "related_protocol",
              target: "protocol_variant:dry-sauna/finnish",
            },
          ],
        }),
        createProtocol({
          key: "protocol_variant:dry-sauna/finnish",
          slug: "protocols/dry-sauna/finnish",
          title: "Finnish Sauna",
          relations: [
            {
              type: "parent_family",
              target: "experiment_family:dry-sauna",
            },
          ],
        }),
      ]),
      routeIndex: createRouteIndex(),
    });

    expect(artifacts.familyGraph.edges).toEqual([
      {
        sourceKey: "experiment_family:dry-sauna",
        targetKey: "protocol_variant:dry-sauna/finnish",
        type: "related_protocol",
      },
      {
        sourceKey: "experiment_family:sauna",
        targetKey: "experiment_family:dry-sauna",
        type: "child_family",
      },
      {
        sourceKey: "protocol_variant:dry-sauna/finnish",
        targetKey: "experiment_family:dry-sauna",
        type: "parent_family",
      },
    ]);
  });

  it("rejects child-family pages that point back to parents with parent_family", () => {
    expect(() =>
      buildHealthCommonsProtocolGeneratedArtifacts({
        catalog: createCatalog([
          createFamily({
            key: "experiment_family:sauna",
            slug: "families/sauna",
            title: "Sauna",
          }),
          createFamily({
            key: "experiment_family:dry-sauna",
            slug: "families/dry-sauna",
            title: "Dry Sauna",
            relations: [
              {
                type: "parent_family",
                target: "experiment_family:sauna",
              },
            ],
          }),
        ]),
        routeIndex: createRouteIndex(),
      })
    ).toThrow(
      "Invalid Health Commons protocol family graph relation experiment_family:dry-sauna parent_family experiment_family:sauna.",
    );
  });
});
