import assert from "node:assert/strict";
import { Cli } from "incur";
import { test, vi } from "vitest";

const runtimeMocks = vi.hoisted(() => ({
  searchGeneratedHealthCommonsKnowledge: vi.fn(),
}));
vi.mock("@murphai/health-commons/runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("@murphai/health-commons/runtime")>(),
  ...runtimeMocks,
}));

import { registerCommonsCommands } from "../src/commands/commons.js";
import { requireData, runInProcessJsonCli } from "./cli-test-helpers.js";

function source(overrides: Record<string, unknown>) {
  return {
    authors: "Synthetic Author, Second Author",
    designKind: "randomized_controlled_trial",
    doi: null,
    participantCount: 120,
    pmid: null,
    sourceKey: "source_artifact:synthetic",
    title: "Synthetic source",
    url: null,
    year: 2024,
    ...overrides,
  };
}

test("commons knowledge search keeps a locator and a non-topic entity while dropping source metadata", async () => {
  runtimeMocks.searchGeneratedHealthCommonsKnowledge.mockReturnValueOnce({
    candidates: [],
    items: [
      {
        caveat: null,
        entityKey: "biomarker:synthetic",
        entityTitle: "Synthetic Topic",
        kind: "claim",
        strength: "moderate",
        text: "A claim owned by the resolved topic.",
        sources: [
          source({ pmid: "12345", url: "https://example.org/article" }),
          source({ pmid: "67890" }),
          source({ doi: "10.1000/synthetic" }),
          source({}),
        ],
      },
      {
        caveat: "Member entity caveat.",
        entityKey: "biomarker:synthetic-member",
        entityTitle: "Synthetic Member",
        kind: "source_finding",
        strength: null,
        text: "A finding owned by another topic member.",
        sources: [source({ url: "https://example.org/member" })],
      },
    ],
    query: "synthetic question",
    safety: {
      caveat: "Safety caveat.",
      entityKey: "biomarker:synthetic",
      entityTitle: "Synthetic Topic",
      kind: "safety",
      strength: "high",
      text: "A safety claim owned by the resolved topic.",
      sources: [source({ url: "https://example.org/safety" })],
    },
    topic: { key: "biomarker:synthetic", title: "Synthetic Topic" },
  });
  const cli = Cli.create("vault-cli", { description: "commons projection cli", version: "0.0.0-test" });
  registerCommonsCommands(cli);

  const result = await runInProcessJsonCli(cli, ["commons", "knowledge", "search", "synthetic question"]);

  assert.deepEqual(requireData(result.envelope), {
    topic: { key: "biomarker:synthetic", title: "Synthetic Topic" },
    candidates: [],
    items: [
      {
        kind: "claim",
        text: "A claim owned by the resolved topic.",
        caveat: null,
        strength: "moderate",
        sources: [
          { title: "Synthetic source", year: 2024, designKind: "randomized_controlled_trial", url: "https://example.org/article" },
          { title: "Synthetic source", year: 2024, designKind: "randomized_controlled_trial", url: "https://pubmed.ncbi.nlm.nih.gov/67890/" },
          { title: "Synthetic source", year: 2024, designKind: "randomized_controlled_trial", url: "https://doi.org/10.1000/synthetic" },
          { title: "Synthetic source", year: 2024, designKind: "randomized_controlled_trial", url: null },
        ],
      },
      {
        kind: "source_finding",
        text: "A finding owned by another topic member.",
        caveat: "Member entity caveat.",
        strength: null,
        entityKey: "biomarker:synthetic-member",
        entityTitle: "Synthetic Member",
        sources: [
          { title: "Synthetic source", year: 2024, designKind: "randomized_controlled_trial", url: "https://example.org/member" },
        ],
      },
    ],
    safety: {
      kind: "safety",
      text: "A safety claim owned by the resolved topic.",
      caveat: "Safety caveat.",
      strength: "high",
      sources: [
        { title: "Synthetic source", year: 2024, designKind: "randomized_controlled_trial", url: "https://example.org/safety" },
      ],
    },
  });
});
