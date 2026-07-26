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
  hidden?: boolean;
  key: string;
  relations?: HealthCommonsRelation[];
  slug: string;
  status?: "draft" | "field-testing" | "reviewed" | "deprecated" | "community";
  title: string;
}): HealthCommonsCatalogEntity {
  return {
    schemaVersion: HEALTH_COMMONS_PAGE_SCHEMA_VERSION,
    entityType: "protocol_variant",
    key: input.key,
    slug: input.slug,
    title: input.title,
    hidden: input.hidden,
    status: input.status,
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
  it("publishes only explicitly public protocol statuses in run artifacts", () => {
    const artifacts = buildHealthCommonsProtocolGeneratedArtifacts({
      catalog: createCatalog([
        createProtocol({
          key: "protocol_variant:family/statusless",
          slug: "protocols/family/statusless",
          title: "Statusless Protocol",
        }),
        createProtocol({
          key: "protocol_variant:family/field-testing",
          slug: "protocols/family/field-testing",
          status: "field-testing",
          title: "Field Testing Protocol",
        }),
        createProtocol({
          key: "protocol_variant:family/reviewed",
          slug: "protocols/family/reviewed",
          status: "reviewed",
          title: "Reviewed Protocol",
        }),
        createProtocol({
          key: "protocol_variant:family/community",
          slug: "protocols/family/community",
          status: "community",
          title: "Community Protocol",
        }),
        createProtocol({
          key: "protocol_variant:family/draft",
          slug: "protocols/family/draft",
          status: "draft",
          title: "Draft Protocol",
        }),
        createProtocol({
          hidden: true,
          key: "protocol_variant:family/hidden",
          slug: "protocols/family/hidden",
          status: "reviewed",
          title: "Hidden Protocol",
        }),
        createProtocol({
          key: "protocol_variant:family/deprecated",
          slug: "protocols/family/deprecated",
          status: "deprecated",
          title: "Deprecated Protocol",
        }),
      ]),
      routeIndex: createRouteIndex(),
    });
    const expectedPublicKeys = [
      "protocol_variant:family/community",
      "protocol_variant:family/field-testing",
      "protocol_variant:family/reviewed",
    ];

    expect(artifacts.index.protocols.map((protocol) => protocol.key).sort()).toEqual(
      expectedPublicKeys,
    );
    expect(artifacts.runSpecs.protocols.map((protocol) => protocol.key).sort()).toEqual(
      expectedPublicKeys,
    );
  });

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
          status: "field-testing",
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
