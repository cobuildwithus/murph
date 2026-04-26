import assert from "node:assert/strict";
import { Cli } from "incur";
import { localParallelCliTest as test } from "./local-parallel-test.js";
import { incurErrorBridge } from "../src/incur-error-bridge.js";
import { registerCommonsCommands } from "../src/commands/commons.js";
import {
  requireData,
  runInProcessJsonCli,
} from "./cli-test-helpers.js";

function createCommonsSliceCli() {
  const cli = Cli.create("vault-cli", {
    description: "commons coverage cli",
    version: "0.0.0-test",
  });

  cli.use(incurErrorBridge);
  registerCommonsCommands(cli);

  return cli;
}

test("commons search reads the public catalog without requiring a vault", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    catalogHash: string;
    filters: {
      entityTypes: string[];
      text: string;
    };
    hits: Array<{
      entityType: string;
      key: string;
      matchedFields: string[];
      title: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "search",
    "sauna",
    "--type",
    "protocol_variant",
    "--limit",
    "5",
  ], {
    env: {
      PATH: process.env.PATH,
    },
  });

  assert.equal(result.exitCode, null);
  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.match(data.catalogHash, /^sha256:/u);
  assert.equal(data.filters.text, "sauna");
  assert.deepEqual(data.filters.entityTypes, ["protocol_variant"]);
  assert.ok(data.total > 0);
  assert.ok(data.hits.length > 0);
  assert.ok(data.hits.every((hit) => hit.entityType === "protocol_variant"));
  assert.ok(data.hits.some((hit) => /sauna/iu.test(`${hit.key} ${hit.title}`)));
  assert.ok(data.hits.every((hit) => hit.matchedFields.length > 0));
});

test("commons protocol list and show expose protocol revisions distinctly from private protocol commands", async () => {
  const cli = createCommonsSliceCli();

  const listResult = await runInProcessJsonCli<{
    protocols: Array<{
      entityType: string;
      key: string;
      revision: {
        runSpecRevisionId: string | null;
      };
    }>;
    total: number;
  }>(cli, [
    "commons",
    "protocol",
    "list",
    "--query",
    "norwegian",
    "--limit",
    "10",
  ]);

  assert.equal(listResult.envelope.ok, true);
  const listData = requireData(listResult.envelope);
  assert.ok(listData.total > 0);
  assert.ok(listData.protocols.every((protocol) => protocol.entityType === "protocol_variant"));
  assert.ok(
    listData.protocols.some(
      (protocol) => protocol.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    ),
  );

  const showResult = await runInProcessJsonCli<{
    lookup: string;
    protocol: {
      entityType: string;
      key: string;
      protocol: unknown;
      revision: {
        pageRevisionId: string;
        runSpecRevisionId: string | null;
      };
      testPlans: unknown[];
    };
  }>(cli, [
    "commons",
    "protocol",
    "show",
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  ]);

  assert.equal(showResult.envelope.ok, true);
  const showData = requireData(showResult.envelope);
  assert.equal(showData.lookup, "protocol_variant:norwegian-4x4/norwegian-4x4");
  assert.equal(showData.protocol.key, "protocol_variant:norwegian-4x4/norwegian-4x4");
  assert.equal(showData.protocol.entityType, "protocol_variant");
  assert.match(showData.protocol.revision.pageRevisionId, /^sha256:/u);
  assert.match(showData.protocol.revision.runSpecRevisionId ?? "", /^sha256:/u);
  assert.ok(showData.protocol.protocol && typeof showData.protocol.protocol === "object");
  assert.ok(showData.protocol.testPlans.length > 0);
});

test("commons get inspects generic entities and accepts measurement method disambiguation", async () => {
  const cli = createCommonsSliceCli();

  const getResult = await runInProcessJsonCli<{
    entity: {
      entityType: string;
      entityTypeLabel: string;
      key: string;
      measurementMethod: unknown | null;
      measurementPlan: unknown | null;
    };
    lookup: string;
  }>(cli, [
    "commons",
    "get",
    "finnish-sauna",
  ]);

  assert.equal(getResult.envelope.ok, true);
  const getData = requireData(getResult.envelope);
  assert.equal(getData.lookup, "finnish-sauna");
  assert.equal(getData.entity.key, "protocol_variant:dry-sauna/murph-finnish-standard-3x-week");
  assert.equal(getData.entity.entityType, "protocol_variant");
  assert.equal(getData.entity.entityTypeLabel, "protocol");
  assert.equal(getData.entity.measurementMethod, null);
  assert.ok("measurementPlan" in getData.entity);

  const absentMeasurementMethod = await runInProcessJsonCli(cli, [
    "commons",
    "get",
    "finnish-sauna",
    "--type",
    "measurement_method",
  ]);
  assert.equal(absentMeasurementMethod.exitCode, 1);
  assert.equal(absentMeasurementMethod.envelope.ok, false);
  if (!absentMeasurementMethod.envelope.ok) {
    assert.equal(absentMeasurementMethod.envelope.error.code, "commons_entity_not_found");
    assert.match(
      absentMeasurementMethod.envelope.error.message ?? "",
      /with type measurement_method/u,
    );
  }
});

test("commons search accepts measurement methods through the shared entity enum", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      entityTypes: string[];
    };
    hits: Array<{
      entityType: string;
      entityTypeLabel: string;
      key: string;
    }>;
  }>(cli, [
    "commons",
    "search",
    "standardized photo",
    "--type",
    "measurement_method",
    "--limit",
    "5",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.deepEqual(data.filters.entityTypes, ["measurement_method"]);
  assert.ok(
    data.hits.every(
      (hit) =>
        hit.entityType === "measurement_method" &&
        hit.entityTypeLabel === "measurement method",
    ),
  );

  const firstMeasurementMethod = data.hits[0];
  if (firstMeasurementMethod) {
    const getResult = await runInProcessJsonCli<{
      entity: {
        entityType: string;
        entityTypeLabel: string;
        measurementMethod: unknown | null;
        measurementPlan: unknown | null;
      };
    }>(cli, [
      "commons",
      "get",
      firstMeasurementMethod.key,
      "--type",
      "measurement_method",
    ]);

    assert.equal(getResult.envelope.ok, true);
    const getData = requireData(getResult.envelope);
    assert.equal(getData.entity.entityType, "measurement_method");
    assert.equal(getData.entity.entityTypeLabel, "measurement method");
    assert.ok(getData.entity.measurementMethod);
    assert.equal(getData.entity.measurementPlan, null);
  }
});

test("commons protocol list treats wildcard categories as unfiltered", async () => {
  const cli = createCommonsSliceCli();

  const result = await runInProcessJsonCli<{
    filters: {
      categories: string[];
      query: string | null;
      status: string | null;
    };
    protocols: Array<{
      entityType: string;
      key: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "protocol",
    "list",
    "--query",
    "sauna",
    "--category",
    "*",
    "--status",
    "*",
    "--limit",
    "20",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.query, "sauna");
  assert.deepEqual(data.filters.categories, []);
  assert.equal(data.filters.status, null);
  assert.ok(data.total > 0);
  assert.ok(data.protocols.every((protocol) => protocol.entityType === "protocol_variant"));
  assert.ok(
    data.protocols.some(
      (protocol) =>
        protocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    ),
  );
});

test("commons protocol list stays aligned with search results when wildcard categories are ignored", async () => {
  const cli = createCommonsSliceCli();

  const searchResult = await runInProcessJsonCli<{
    hits: Array<{
      entityType: string;
      key: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "search",
    "sauna",
    "--type",
    "protocol_variant",
    "--limit",
    "20",
  ]);

  const listResult = await runInProcessJsonCli<{
    filters: {
      categories: string[];
      query: string | null;
    };
    protocols: Array<{
      entityType: string;
      key: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "protocol",
    "list",
    "--query",
    "sauna",
    "--category",
    "*",
    "--limit",
    "20",
  ]);

  assert.equal(searchResult.envelope.ok, true);
  assert.equal(listResult.envelope.ok, true);
  const searchData = requireData(searchResult.envelope);
  const listData = requireData(listResult.envelope);
  assert.deepEqual(listData.filters.categories, []);
  assert.equal(listData.filters.query, "sauna");
  assert.deepEqual(
    listData.protocols.map((protocol) => protocol.key),
    searchData.hits.map((hit) => hit.key),
  );
});

test("commons source list returns public source artifacts", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      kind: string | null;
      protocol: string | null;
    };
    sources: Array<{
      entityType: string;
      key: string;
      source: {
        kind: string | null;
        title: string | null;
      };
    }>;
    total: number;
  }>(cli, [
    "commons",
    "source",
    "list",
    "--protocol",
    "red-light-glasses-before-bed",
    "--kind",
    "*",
    "--limit",
    "5",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.kind, null);
  assert.equal(data.filters.protocol, "red-light-glasses-before-bed");
  assert.ok(data.total > 0);
  assert.ok(data.sources.length > 0);
  assert.ok(data.sources.every((source) => source.entityType === "source_artifact"));
  assert.ok(data.sources.every((source) => source.source.title));
});

test("commons source list applies high limits after protocol source collection", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      limit: number;
      protocol: string | null;
    };
    sources: Array<{
      entityType: string;
      key: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "source",
    "list",
    "--protocol",
    "hyperbaric-oxygen-therapy",
    "--limit",
    "500",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.limit, 500);
  assert.equal(data.filters.protocol, "hyperbaric-oxygen-therapy");
  assert.ok(data.total > 100);
  assert.equal(data.total, data.sources.length);
  assert.ok(data.sources.every((source) => source.entityType === "source_artifact"));
});

test("commons source list keeps invalid protocol scopes empty", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      protocol: string | null;
    };
    sources: Array<{
      key: string;
    }>;
    total: number;
  }>(cli, [
    "commons",
    "source",
    "list",
    "--protocol",
    "not-a-health-commons-protocol",
    "--limit",
    "20",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.protocol, "not-a-health-commons-protocol");
  assert.equal(data.total, 0);
  assert.deepEqual(data.sources, []);
});

test("commons search rejects unknown entity type filters", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli(cli, [
    "commons",
    "search",
    "sauna",
    "--type",
    "protocol",
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.ok, false);
  if (!result.envelope.ok) {
    assert.equal(result.envelope.error.code, "invalid_entity_type");
  }
});

test("commons filters reject invalid public corpus status and source kind values", async () => {
  const cli = createCommonsSliceCli();
  const invalidStatus = await runInProcessJsonCli(cli, [
    "commons",
    "protocol",
    "list",
    "--status",
    "active",
  ]);
  const invalidKind = await runInProcessJsonCli(cli, [
    "commons",
    "source",
    "list",
    "--kind",
    "study",
  ]);

  assert.equal(invalidStatus.exitCode, 1);
  assert.equal(invalidStatus.envelope.ok, false);
  if (!invalidStatus.envelope.ok) {
    assert.match(
      invalidStatus.envelope.error.message ?? "",
      /Unknown Health Commons status filter\. Expected one of:/u,
    );
    assert.doesNotMatch(invalidStatus.envelope.error.message ?? "", /active/u);
  }
  assert.equal(invalidKind.exitCode, 1);
  assert.equal(invalidKind.envelope.ok, false);
  if (!invalidKind.envelope.ok) {
    assert.match(
      invalidKind.envelope.error.message ?? "",
      /Unknown Health Commons source kind filter\. Expected one of:/u,
    );
    assert.doesNotMatch(invalidKind.envelope.error.message ?? "", /study/u);
  }
});
