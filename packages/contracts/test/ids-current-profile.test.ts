import { describe, expect, it } from "vitest";

import {
  CONTRACT_ID_FORMAT,
  CONTRACT_SCHEMA_VERSION,
  FRONTMATTER_DOC_TYPES,
  ID_PREFIXES,
} from "../src/constants.ts";
import { buildCurrentProfileDocument } from "../src/current-profile.ts";
import { parseFrontmatterDocument } from "../src/frontmatter.ts";
import {
  GENERIC_CONTRACT_ID_REGEX,
  ULID_BODY_PATTERN,
  assertContractId,
  contractIdMaxLength,
  idPattern,
  isContractId,
} from "../src/ids.ts";

const VALID_ULID = "0123456789ABCDEFGHJKMNPQRS";
const INVALID_ULID = "0123456789ABCDEFGHJKMNPQRI";

const snapshotId = `${ID_PREFIXES.profileSnapshot}_${VALID_ULID}`;
const goalId = `${ID_PREFIXES.goal}_${VALID_ULID}`;
const assessmentId = `${ID_PREFIXES.assessment}_${VALID_ULID}`;
const eventId = `${ID_PREFIXES.event}_${VALID_ULID}`;
const updatedAt = "2026-04-08T10:11:12.000Z";

describe("@murphai/contracts ids helpers", () => {
  it("builds prefix-aware patterns and length limits from the declared contract prefixes", () => {
    expect(idPattern(ID_PREFIXES.goal)).toBe(`^${ID_PREFIXES.goal}_${ULID_BODY_PATTERN}$`);
    expect(contractIdMaxLength(ID_PREFIXES.profileSnapshot)).toBe(snapshotId.length);

    for (const prefix of Object.values(ID_PREFIXES)) {
      const contractId = `${prefix}_${VALID_ULID}`;
      expect(GENERIC_CONTRACT_ID_REGEX.test(contractId)).toBe(true);
      expect(isContractId(contractId)).toBe(true);
      expect(isContractId(contractId, prefix)).toBe(true);
      expect(contractIdMaxLength(prefix)).toBe(contractId.length);
    }

    expect(isContractId(`${ID_PREFIXES.goal}_${INVALID_ULID}`)).toBe(false);
    expect(isContractId(`${ID_PREFIXES.goal}_${VALID_ULID.toLowerCase()}`)).toBe(false);
    expect(isContractId(`unknown_${VALID_ULID}`)).toBe(false);
    expect(isContractId(123)).toBe(false);
  });

  it("returns valid ids and throws field-specific contract-id errors", () => {
    expect(assertContractId(goalId, ID_PREFIXES.goal, "goalId")).toBe(goalId);
    expect(assertContractId(snapshotId, ID_PREFIXES.profileSnapshot)).toBe(snapshotId);

    expect(() => assertContractId("bad-id", ID_PREFIXES.goal, "goalId")).toThrowError(
      "goalId must match goal_<ULID>",
    );
    expect(() => assertContractId("bad-id", undefined, "recordId")).toThrowError(
      `recordId must match ${CONTRACT_ID_FORMAT}`,
    );
  });
});

describe("buildCurrentProfileDocument", () => {
  it("derives frontmatter attributes and renders a deterministic markdown body", () => {
    const profile = {
      emptyArray: [],
      emptyObject: {},
      goals: {
        title: "Sleep better",
        topGoalIds: [goalId, 7],
      },
      habits: [
        "morning-walk",
        {
          name: "strength",
          daysPerWeek: 5,
        },
        [],
      ],
      summary: {
        nickname: "Murph",
        age: 37,
      },
      unitPreferences: {
        distance: "km",
        weight: "kg",
      },
    } satisfies Record<string, unknown>;

    const result = buildCurrentProfileDocument({
      snapshotId,
      updatedAt,
      source: "derived",
      sourceAssessmentIds: [assessmentId],
      sourceEventIds: [eventId],
      profile,
    });

    expect(result.attributes).toEqual({
      schemaVersion: CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter,
      docType: FRONTMATTER_DOC_TYPES.profileCurrent,
      snapshotId,
      updatedAt,
      sourceAssessmentIds: [assessmentId],
      sourceEventIds: [eventId],
      topGoalIds: [goalId],
      unitPreferences: {
        weight: "kg",
        distance: "km",
      },
    });

    expect(result.body).toBe(
      [
        "# Current Profile",
        "",
        `Snapshot ID: \`${snapshotId}\``,
        `Recorded At: ${updatedAt}`,
        "Source: derived",
        "",
        "## Structured Profile",
        "",
        "- emptyArray:",
        "  []",
        "- emptyObject:",
        "  {}",
        "- goals:",
        "  - title: Sleep better",
        "  - topGoalIds:",
        `    - ${goalId}`,
        "    - 7",
        "- habits:",
        "  - morning-walk",
        "  -",
        "    - daysPerWeek: 5",
        "    - name: strength",
        "  -",
        "    []",
        "- summary:",
        "  - age: 37",
        "  - nickname: Murph",
        "- unitPreferences:",
        "  - distance: km",
        "  - weight: kg",
        "",
        "## JSON",
        "",
        "```json",
        JSON.stringify(profile, null, 2),
        "```",
        "",
      ].join("\n"),
    );

    const parsed = parseFrontmatterDocument(result.markdown);
    expect(parsed.attributes).toEqual(result.attributes);
    expect(parsed.body).toBe(result.body);
    expect(result.markdown).toContain(`snapshotId: ${snapshotId}`);
    expect(result.markdown).toContain("topGoalIds:");
    expect(result.markdown).toContain("unitPreferences:");
  });

  it("omits optional frontmatter attributes when the derived values are empty", () => {
    const result = buildCurrentProfileDocument({
      snapshotId,
      updatedAt,
      source: "manual",
      sourceAssessmentIds: [],
      sourceEventIds: null,
      profile: {
        goals: {
          topGoalIds: [42],
        },
        notes: "No optional attributes should survive validation.",
      },
    });

    expect(result.attributes).toEqual({
      schemaVersion: CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter,
      docType: FRONTMATTER_DOC_TYPES.profileCurrent,
      snapshotId,
      updatedAt,
    });

    const parsed = parseFrontmatterDocument(result.markdown);
    expect(parsed.attributes).toEqual(result.attributes);
    expect(parsed.body).toContain("Source: manual");
    expect(parsed.body).toContain("- goals:");
    expect(parsed.body).toContain("  - topGoalIds:");
    expect(parsed.body).toContain("    - 42");
    expect(parsed.rawFrontmatter).not.toContain("sourceAssessmentIds:");
    expect(parsed.rawFrontmatter).not.toContain("sourceEventIds:");
    expect(parsed.rawFrontmatter).not.toContain("topGoalIds:");
    expect(parsed.rawFrontmatter).not.toContain("unitPreferences:");
  });

  it("renders empty nested frontmatter objects and tolerates a scalar runtime profile value", () => {
    const result = buildCurrentProfileDocument({
      snapshotId,
      updatedAt,
      source: "import",
      profile: {
        goals: {},
        unitPreferences: {},
      },
    });

    expect(result.attributes).toEqual({
      schemaVersion: CONTRACT_SCHEMA_VERSION.profileCurrentFrontmatter,
      docType: FRONTMATTER_DOC_TYPES.profileCurrent,
      snapshotId,
      updatedAt,
      unitPreferences: {},
    });
    expect(result.markdown).toContain("unitPreferences: {}");

    const scalarProfile = buildCurrentProfileDocument({
      snapshotId,
      updatedAt,
      source: "runtime",
      profile: "summary-only" as unknown as Record<string, unknown>,
    });

    expect(scalarProfile.body).toContain("summary-only");
    expect(scalarProfile.markdown).toContain("Source: runtime");
  });

  it("throws a joined validation error when derived frontmatter attributes are invalid", () => {
    expect(() =>
      buildCurrentProfileDocument({
        snapshotId: "bad-id",
        updatedAt: "not-a-timestamp",
        source: "invalid",
        profile: {},
      }),
    ).toThrowError(/snapshotId|updatedAt/u);
  });
});
