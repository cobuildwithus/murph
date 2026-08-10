import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("deleted generic Commons commands are no longer registered", async () => {
  const cli = createCommonsSliceCli();

  for (const command of [
    ["commons", "search", "sauna"],
    ["commons", "get", "finnish-sauna"],
    ["commons", "source", "list", "--protocol", "finnish-sauna"],
  ] as const) {
    const result = await runInProcessJsonCli(cli, [...command]);

    assert.equal(result.exitCode, 1, command.join(" "));
    assert.equal(result.envelope.ok, false, command.join(" "));
  }
});

test("commons knowledge search returns a bounded source-backed sauna packet", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    status: "ok" | "no_match" | "unavailable";
    items: Array<{
      entityKey: string;
      sources: Array<{ pmid: string | null; url: string | null }>;
    }>;
    safety: { kind: string } | null;
  }>(cli, [
    "commons",
    "knowledge",
    "search",
    "What does the evidence say about Finnish Dry Sauna?",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.status, "ok");
  assert.equal("catalogHash" in data, false);
  assert.equal("topicResolved" in data, false);
  assert.ok(data.items.length > 0 && data.items.length <= 3);
  assert.ok(data.items.some((item) =>
    item.sources.some((source) => source.pmid === "29849692")
  ));
});

test("commons knowledge search returns a safety-only sauna hard stop", async () => {
  const result = await runInProcessJsonCli<{
    status: "ok" | "no_match" | "unavailable";
    items: unknown[];
    safety: {
      sources: Array<{ pmid: string | null; title: string }>;
      text: string;
    } | null;
  }>(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "Is Finnish Dry Sauna safe with a fentanyl patch?",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.status, "ok");
  assert.deepEqual(data.items, []);
  assert.match(data.safety?.text ?? "", /opioid|fentanyl|life-threatening/iu);
  assert.ok(data.safety?.sources.some((source) =>
    source.pmid === "32740103" || /opioid patch|fentanyl patch/iu.test(source.title)
  ));
});


test("commons knowledge search reports no match without leaking internal resolver state", async () => {
  const result = await runInProcessJsonCli<{
    status: "ok" | "no_match" | "unavailable";
    items: unknown[];
    safety: unknown | null;
  }>(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "Does unsupported quux therapy improve health?",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.status, "no_match");
  assert.deepEqual(data.items, []);
  assert.equal(data.safety, null);
  assert.equal("catalogHash" in data, false);
  assert.equal("topicResolved" in data, false);
});

test("commons knowledge search exposes no result-size tuning", async () => {
  const result = await runInProcessJsonCli(createCommonsSliceCli(), [
    "commons",
    "knowledge",
    "search",
    "What does the evidence say about Finnish Dry Sauna?",
    "--limit",
    "4",
  ]);

  assert.equal(result.exitCode, 1);
  assert.equal(result.envelope.ok, false);
});


test("commons knowledge search stays non-blocking when its generated index is missing", async () => {
  const previousRoot = process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
  process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = path.join(
    tmpdir(),
    `missing-health-commons-${process.pid}`,
  );
  try {
    const result = await runInProcessJsonCli<{
      status: "ok" | "no_match" | "unavailable";
      items: unknown[];
      warning: string | null;
    }>(createCommonsSliceCli(), [
      "commons",
      "knowledge",
      "search",
      "Is Finnish Dry Sauna safe after recent fainting?",
    ]);

    assert.equal(result.envelope.ok, true);
    const data = requireData(result.envelope);
    assert.equal(data.status, "unavailable");
    assert.deepEqual(data.items, []);
    assert.match(data.warning ?? "", /continue without corpus context/u);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT;
    } else {
      process.env.MURPH_HEALTH_COMMONS_PACKAGE_ROOT = previousRoot;
    }
  }
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
  const bodyQueryResult = await runInProcessJsonCli<{
    protocols: Array<{
      key: string;
    }>;
  }>(cli, [
    "commons",
    "protocol",
    "list",
    "--query",
    "RPE",
    "--limit",
    "10",
  ]);
  assert.equal(bodyQueryResult.envelope.ok, true);
  assert.ok(
    requireData(bodyQueryResult.envelope).protocols.some(
      (protocol) => protocol.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    ),
  );

  const showResult = await runInProcessJsonCli<{
    lookup: string;
    protocol: {
      aliases?: unknown;
      attribution?: unknown;
      body?: unknown;
      entityType: string;
      experimentOnboarding: {
        adaptationPolicy?: unknown;
        assistantPolicy?: unknown;
        contextReview?: unknown;
        logging?: unknown;
        planDefaults?: unknown;
        safetyScreen?: unknown;
        setupSlots?: unknown;
        startIntent?: unknown;
        supportHints?: unknown;
        trackingHints?: unknown;
      } | null;
      key: string;
      lineage?: unknown;
      measurementPlan?: unknown;
      protocol: unknown | null;
      revision: {
        pageRevisionId: string;
        runSpecRevisionId: string | null;
      };
      safety: unknown | null;
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
  assert.ok(
    showData.protocol.experimentOnboarding &&
      typeof showData.protocol.experimentOnboarding === "object",
  );
  assert.equal("assistantPolicy" in showData.protocol.experimentOnboarding, false);
  assert.equal("contextReview" in showData.protocol.experimentOnboarding, false);
  assert.equal("logging" in showData.protocol.experimentOnboarding, false);
  assert.ok(showData.protocol.experimentOnboarding.startIntent);
  assert.ok(showData.protocol.experimentOnboarding.setupSlots);
  assert.ok(showData.protocol.experimentOnboarding.safetyScreen);
  assert.ok(showData.protocol.experimentOnboarding.supportHints);
  assert.ok(showData.protocol.experimentOnboarding.trackingHints);
  assert.ok(showData.protocol.protocol && typeof showData.protocol.protocol === "object");
  const shownProtocolSpec = showData.protocol.protocol as { sessionFieldIds?: unknown };
  assert.ok(Array.isArray(shownProtocolSpec.sessionFieldIds));
  assert.ok(shownProtocolSpec.sessionFieldIds.length > 0);
  assert.ok(showData.protocol.safety && typeof showData.protocol.safety === "object");
  assert.ok(showData.protocol.testPlans.length > 0);
  const saunaShowResult = await runInProcessJsonCli<{
    protocol: {
      experimentOnboarding: {
        adaptationPolicy?: unknown;
      } | null;
      key: string;
    };
  }>(cli, [
    "commons",
    "protocol",
    "show",
    "protocol_variant:sauna/finnish-dry/murph-standard-3x-week",
  ]);
  assert.equal(saunaShowResult.envelope.ok, true);
  const saunaShowData = requireData(saunaShowResult.envelope);
  assert.equal(
    saunaShowData.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.ok(saunaShowData.protocol.experimentOnboarding?.adaptationPolicy);
  for (const omittedField of [
    "aliases",
    "attribution",
    "body",
    "lineage",
    "measurementPlan",
  ] as const) {
    assert.equal(omittedField in showData.protocol, false);
  }
});

test("commons protocol explore expands sauna matches into family variants and a starter candidate", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
      parentFamilies: Array<{
        key: string;
      }>;
      relatedProtocolVariants: Array<{
        protocol: {
          key: string;
          revision: {
            pageRevisionId: string;
            runSpecRevisionId: string | null;
          };
        };
        traits: {
          externalProtocol: boolean;
          murphCanonical: boolean;
          sourceAttributed: boolean;
        };
      }>;
      starterCandidate: {
        protocol: {
          key: string;
        };
      } | null;
      traits: {
        externalProtocol: boolean;
        highCaution: boolean;
        murphCanonical: boolean;
        sourceAttributed: boolean;
      };
    }>;
    starterCandidate: {
      protocol: {
        key: string;
        revision: {
          pageRevisionId: string;
          runSpecRevisionId: string | null;
        };
      };
      traits: {
        murphCanonical: boolean;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "sauna",
    "--limit",
    "5",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.query, null);
  assert.equal(
    data.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.equal(data.starterCandidate?.traits.murphCanonical, true);
  assert.match(data.starterCandidate?.protocol.revision.pageRevisionId ?? "", /^sha256:/u);
  assert.match(data.starterCandidate?.protocol.revision.runSpecRevisionId ?? "", /^sha256:/u);

  const bryanGroup = data.groups.find(
    (group) => group.matchedProtocol.key === "protocol_variant:dry-sauna/bryan-johnson-blueprint",
  );
  assert.ok(bryanGroup);
  assert.equal(bryanGroup.traits.externalProtocol, true);
  assert.equal(bryanGroup.traits.sourceAttributed, true);
  assert.equal(bryanGroup.traits.highCaution, true);
  assert.ok(
    bryanGroup.parentFamilies.some(
      (family) => family.key === "experiment_family:dry-sauna",
    ),
  );
  assert.ok(
    bryanGroup.relatedProtocolVariants.some(
      (variant) =>
        variant.protocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week" &&
        variant.traits.murphCanonical,
    ),
  );
  assert.equal(
    bryanGroup.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
});

test("commons protocol explore accepts an experiment family and includes inverse parent-family variants", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      limit: number;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: {
      entityType: string;
      key: string;
    } | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "dry-sauna",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.limit, 5);
  assert.equal(data.matchedEntity?.entityType, "experiment_family");
  assert.equal(data.matchedEntity?.key, "experiment_family:dry-sauna");
  assert.equal(
    data.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.ok(data.groups.every((group) => group.matchReason === "direct_family"));
  assert.ok(
    data.groups.some(
      (group) => group.matchedProtocol.key === "protocol_variant:dry-sauna/bryan-johnson-blueprint",
    ),
  );
  assert.ok(
    data.groups.some(
      (group) =>
        group.matchedProtocol.key === "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
    ),
  );
});

test("commons protocol explore distinguishes direct protocol lookup from query fallback", async () => {
  const cli = createCommonsSliceCli();

  const directResult = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: {
      entityType: string;
      key: string;
    } | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  ]);

  assert.equal(directResult.envelope.ok, true);
  const directData = requireData(directResult.envelope);
  assert.equal(directData.filters.query, null);
  assert.equal(directData.matchedEntity?.entityType, "protocol_variant");
  assert.equal(
    directData.matchedEntity?.key,
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  );
  assert.deepEqual(
    directData.groups.map((group) => group.matchReason),
    ["direct_protocol"],
  );
  assert.equal(
    directData.starterCandidate?.protocol.key,
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  );

  const typedShorthandResult = await runInProcessJsonCli<{
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: {
      entityType: string;
      key: string;
    } | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "PROTOCOL_VARIANT:DRY-SAUNA",
  ]);

  assert.equal(typedShorthandResult.envelope.ok, true);
  const typedShorthandData = requireData(typedShorthandResult.envelope);
  assert.equal(typedShorthandData.matchedEntity?.entityType, "protocol_variant");
  assert.equal(
    typedShorthandData.matchedEntity?.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );
  assert.deepEqual(
    typedShorthandData.groups.map((group) => group.matchReason),
    ["direct_protocol"],
  );
  assert.equal(
    typedShorthandData.starterCandidate?.protocol.key,
    "protocol_variant:dry-sauna/murph-finnish-standard-3x-week",
  );

  const queryResult = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
    }>;
    matchedEntity: unknown | null;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "norwegian",
    "--limit",
    "3",
  ]);

  assert.equal(queryResult.envelope.ok, true);
  const queryData = requireData(queryResult.envelope);
  assert.equal(queryData.filters.query, "norwegian");
  assert.equal(queryData.matchedEntity, null);
  assert.ok(queryData.groups.length > 0);
  assert.ok(queryData.groups.every((group) => group.matchReason === "query_match"));
  assert.ok(
    queryData.groups.some(
      (group) => group.matchedProtocol.key === "protocol_variant:norwegian-4x4/norwegian-4x4",
    ),
  );
  assert.equal(
    queryData.starterCandidate?.protocol.key,
    "protocol_variant:norwegian-4x4/norwegian-4x4",
  );
});

test("commons protocol explore query fallback keeps the starter candidate on the top query match", async () => {
  const cli = createCommonsSliceCli();
  const result = await runInProcessJsonCli<{
    filters: {
      query: string | null;
    };
    groups: Array<{
      matchReason: string;
      matchedProtocol: {
        key: string;
      };
      starterCandidate: {
        protocol: {
          key: string;
        };
      } | null;
    }>;
    starterCandidate: {
      protocol: {
        key: string;
      };
    } | null;
  }>(cli, [
    "commons",
    "protocol",
    "explore",
    "physical therapy low back hip glute rehab",
    "--limit",
    "5",
  ]);

  assert.equal(result.envelope.ok, true);
  const data = requireData(result.envelope);
  assert.equal(data.filters.query, "physical therapy low back hip glute rehab");
  assert.equal(data.groups[0]?.matchReason, "query_match");
  assert.equal(typeof data.groups[0]?.matchedProtocol.key, "string");
  assert.equal(
    data.starterCandidate?.protocol.key,
    data.groups[0]?.starterCandidate?.protocol.key,
  );
  assert.notEqual(
    data.starterCandidate?.protocol.key,
    "protocol_variant:daily-step-floor/daily-step-floor",
  );
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

test("commons protocol filters reject invalid public corpus status values", async () => {
  const cli = createCommonsSliceCli();
  const invalidStatus = await runInProcessJsonCli(cli, [
    "commons",
    "protocol",
    "list",
    "--status",
    "active",
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
});
