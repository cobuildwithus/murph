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

test("commons source list returns public source artifacts", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
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
    "--limit",
    "5",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
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
  assert.equal(invalidKind.exitCode, 1);
  assert.equal(invalidKind.envelope.ok, false);
});
