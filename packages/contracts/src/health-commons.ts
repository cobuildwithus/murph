import * as z from "zod";

export const HEALTH_COMMONS_PAGE_SCHEMA_VERSION = "murph.commons.page.v1" as const;
export const HEALTH_COMMONS_CATALOG_SCHEMA_VERSION = "murph.commons.catalog.v1" as const;
export const HEALTH_COMMONS_CHANGE_SCHEMA_VERSION = "murph.commons.change.v1" as const;
export const HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION = "murph.commons.artifact-manifest.v1" as const;
export const HEALTH_COMMONS_REDIRECTS_SCHEMA_VERSION = "murph.commons.redirects.v1" as const;

export const HEALTH_COMMONS_ENTITY_TYPES = [
  "mission",
  "domain",
  "biomarker",
  "goal_template",
  "experiment_family",
  "protocol_variant",
  "source_person",
  "source_artifact",
  "disambiguation",
] as const;

export type HealthCommonsEntityType = (typeof HEALTH_COMMONS_ENTITY_TYPES)[number];

export const HEALTH_COMMONS_RELATION_TYPES = [
  "alias_of",
  "cites",
  "contraindicates",
  "fork_of",
  "measures",
  "parent_family",
  "primary_biomarker",
  "related_protocol",
  "secondary_biomarker",
  "source_person",
] as const;

export type HealthCommonsRelationType = (typeof HEALTH_COMMONS_RELATION_TYPES)[number];

export const HEALTH_COMMONS_ARTIFACT_KINDS = [
  "abstract",
  "dataset",
  "full_text",
  "html",
  "image",
  "pdf",
  "supplement",
  "text",
  "other",
] as const;

export const HEALTH_COMMONS_ARTIFACT_STORAGE_KINDS = [
  "cloudflare-r2",
  "external",
  "git-lfs",
  "none",
] as const;

export const HEALTH_COMMONS_ARTIFACT_RIGHTS_STATUSES = [
  "unknown",
  "open_access",
  "licensed",
  "permission_required",
  "not_redistributable",
] as const;

const KEY_PATTERN = "^[a-z_]+:[a-z0-9][a-z0-9._/-]*(?:@[A-Za-z0-9._:-]+)?$";
const STABLE_ID_PATTERN = "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$";
const PATH_SEGMENT_PATTERN = "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$";
const SHA256_HEX_PATTERN = "^[a-f0-9]{64}$";

export const healthCommonsEntityTypeSchema = z.enum(HEALTH_COMMONS_ENTITY_TYPES);
export const healthCommonsKeySchema = z.string().regex(new RegExp(KEY_PATTERN, "u"));
export const healthCommonsStableIdSchema = z.string().regex(new RegExp(STABLE_ID_PATTERN, "u"));
export const healthCommonsRelativePathSchema = z.string().regex(new RegExp(PATH_SEGMENT_PATTERN, "u"));
export const healthCommonsSha256HexSchema = z.string().regex(new RegExp(SHA256_HEX_PATTERN, "u"));

const nonEmptyStringSchema = z.string().trim().min(1);
const shortStringSchema = nonEmptyStringSchema.max(240);
const longStringSchema = nonEmptyStringSchema.max(8_000);
const relationTypeSchema = z.union([z.enum(HEALTH_COMMONS_RELATION_TYPES), nonEmptyStringSchema.max(80)]);

export const healthCommonsRelationSchema = z
  .object({
    type: relationTypeSchema,
    target: healthCommonsKeySchema,
    note: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsRelation = z.infer<typeof healthCommonsRelationSchema>;

export const healthCommonsLineageSchema = z
  .object({
    relationship: z.enum([
      "root",
      "fork",
      "external_named_protocol",
      "related_external_protocol",
      "translation",
      "rename",
      "derived",
    ]),
    forkOf: healthCommonsKeySchema.nullable().optional(),
    forkedFromRevisionId: nonEmptyStringSchema.nullable().optional(),
    rationale: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsLineage = z.infer<typeof healthCommonsLineageSchema>;

export const healthCommonsAttributionSchema = z
  .object({
    ownerType: z.enum(["murph", "external", "community", "unknown"]),
    sourcePersonKeys: z.array(healthCommonsKeySchema).optional(),
    sourceUrl: z.string().url().optional(),
    note: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsAttribution = z.infer<typeof healthCommonsAttributionSchema>;

export const healthCommonsClaimSchema = z
  .object({
    claimId: healthCommonsStableIdSchema,
    type: z.enum([
      "association_not_causation",
      "community_outcome",
      "design_guardrail",
      "evidence_scope",
      "intervention_result",
      "mechanistic",
      "mixed_evidence",
      "safety",
    ]),
    text: longStringSchema,
    strength: z.enum(["low", "moderate", "high", "unknown"]),
    sourceKeys: z.array(healthCommonsKeySchema).optional(),
    caveats: z.array(longStringSchema).optional(),
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.type !== "community_outcome" && (!claim.sourceKeys || claim.sourceKeys.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source-backed claims must include at least one sourceKey unless type is community_outcome.",
        path: ["sourceKeys"],
      });
    }
  });

export type HealthCommonsClaim = z.infer<typeof healthCommonsClaimSchema>;

export const healthCommonsBiomarkerWindowSchema = z
  .object({
    baselineDays: z.number().int().positive(),
    interventionDays: z.number().int().positive(),
  })
  .strict();

export const healthCommonsTestPlanSchema = z
  .object({
    planId: healthCommonsStableIdSchema,
    durationDays: z.number().int().positive(),
    baselineDays: z.number().int().nonnegative(),
    interventionDays: z.number().int().positive(),
    primaryBiomarkerKey: healthCommonsKeySchema,
    secondaryBiomarkerKeys: z.array(healthCommonsKeySchema).optional(),
    minimumAdherenceSessions: z.number().int().nonnegative().optional(),
    targetAdherenceSessions: z.number().int().nonnegative().optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsTestPlan = z.infer<typeof healthCommonsTestPlanSchema>;

export const healthCommonsProtocolSpecSchema = z
  .object({
    doseSignature: shortStringSchema,
    frequency: z
      .object({
        sessionsPerWeek: z.number().positive().optional(),
        sessionsPerDay: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    durationMinutes: z
      .object({
        min: z.number().positive().optional(),
        max: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    temperatureC: z
      .object({
        min: z.number().optional(),
        max: z.number().optional(),
      })
      .strict()
      .optional(),
    interventionSessionsMinimum: z.number().int().nonnegative().optional(),
    interventionSessionsTarget: z.number().int().nonnegative().optional(),
    steps: z.array(longStringSchema).optional(),
    stopConditions: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsProtocolSpec = z.infer<typeof healthCommonsProtocolSpecSchema>;

export const healthCommonsSafetySchema = z
  .object({
    cautionLevel: z.enum(["low", "moderate", "high", "unknown"]),
    avoidOrGetClinicianGuidance: z.array(shortStringSchema).optional(),
    stopIf: z.array(shortStringSchema).optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsSafety = z.infer<typeof healthCommonsSafetySchema>;

export const healthCommonsSourceSchema = z
  .object({
    kind: z.enum([
      "journal_article",
      "review",
      "guideline",
      "book",
      "podcast",
      "external_protocol",
      "web_page",
      "other",
    ]),
    title: longStringSchema.optional(),
    authors: longStringSchema.optional(),
    year: z.number().int().min(1800).max(2200).optional(),
    journal: shortStringSchema.optional(),
    pmid: z.string().regex(/^\d+$/u).optional(),
    doi: shortStringSchema.optional(),
    url: z.string().url().optional(),
    citation: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsSource = z.infer<typeof healthCommonsSourceSchema>;

export const healthCommonsArtifactPointerSchema = z
  .object({
    artifactId: healthCommonsStableIdSchema,
    sourceKey: healthCommonsKeySchema.optional(),
    kind: z.enum(HEALTH_COMMONS_ARTIFACT_KINDS),
    storage: z.enum(HEALTH_COMMONS_ARTIFACT_STORAGE_KINDS),
    objectKey: healthCommonsRelativePathSchema.optional(),
    localPath: healthCommonsRelativePathSchema.optional(),
    sourceUrl: z.string().url().optional(),
    contentType: shortStringSchema.optional(),
    sha256: healthCommonsSha256HexSchema.optional(),
    byteSize: z.number().int().nonnegative().optional(),
    rightsStatus: z.enum(HEALTH_COMMONS_ARTIFACT_RIGHTS_STATUSES),
    redistributable: z.boolean(),
    accessNotes: longStringSchema.optional(),
  })
  .strict()
  .superRefine((artifact, context) => {
    if (artifact.storage === "cloudflare-r2" && !artifact.objectKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cloudflare R2 artifacts must include objectKey.",
        path: ["objectKey"],
      });
    }

    if (artifact.redistributable && artifact.rightsStatus === "not_redistributable") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "redistributable cannot be true when rightsStatus is not_redistributable.",
        path: ["redistributable"],
      });
    }
  });

export type HealthCommonsArtifactPointer = z.infer<typeof healthCommonsArtifactPointerSchema>;

export const healthCommonsArtifactManifestSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION),
    manifestKey: healthCommonsKeySchema,
    description: longStringSchema.optional(),
    artifacts: z.array(healthCommonsArtifactPointerSchema),
  })
  .strict();

export type HealthCommonsArtifactManifest = z.infer<typeof healthCommonsArtifactManifestSchema>;

export const healthCommonsDisambiguationOptionSchema = z
  .object({
    key: healthCommonsKeySchema,
    label: shortStringSchema.optional(),
    description: longStringSchema.optional(),
  })
  .strict();

export const healthCommonsPageFrontmatterSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_PAGE_SCHEMA_VERSION),
    entityType: healthCommonsEntityTypeSchema,
    key: healthCommonsKeySchema,
    slug: healthCommonsRelativePathSchema,
    title: shortStringSchema,
    summary: longStringSchema.optional(),
    status: z.enum(["draft", "field-testing", "reviewed", "deprecated", "community"]).optional(),
    quality: z.enum(["stub", "usable", "reviewed", "excellent"]).optional(),
    aliases: z.array(shortStringSchema).optional(),
    categories: z.array(shortStringSchema).optional(),
    relations: z.array(healthCommonsRelationSchema).optional(),
    lineage: healthCommonsLineageSchema.optional(),
    attribution: healthCommonsAttributionSchema.optional(),
    protocol: healthCommonsProtocolSpecSchema.optional(),
    testPlans: z.array(healthCommonsTestPlanSchema).optional(),
    claims: z.array(healthCommonsClaimSchema).optional(),
    safety: healthCommonsSafetySchema.optional(),
    source: healthCommonsSourceSchema.optional(),
    artifacts: z.array(healthCommonsArtifactPointerSchema).optional(),
    options: z.array(healthCommonsDisambiguationOptionSchema).optional(),
  })
  .passthrough()
  .superRefine((page, context) => {
    if (page.entityType === "protocol_variant") {
      if (!page.protocol) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "protocol_variant pages must include a protocol block.",
          path: ["protocol"],
        });
      }
      if (!page.testPlans || page.testPlans.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "protocol_variant pages must include at least one testPlans entry.",
          path: ["testPlans"],
        });
      }
      if (!page.safety) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "protocol_variant pages must include a safety block.",
          path: ["safety"],
        });
      }
      if (!page.lineage) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "protocol_variant pages must include lineage.",
          path: ["lineage"],
        });
      }
      if (!page.attribution) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "protocol_variant pages must include attribution.",
          path: ["attribution"],
        });
      }
    }

    if (page.entityType === "source_artifact" && !page.source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source_artifact pages must include source metadata.",
        path: ["source"],
      });
    }

    if (page.entityType === "disambiguation" && (!page.options || page.options.length === 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "disambiguation pages must include options.",
        path: ["options"],
      });
    }
  });

export type HealthCommonsPageFrontmatter = z.infer<typeof healthCommonsPageFrontmatterSchema>;

export const healthCommonsRedirectSchema = z
  .object({
    from: healthCommonsKeySchema,
    to: healthCommonsKeySchema,
    reason: shortStringSchema.optional(),
  })
  .strict();

export type HealthCommonsRedirect = z.infer<typeof healthCommonsRedirectSchema>;

export const healthCommonsRedirectsFileSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_REDIRECTS_SCHEMA_VERSION),
    redirects: z.array(healthCommonsRedirectSchema),
  })
  .strict();

export type HealthCommonsRedirectsFile = z.infer<typeof healthCommonsRedirectsFileSchema>;

export const healthCommonsChangeRecordSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_CHANGE_SCHEMA_VERSION),
    changeId: healthCommonsStableIdSchema,
    entityKey: healthCommonsKeySchema,
    changeType: z.enum([
      "seed",
      "copy_edit",
      "evidence_change",
      "outcome_change",
      "safety_change",
      "lineage_change",
      "artifact_change",
      "schema_change",
    ]),
    minor: z.boolean(),
    editSummary: longStringSchema,
    rationale: longStringSchema.optional(),
    affectedFields: z.array(shortStringSchema).optional(),
    sourceKeys: z.array(healthCommonsKeySchema).optional(),
    discussionRefs: z.array(shortStringSchema).optional(),
    reviewStatus: z.enum(["proposed", "accepted", "rejected", "superseded"]).optional(),
  })
  .strict();

export type HealthCommonsChangeRecord = z.infer<typeof healthCommonsChangeRecordSchema>;

export const healthCommonsRevisionSchema = z
  .object({
    pageRevisionId: z.string().startsWith("sha256:"),
    runSpecRevisionId: z.string().startsWith("sha256:").nullable().optional(),
    recipeHash: z.string().startsWith("sha256:").nullable().optional(),
  })
  .strict();

export type HealthCommonsRevision = z.infer<typeof healthCommonsRevisionSchema>;

export const healthCommonsCatalogEntitySchema = z.intersection(
  healthCommonsPageFrontmatterSchema,
  z
    .object({
      body: z.string(),
      relativePath: healthCommonsRelativePathSchema,
      revision: healthCommonsRevisionSchema,
    })
    .passthrough(),
);

export type HealthCommonsCatalogEntity = z.infer<typeof healthCommonsCatalogEntitySchema>;

export const healthCommonsCatalogSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_CATALOG_SCHEMA_VERSION),
    catalogHash: z.string().startsWith("sha256:"),
    entities: z.array(healthCommonsCatalogEntitySchema),
    redirects: z.array(healthCommonsRedirectSchema),
    changes: z.array(healthCommonsChangeRecordSchema),
    artifactManifests: z.array(healthCommonsArtifactManifestSchema),
  })
  .strict();

export type HealthCommonsCatalog = z.infer<typeof healthCommonsCatalogSchema>;

export function isHealthCommonsEntityType(value: string): value is HealthCommonsEntityType {
  return (HEALTH_COMMONS_ENTITY_TYPES as readonly string[]).includes(value);
}
