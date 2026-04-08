import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createEmptyMemoryDocument,
  renderMemoryDocument,
  upsertMemoryRecord,
} from "@murphai/contracts";

import {
  DERIVED_KNOWLEDGE_INDEX_PATH,
  DERIVED_KNOWLEDGE_PAGES_ROOT,
  type DerivedKnowledgeGraph,
  type DerivedKnowledgeNode,
  readDerivedKnowledgeGraph,
  readDerivedKnowledgeGraphWithIssues,
  readMemoryDocument,
  buildMemoryReadPromptBlock,
  getMemoryRecord,
  listAutomations,
  orderedUniqueStrings,
  normalizeKnowledgeSlug,
  normalizeKnowledgeTag,
  humanizeKnowledgeTag,
  extractKnowledgeFirstHeading,
  extractKnowledgeRelatedSlugs,
  renderKnowledgePageBody,
  renderDerivedKnowledgeIndex,
  sameKnowledgeStringSet,
  searchDerivedKnowledgeGraph,
  searchDerivedKnowledgeVault,
  stripGeneratedKnowledgeSections,
  stripKnowledgeLeadingHeading,
  summarizeKnowledgeBody,
  showAutomation,
  readAutomation,
} from "../src/index.ts";

const createdVaultRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdVaultRoots.splice(0).map(async (vaultRoot) => {
      await rm(vaultRoot, {
        force: true,
        recursive: true,
      });
    }),
  );
});

describe("automation helpers", () => {
  it("loads, filters, and looks up canonical automation documents", async () => {
    const vaultRoot = await createVaultRoot();
    await writeAutomationDocument(
      vaultRoot,
      "daily-summary",
      [
        "---",
        "schemaVersion: vault-automation.v1",
        "docType: automation",
        "automationId: auto_daily_summary",
        "slug: daily-summary",
        "title: Daily summary",
        "status: paused",
        "summary: Daily summary prompt.",
        "schedule:",
        "  kind: dailyLocal",
        "  localTime: 08:30",
        "  timeZone: UTC",
        "route:",
        "  channel: email",
        "  deliverResponse: true",
        "  deliveryTarget: 123",
        "  identityId: null",
        "  participantId: null",
        "  sourceThreadId: null",
        "continuityPolicy: fresh",
        "tags:",
        "  - nightly",
        "  - nightly",
        "  - roundup",
        "createdAt: 2026-04-01T00:00:00.000Z",
        "updatedAt: 2026-04-08T00:00:00.000Z",
        "---",
        "",
        "Check in on sleep quality with a trailing space.   ",
        "",
      ].join("\n"),
    );
    await writeAutomationDocument(
      vaultRoot,
      "alpha-summary",
      [
        "---",
        "schemaVersion: vault-automation.v1",
        "docType: automation",
        "automationId: auto_alpha_summary",
        "slug: alpha-summary",
        "title: Alpha summary",
        "status: nonsense",
        "schedule:",
        "  kind: every",
        "  everyMs: 60000",
        "route:",
        "  channel: slack",
        "  deliverResponse: false",
        "  deliveryTarget: 456",
        "  identityId: 456",
        "  participantId: null",
        "  sourceThreadId: 789",
        "createdAt: 2026-04-02T00:00:00.000Z",
        "updatedAt: 2026-04-08T01:00:00.000Z",
        "---",
        "",
        "Summarize the day with the keyword alpha.",
        "",
      ].join("\n"),
    );
    await writeAutomationDocument(
      vaultRoot,
      "weekly-brief",
      [
        "---",
        "schemaVersion: vault-automation.v1",
        "docType: automation",
        "automationId: auto_weekly_brief",
        "slug: weekly-brief",
        "title: Weekly brief",
        "status: archived",
        "summary: Weekly brief prompt.",
        "schedule:",
        "  kind: cron",
        "  expression: 0 8 * * 1",
        "  timeZone: UTC",
        "route:",
        "  channel: email",
        "  deliverResponse: true",
        "  deliveryTarget: null",
        "  identityId: null",
        "  participantId: null",
        "  sourceThreadId: null",
        "continuityPolicy: nonsense",
        "createdAt: 2026-04-03T00:00:00.000Z",
        "updatedAt: 2026-04-08T02:00:00.000Z",
        "---",
        "",
        "Weekly brief body.",
        "",
      ].join("\n"),
    );

    const records = await listAutomations(vaultRoot);
    expect(records.map((record) => record.slug)).toEqual([
      "alpha-summary",
      "daily-summary",
      "weekly-brief",
    ]);
    expect(records[0]).toMatchObject({
      automationId: "auto_alpha_summary",
      continuityPolicy: "preserve",
      route: {
        channel: "slack",
        deliverResponse: false,
        deliveryTarget: "456",
        identityId: "456",
        participantId: null,
        sourceThreadId: "789",
      },
      status: "active",
    });
    expect(records[1]).toMatchObject({
      continuityPolicy: "fresh",
      route: {
        channel: "email",
        deliverResponse: true,
        deliveryTarget: "123",
      },
      status: "paused",
    });

    const filtered = await listAutomations(vaultRoot, {
      limit: 1,
      status: ["paused", "archived"],
      text: "sleep quality",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.slug).toBe("daily-summary");

    expect(await readAutomation(vaultRoot, "auto_missing")).toBeNull();
    expect(await showAutomation(vaultRoot, "  ALPHA SUMMARY  ")).toMatchObject({
      automationId: "auto_alpha_summary",
      slug: "alpha-summary",
    });
    expect(await showAutomation(vaultRoot, "daily-summary")).toMatchObject({
      automationId: "auto_daily_summary",
      slug: "daily-summary",
    });
  });

  it("rejects malformed automation schedules instead of silently coercing them", async () => {
    const vaultRoot = await createVaultRoot();
    await writeAutomationDocument(
      vaultRoot,
      "broken-daily",
      [
        "---",
        "schemaVersion: vault-automation.v1",
        "docType: automation",
        "automationId: auto_broken_daily",
        "slug: broken-daily",
        "title: Broken daily",
        "status: active",
        "schedule:",
        "  kind: dailyLocal",
        "  localTime: 8:30",
        "  timeZone: UTC",
        "route:",
        "  channel: email",
        "  deliverResponse: true",
        "  deliveryTarget: null",
        "  identityId: null",
        "  participantId: null",
        "  sourceThreadId: null",
        "continuityPolicy: preserve",
        "createdAt: 2026-04-08T00:00:00.000Z",
        "updatedAt: 2026-04-08T00:00:00.000Z",
        "---",
        "",
        "Broken schedule body.",
        "",
      ].join("\n"),
    );

    await expect(listAutomations(vaultRoot)).rejects.toThrow(
      /schedule\.localTime must use HH:MM format\./u,
    );
  });

  it("rejects missing and unsupported automation schedule shapes", async () => {
    const nullScheduleVault = await createVaultRoot();
    await writeAutomationDocument(
      nullScheduleVault,
      "broken-null-schedule",
      [
        "---",
        "schemaVersion: vault-automation.v1",
        "docType: automation",
        "automationId: auto_broken_null_schedule",
        "slug: broken-null-schedule",
        "title: Broken null schedule",
        "status: active",
        "schedule: null",
        "route:",
        "  channel: email",
        "  deliverResponse: true",
        "  deliveryTarget: null",
        "  identityId: null",
        "  participantId: null",
        "  sourceThreadId: null",
        "continuityPolicy: preserve",
        "createdAt: 2026-04-08T00:00:00.000Z",
        "updatedAt: 2026-04-08T00:00:00.000Z",
        "---",
        "",
        "Null schedule body.",
        "",
      ].join("\n"),
    );

    await expect(listAutomations(nullScheduleVault)).rejects.toThrow(
      /schedule must be an object\./u,
    );

    const invalidKindVault = await createVaultRoot();
    await writeAutomationDocument(
      invalidKindVault,
      "broken-kind",
      [
        "---",
        "schemaVersion: vault-automation.v1",
        "docType: automation",
        "automationId: auto_broken_kind",
        "slug: broken-kind",
        "title: Broken kind",
        "status: active",
        "schedule:",
        "  kind: weekly",
        "route:",
        "  channel: email",
        "  deliverResponse: true",
        "  deliveryTarget: null",
        "  identityId: null",
        "  participantId: null",
        "  sourceThreadId: null",
        "continuityPolicy: preserve",
        "createdAt: 2026-04-08T00:00:00.000Z",
        "updatedAt: 2026-04-08T00:00:00.000Z",
        "---",
        "",
        "Unsupported kind body.",
        "",
      ].join("\n"),
    );

    await expect(listAutomations(invalidKindVault)).rejects.toThrow(
      /schedule\.kind must match a supported automation schedule\./u,
    );

    const wrongShapeVault = await createVaultRoot();
    await writeAutomationDocument(
      wrongShapeVault,
      "broken-shape",
      [
        "---",
        "schemaVersion: vault-automation.v0",
        "docType: note",
        "automationId: auto_broken_shape",
        "slug: broken-shape",
        "title: Broken shape",
        "status: active",
        "schedule:",
        "  kind: every",
        "  everyMs: 60000",
        "route:",
        "  channel: email",
        "  deliverResponse: true",
        "  deliveryTarget: null",
        "  identityId: null",
        "  participantId: null",
        "  sourceThreadId: null",
        "continuityPolicy: preserve",
        "createdAt: 2026-04-08T00:00:00.000Z",
        "updatedAt: 2026-04-08T00:00:00.000Z",
        "---",
        "",
        "Broken shape body.",
        "",
      ].join("\n"),
    );

    await expect(listAutomations(wrongShapeVault)).rejects.toThrow(
      /Automation registry document has an unexpected shape\./u,
    );

    const emptyPromptVault = await createVaultRoot();
    await writeAutomationDocument(
      emptyPromptVault,
      "broken-prompt",
      [
        "---",
        "schemaVersion: vault-automation.v1",
        "docType: automation",
        "automationId: auto_broken_prompt",
        "slug: broken-prompt",
        "title: Broken prompt",
        "status: active",
        "schedule:",
        "  kind: every",
        "  everyMs: 60000",
        "route:",
        "  channel: email",
        "  deliverResponse: true",
        "  deliveryTarget: null",
        "  identityId: null",
        "  participantId: null",
        "  sourceThreadId: null",
        "continuityPolicy: preserve",
        "createdAt: 2026-04-08T00:00:00.000Z",
        "updatedAt: 2026-04-08T00:00:00.000Z",
        "---",
        "",
        "   ",
        "",
      ].join("\n"),
    );

    await expect(listAutomations(emptyPromptVault)).rejects.toThrow(
      /prompt body must contain text\./u,
    );
  });
});

describe("memory helpers", () => {
  it("reads missing and canonical memory documents through the query facade", async () => {
    const vaultRoot = await createVaultRoot();
    const emptySnapshot = await readMemoryDocument(vaultRoot);

    expect(emptySnapshot).toMatchObject({
      exists: false,
      records: [],
      sourcePath: "bank/memory.md",
      updatedAt: null,
    });
    expect(await buildMemoryReadPromptBlock(vaultRoot)).toBeNull();

    const document = upsertMemoryRecord(
      upsertMemoryRecord(createEmptyMemoryDocument(new Date("2026-04-08T00:00:00.000Z")), {
        now: new Date("2026-04-08T00:00:00.000Z"),
        section: "Identity",
        text: "Likes direct answers",
      }).document,
      {
        now: new Date("2026-04-08T00:05:00.000Z"),
        section: "Instructions",
        text: "Always mention the next step",
      },
    ).document;
    await writeFile(
      path.join(vaultRoot, "bank/memory.md"),
      renderMemoryDocument({ document }),
      "utf8",
    );

    const snapshot = await readMemoryDocument(vaultRoot);
    expect(snapshot).toMatchObject({
      exists: true,
      sourcePath: "bank/memory.md",
      updatedAt: "2026-04-08T00:05:00.000Z",
    });
    expect(snapshot.records.map((record) => record.section)).toEqual([
      "Identity",
      "Instructions",
    ]);
    expect(await getMemoryRecord(vaultRoot, snapshot.records[0]?.id ?? "")).toMatchObject({
      section: "Identity",
      text: "Likes direct answers",
    });
    expect(await getMemoryRecord(vaultRoot, "mem_missing")).toBeNull();
    expect(await buildMemoryReadPromptBlock(vaultRoot)).toBe([
      "Memory lives in the canonical vault and is safe to rely on for durable user context.",
      "Memory:\nIdentity:\n- Likes direct answers\n\nInstructions:\n- Always mention the next step",
    ].join("\n\n"));
  });
});

describe("knowledge formatting and model helpers", () => {
  it("normalize, summarize, and render knowledge text deterministically", () => {
    expect(orderedUniqueStrings(["alpha", "beta", "alpha", "gamma"])).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect(normalizeKnowledgeSlug("  Sleep quality  ")).toBe("sleep-quality");
    expect(normalizeKnowledgeSlug("!!!")).toBe("knowledge-page");
    expect(normalizeKnowledgeTag(" Sleep Pattern ")).toBe("sleep-pattern");
    expect(normalizeKnowledgeTag("   ")).toBeNull();
    expect(humanizeKnowledgeTag("sleep-pattern")).toBe("Sleep Pattern");
    expect(extractKnowledgeFirstHeading("Intro\n# First heading\n## Later")).toBe(
      "First heading",
    );
    expect(extractKnowledgeFirstHeading("Intro\nNo heading here")).toBeNull();
    expect(
      extractKnowledgeRelatedSlugs(
        "See [[alpha]] and [[sleep-quality]] and [[alpha]] again.",
        "sleep-quality",
      ),
    ).toEqual(["alpha"]);
    expect(extractKnowledgeRelatedSlugs("No wiki links here.", "alpha")).toEqual([]);
    expect(sameKnowledgeStringSet(["alpha", "beta"], ["beta", "alpha"])).toBe(true);
    expect(sameKnowledgeStringSet(["alpha", "beta"], ["alpha", "gamma"])).toBe(false);

    const rendered = renderKnowledgePageBody({
      title: " Sleep quality ",
      body: "  Narrative line one.\n\nNarrative line two.  ",
      relatedSlugs: ["beta", "alpha", "beta", ""],
      sourcePaths: [" research/a.md ", "research/b.md", "research/a.md"],
    });

    expect(rendered).toBe([
      "# Sleep quality",
      "",
      "Narrative line one.\n\nNarrative line two.",
      "",
      "## Related",
      "",
      "- [[beta]]",
      "- [[alpha]]",
      "",
      "## Sources",
      "",
      "- `research/a.md`",
      "- `research/b.md`",
    ].join("\n") + "\n");

    expect(
      renderKnowledgePageBody({
        title: " Blank ",
        body: "   ",
        relatedSlugs: [],
        sourcePaths: [],
      }),
    ).toBe("# Blank\n");
    expect(
      Reflect.apply(renderKnowledgePageBody, undefined, [{
        title: " Blank ",
        body: undefined,
        relatedSlugs: [undefined, "alpha"],
        sourcePaths: [undefined, "research/a.md"],
      }]),
    ).toBe([
      "# Blank",
      "",
      "## Related",
      "",
      "- [[alpha]]",
      "",
      "## Sources",
      "",
      "- `research/a.md`",
    ].join("\n") + "\n");

    const strippedSections = stripGeneratedKnowledgeSections([
      "# Sleep quality",
      "",
      "Narrative body.",
      "",
      "## Related",
      "",
      "- [[alpha]]",
      "",
      "## Sources",
      "",
      "- `research/a.md`",
      "",
      "## Other",
      "",
      "Keep this section.",
    ].join("\n"));
    expect(strippedSections).toContain("Narrative body.");
    expect(strippedSections).toContain("## Other");
    expect(strippedSections).not.toContain("## Related");
    expect(strippedSections).not.toContain("## Sources");
    expect(stripKnowledgeLeadingHeading("# Heading\n\nBody text.")).toBe("Body text.");
    expect(stripKnowledgeLeadingHeading("Body text only.")).toBe("Body text only.");
    expect(stripGeneratedKnowledgeSections("Plain body only.\n")).toBe("Plain body only.");
    // @ts-expect-error intentional runtime nullish coverage
    expect(stripGeneratedKnowledgeSections(undefined)).toBe("");
    // @ts-expect-error intentional runtime nullish coverage
    expect(stripKnowledgeLeadingHeading(undefined)).toBe("");

    expect(summarizeKnowledgeBody("## Heading\nShort summary line.")).toBe(
      "Heading Short summary line.",
    );
    expect(summarizeKnowledgeBody("   \n  ")).toBeNull();
    const longSummary = summarizeKnowledgeBody(
      `# Heading\n${"alpha ".repeat(40)}needle ${"omega ".repeat(40)}`,
    );
    expect(longSummary).toMatch(/^Heading /u);
    expect(longSummary).toHaveLength(220);
    expect(longSummary).toContain("...");
  });
});

describe("knowledge graph and search helpers", () => {
  it("reads derived knowledge pages, reports issues, renders the index, and searches the vault", async () => {
    const vaultRoot = await createVaultRoot();
    await writeKnowledgePage(
      vaultRoot,
      "alpha-page",
      [
        "---",
        "title: Alpha page",
        "slug: alpha-page",
        "pageType: concept",
        "status: active",
        "librarySlugs:",
        "  - alpha-lib",
        "relatedSlugs:",
        "  - beta-page",
        "  - missing-page",
        "sourcePaths:",
        "  - research/alpha.md",
        "---",
        "",
        "# Alpha page",
        "",
        "Alpha body text that names [[beta-page]] explicitly.",
        "",
      ].join("\n"),
    );
    await writeKnowledgePage(
      vaultRoot,
      "beta-page",
      [
        "---",
        "title: Beta page",
        "slug: beta-page",
        "status: archived",
        "---",
        "",
        "# Beta page",
        "",
        "Beta body text.",
        "",
      ].join("\n"),
    );
    await writeKnowledgePage(
      vaultRoot,
      "untyped-note",
      [
        "---",
        "title: Untyped note",
        "slug: untyped-note",
        "summary: Manual summary.",
        "---",
        "",
        "# Untyped note",
        "",
        "Loose body text for the uncategorized bucket.",
        "",
      ].join("\n"),
    );
    await writeKnowledgePage(
      vaultRoot,
      "fallback-note",
      [
        "---",
        "slug: fallback-note",
        "pageType: guide",
        "status: draft",
        "---",
        "",
        "# Fallback note",
        "",
        "Fallback note body text.",
        "",
      ].join("\n"),
    );
    await writeKnowledgePage(
      vaultRoot,
      "invalid-slug",
      [
        "---",
        "title: Invalid slug",
        "slug: Invalid Slug",
        "---",
        "",
        "# Invalid slug",
        "",
      ].join("\n"),
    );
    await writeFile(
      path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT, "broken-frontmatter.md"),
      [
        "---",
        "title: Broken frontmatter",
        "slug: broken-frontmatter",
        "",
        "# Broken frontmatter",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await readDerivedKnowledgeGraphWithIssues(vaultRoot);

    expect(result.graph.indexPath).toBe(DERIVED_KNOWLEDGE_INDEX_PATH);
    expect(result.graph.pagesRoot).toBe(DERIVED_KNOWLEDGE_PAGES_ROOT);
    expect(result.graph.nodes.map((node) => node.slug)).toEqual([
      "beta-page",
      "untyped-note",
      "alpha-page",
      "fallback-note",
    ]);
    expect(result.graph.bySlug.get("fallback-note")).toMatchObject({
      title: "Fallback note",
      summary: "Fallback note body text.",
      body: "Fallback note body text.",
      pageType: "guide",
    });
    expect(result.issues).toHaveLength(2);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          parser: "frontmatter",
          relativePath: `${DERIVED_KNOWLEDGE_PAGES_ROOT}/broken-frontmatter.md`,
        }),
        expect.objectContaining({
          parser: "frontmatter",
          relativePath: `${DERIVED_KNOWLEDGE_PAGES_ROOT}/invalid-slug.md`,
        }),
      ]),
    );

    const graph = await readDerivedKnowledgeGraph(vaultRoot);
    const index = renderDerivedKnowledgeIndex(graph, "2026-04-08T00:00:00.000Z");
    const emptyIndex = renderDerivedKnowledgeIndex(
      {
        bySlug: new Map(),
        indexPath: DERIVED_KNOWLEDGE_INDEX_PATH,
        nodes: [],
        pagesRoot: DERIVED_KNOWLEDGE_PAGES_ROOT,
      },
      "2026-04-08T00:00:00.000Z",
    );

    expect(index).toContain("# Derived knowledge index");
    expect(index).toContain("## Concept");
    expect(index).toContain("## Guide");
    expect(index).toContain("## Uncategorized");
    expect(index).toContain("[Alpha page](pages/alpha-page.md)");
    expect(index).toContain("related: [Beta page](pages/beta-page.md), `missing-page`");
    expect(index).toContain("sources: 1");
    expect(index).toContain("library: `alpha-lib`");
    expect(index).toContain("[Beta page](pages/beta-page.md)");
    expect(emptyIndex).toContain("No derived knowledge pages have been saved yet.");

    const searchedVault = await searchDerivedKnowledgeVault(vaultRoot, "beta page", {
      status: "archived",
    });
    expect(searchedVault.hits).toHaveLength(1);
    expect(searchedVault.hits[0]).toMatchObject({
      slug: "beta-page",
      status: "archived",
    });
  });

  it("ranks search hits deterministically and clamps the result limit", () => {
    const nodes: DerivedKnowledgeNode[] = [
      {
        attributes: {},
        body: "Alpha beta body text.",
        compiledAt: "2026-04-02T00:00:00.000Z",
        librarySlugs: [],
        pageType: "concept",
        relativePath: "derived/knowledge/pages/alpha-a.md",
        relatedSlugs: [],
        slug: "alpha-a",
        sourcePaths: [],
        status: "active",
        summary: "Alpha beta summary.",
        title: "Alpha beta",
      },
      {
        attributes: {},
        body: "Alpha beta body text.",
        compiledAt: "2026-04-02T00:00:00.000Z",
        librarySlugs: [],
        pageType: "concept",
        relativePath: "derived/knowledge/pages/alpha-z.md",
        relatedSlugs: [],
        slug: "alpha-z",
        sourcePaths: [],
        status: "active",
        summary: "Alpha beta summary.",
        title: "Alpha beta",
      },
      {
        attributes: {},
        body: `Prefix ${"x".repeat(120)} needle ${"y".repeat(120)}`,
        compiledAt: "2026-04-03T00:00:00.000Z",
        librarySlugs: [],
        pageType: "supplement",
        relativePath: "derived/knowledge/pages/needle-page.md",
        relatedSlugs: [],
        slug: "needle-page",
        sourcePaths: [],
        status: "archived",
        summary: null,
        title: "Needle page",
      },
    ];
    const graph: DerivedKnowledgeGraph = {
      bySlug: new Map(nodes.map((node) => [node.slug, node])),
      indexPath: DERIVED_KNOWLEDGE_INDEX_PATH,
      nodes,
      pagesRoot: DERIVED_KNOWLEDGE_PAGES_ROOT,
    };

    const ranked = searchDerivedKnowledgeGraph(graph, "alpha beta", {
      limit: NaN,
      pageType: "CONCEPT",
      status: "ACTIVE",
    });

    expect(ranked.format).toBe("murph.knowledge-search.v1");
    expect(ranked.total).toBe(2);
    expect(ranked.hits.map((hit) => hit.slug)).toEqual(["alpha-a", "alpha-z"]);
    expect(ranked.hits[0]).toMatchObject({
      matchedTerms: ["alpha", "beta"],
      pageType: "concept",
      status: "active",
    });

    const needleSearch = searchDerivedKnowledgeGraph(graph, "needle");
    expect(needleSearch.hits).toHaveLength(1);
    expect(needleSearch.hits[0]).toMatchObject({
      slug: "needle-page",
      status: "archived",
    });
    expect(needleSearch.hits[0]?.snippet).toContain("needle");
    expect(needleSearch.hits[0]?.snippet).toContain("...");

    expect(searchDerivedKnowledgeGraph(graph, "   ").hits).toHaveLength(0);
    expect(searchDerivedKnowledgeGraph(graph, "alpha", { limit: 0 }).hits).toHaveLength(1);
  });
});

async function createVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "murph-query-coverage-"));
  createdVaultRoots.push(vaultRoot);
  await mkdir(path.join(vaultRoot, "bank/automations"), {
    recursive: true,
  });
  await mkdir(path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT), {
    recursive: true,
  });
  return vaultRoot;
}

async function writeAutomationDocument(
  vaultRoot: string,
  slug: string,
  markdown: string,
): Promise<void> {
  await writeFile(
    path.join(vaultRoot, "bank/automations", `${slug}.md`),
    markdown,
    "utf8",
  );
}

async function writeKnowledgePage(
  vaultRoot: string,
  slug: string,
  markdown: string,
): Promise<void> {
  await writeFile(
    path.join(vaultRoot, DERIVED_KNOWLEDGE_PAGES_ROOT, `${slug}.md`),
    markdown,
    "utf8",
  );
}
