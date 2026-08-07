import * as z from "./zod-runtime.ts";

export const HEALTH_COMMONS_PAGE_SCHEMA_VERSION = "murph.commons.page.v1" as const;
export const HEALTH_COMMONS_CATALOG_SCHEMA_VERSION = "murph.commons.catalog.v1" as const;
export const HEALTH_COMMONS_CHANGE_SCHEMA_VERSION = "murph.commons.change.v1" as const;
export const HEALTH_COMMONS_ARTIFACT_MANIFEST_SCHEMA_VERSION = "murph.commons.artifact-manifest.v1" as const;
export const HEALTH_COMMONS_EVIDENCE_APPRAISAL_SCHEMA_VERSION =
  "murph.commons.evidence-appraisal.v1" as const;
export const HEALTH_COMMONS_SOURCE_INDEX_SCHEMA_VERSION = "murph.commons.source-index.v1" as const;
export const HEALTH_COMMONS_SOURCE_ARTIFACT_INDEX_SCHEMA_VERSION =
  "murph.commons.source-artifact-index.v1" as const;
export const HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION =
  "murph.commons.experiment-onboarding.v2" as const;
export const HEALTH_COMMONS_MEASUREMENT_PLAN_SCHEMA_VERSION =
  "murph.commons.measurement-plan.v1" as const;
export const HEALTH_COMMONS_REDIRECTS_SCHEMA_VERSION = "murph.commons.redirects.v1" as const;

export const HEALTH_COMMONS_ENTITY_TYPES = [
  "mission",
  "domain",
  "biomarker",
  "measurement_method",
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
  "child_family",
  "cites",
  "contraindicates",
  "default_measurement_method",
  "duplicate_source_identity",
  "fork_of",
  "measures",
  "measurement_upgrade",
  "mirror_of",
  "optional_measurement_method",
  "parent_family",
  "primary_biomarker",
  "publication_for",
  "readable_mirror",
  "related_protocol",
  "registry_for",
  "same_work_as",
  "secondary_biomarker",
  "safety_outcome",
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

export const HEALTH_COMMONS_RESEARCH_EVIDENCE_DESIGN_KINDS = [
  "randomized_controlled_trial",
  "controlled_trial",
  "crossover_trial",
  "single_arm_trial",
  "single_person_report",
  "pilot_intervention",
  "prospective_cohort",
  "retrospective_registry",
  "cross_sectional",
  "case_control",
  "acute_mechanistic",
  "systematic_review",
  "meta_analysis",
  "narrative_review",
  "guideline",
  "expert_protocol",
  "bibliography",
  "other",
] as const;

export const HEALTH_COMMONS_RESEARCH_EVIDENCE_AGGREGATE_ROLES = [
  "primary",
  "synthesis",
  "duplicate",
  "context",
  "unknown",
] as const;

export const HEALTH_COMMONS_RESEARCH_EVIDENCE_PARTICIPANT_COUNT_KINDS = [
  "reported",
  "approximate",
  "range",
] as const;

export const HEALTH_COMMONS_PROTOCOL_EVIDENCE_STANCES = [
  "supports",
  "mixed",
  "does_not_confirm",
  "contradicts",
  "safety_boundary",
  "context_only",
] as const;

export type HealthCommonsProtocolEvidenceStance = (typeof HEALTH_COMMONS_PROTOCOL_EVIDENCE_STANCES)[number];

export const HEALTH_COMMONS_PROTOCOL_EVIDENCE_SCOPES = [
  "direct_protocol",
  "same_mechanism",
  "clinical_supervised",
  "adjacent_variant",
  "measurement_context",
  "general_guideline",
] as const;

export type HealthCommonsProtocolEvidenceScope = (typeof HEALTH_COMMONS_PROTOCOL_EVIDENCE_SCOPES)[number];

export const HEALTH_COMMONS_PROTOCOL_EVIDENCE_RESULTS = [
  "positive",
  "mixed",
  "no_clear_advantage",
  "negative",
  "not_efficacy_evidence",
] as const;

export type HealthCommonsProtocolEvidenceResult = (typeof HEALTH_COMMONS_PROTOCOL_EVIDENCE_RESULTS)[number];

export const HEALTH_COMMONS_RESEARCH_LANDSCAPE_CONFIDENCE_LABELS = [
  "early",
  "moderate",
  "strong",
  "mixed",
  "limited",
] as const;

export type HealthCommonsResearchLandscapeConfidenceLabel = (typeof HEALTH_COMMONS_RESEARCH_LANDSCAPE_CONFIDENCE_LABELS)[number];

export const HEALTH_COMMONS_SOURCE_IDENTITY_KINDS = [
  "scholarly_work",
  "trial_registry",
  "guideline",
  "web_page",
  "podcast",
  "book",
  "dataset",
  "other",
] as const;

export type HealthCommonsSourceIdentityKind = (typeof HEALTH_COMMONS_SOURCE_IDENTITY_KINDS)[number];

export const HEALTH_COMMONS_SOURCE_CANONICAL_ID_BASES = [
  "pmid",
  "pmcid",
  "doi",
  "url",
  "registry_id",
  "title_hash",
] as const;

export type HealthCommonsSourceCanonicalIdBasis =
  (typeof HEALTH_COMMONS_SOURCE_CANONICAL_ID_BASES)[number];

export const HEALTH_COMMONS_SOURCE_FINDING_KINDS = [
  "adverse_event",
  "context",
  "intervention_result",
  "measurement_validation",
  "mechanistic",
  "safety",
  "other",
] as const;

export type HealthCommonsSourceFindingKind = (typeof HEALTH_COMMONS_SOURCE_FINDING_KINDS)[number];

export const HEALTH_COMMONS_SOURCE_FINDING_EVIDENCE_USES = [
  "adjacent_variant",
  "context",
  "efficacy",
  "mechanism",
  "measurement",
  "safety",
] as const;

export type HealthCommonsSourceFindingEvidenceUse =
  (typeof HEALTH_COMMONS_SOURCE_FINDING_EVIDENCE_USES)[number];

export const HEALTH_COMMONS_SOURCE_EXTRACTION_STATUSES = [
  "metadata_only",
  "artifacts_available",
  "findings_available",
] as const;

export type HealthCommonsSourceExtractionStatus =
  (typeof HEALTH_COMMONS_SOURCE_EXTRACTION_STATUSES)[number];

export const HEALTH_COMMONS_BIOMARKER_METRIC_BINDING_ROLES = [
  "primary",
  "secondary",
  "context",
] as const;

export type HealthCommonsBiomarkerMetricBindingRole =
  (typeof HEALTH_COMMONS_BIOMARKER_METRIC_BINDING_ROLES)[number];

export const HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS = [
  "higher",
  "higher_or_stable",
  "lower",
  "lower_or_stable",
  "mixed_or_contextual",
  "stable",
] as const;

export type HealthCommonsBiomarkerDesiredDirection =
  (typeof HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS)[number];

export const HEALTH_COMMONS_BIOMARKER_TREND_AGGREGATIONS = ["mean", "median"] as const;

export type HealthCommonsBiomarkerTrendAggregation =
  (typeof HEALTH_COMMONS_BIOMARKER_TREND_AGGREGATIONS)[number];

export const HEALTH_COMMONS_BIOMARKER_PROTOCOL_EXPECTED_DIRECTIONS = [
  "down",
  "down_or_stable",
  "mixed_or_contextual",
  "stable",
  "up",
  "up_or_stable",
] as const;

export type HealthCommonsBiomarkerProtocolExpectedDirection =
  (typeof HEALTH_COMMONS_BIOMARKER_PROTOCOL_EXPECTED_DIRECTIONS)[number];

export const HEALTH_COMMONS_BIOMARKER_COMMUNITY_OUTCOME_STATES = [
  "active",
  "coming_soon",
  "insufficient_data",
] as const;

export type HealthCommonsBiomarkerCommunityOutcomeState =
  (typeof HEALTH_COMMONS_BIOMARKER_COMMUNITY_OUTCOME_STATES)[number];

export const HEALTH_COMMONS_BIOMARKER_GUIDANCE_CLASSIFICATIONS = [
  "generally_applicable_numeric",
  "conditional_numeric",
  "qualitative",
  "calculated_or_method_specific",
  "source_range_only",
  "no_universal_range",
] as const;

export type HealthCommonsBiomarkerGuidanceClassification =
  (typeof HEALTH_COMMONS_BIOMARKER_GUIDANCE_CLASSIFICATIONS)[number];

export const HEALTH_COMMONS_BIOMARKER_GUIDANCE_ITEM_KINDS = [
  "decision_limit",
  "reference_interval",
  "qualitative_interpretation",
  "method_note",
  "evidence_limit",
] as const;

export type HealthCommonsBiomarkerGuidanceItemKind =
  (typeof HEALTH_COMMONS_BIOMARKER_GUIDANCE_ITEM_KINDS)[number];

export const HEALTH_COMMONS_BIOMARKER_GUIDANCE_SOURCE_TYPES = [
  "clinical_guideline",
  "consensus_statement",
  "primary_literature",
  "systematic_review",
  "academic_reference",
  "assay_documentation",
  "regulatory_guidance",
] as const;

export type HealthCommonsBiomarkerGuidanceSourceType =
  (typeof HEALTH_COMMONS_BIOMARKER_GUIDANCE_SOURCE_TYPES)[number];

export const HEALTH_COMMONS_BIOMARKER_FALLBACK_SPECIMEN_KINDS = [
  "serum",
  "plasma",
] as const;

export type HealthCommonsBiomarkerFallbackSpecimenKind =
  (typeof HEALTH_COMMONS_BIOMARKER_FALLBACK_SPECIMEN_KINDS)[number];

const KEY_PATTERN = "^[a-z_]+:[A-Za-z0-9][A-Za-z0-9._:/-]*(?:@[A-Za-z0-9._:-]+)?$";
const STABLE_ID_PATTERN = "^[a-zA-Z0-9][a-zA-Z0-9._:-]*$";
const PATH_SEGMENT_PATTERN = "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))[A-Za-z0-9._/-]+$";
const SHA256_HEX_PATTERN = "^[a-f0-9]{64}$";
const TARGET_FIELD_PATTERN = "^[A-Za-z][A-Za-z0-9]*(?:\\.[A-Za-z][A-Za-z0-9]*)*$";

export const healthCommonsEntityTypeSchema = z.enum(HEALTH_COMMONS_ENTITY_TYPES);
export const healthCommonsKeySchema = z.string().regex(new RegExp(KEY_PATTERN, "u"));
export const healthCommonsStableIdSchema = z.string().regex(new RegExp(STABLE_ID_PATTERN, "u"));
export const healthCommonsRelativePathSchema = z.string().regex(new RegExp(PATH_SEGMENT_PATTERN, "u"));
export const healthCommonsSha256HexSchema = z.string().regex(new RegExp(SHA256_HEX_PATTERN, "u"));

function healthCommonsStableIdArraySchema(options: { minItems?: number } = {}) {
  let schema = z.array(healthCommonsStableIdSchema);

  if (options.minItems !== undefined) {
    schema = schema.min(options.minItems);
  }

  return schema.meta({ uniqueItems: true }).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expected unique stable ids.",
      });
    }
  });
}

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
    safetyOutcomeKeys: z.array(healthCommonsKeySchema).optional(),
    minimumAdherenceSessions: z.number().int().nonnegative().optional(),
    targetAdherenceSessions: z.number().int().nonnegative().optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsTestPlan = z.infer<typeof healthCommonsTestPlanSchema>;

export const HEALTH_COMMONS_EXPECTED_SIGNAL_ESTIMATE_CONFIDENCE = [
  "low",
  "moderate",
  "high",
  "mixed",
] as const;

const healthCommonsNumericExpectedSignalEstimateSchema = z
  .object({
    kind: z.enum(["absolute", "relative_percent"]),
    low: z.number(),
    high: z.number(),
    unit: shortStringSchema,
    window: shortStringSchema.optional(),
    confidence: z
      .enum(HEALTH_COMMONS_EXPECTED_SIGNAL_ESTIMATE_CONFIDENCE)
      .optional(),
    basis: longStringSchema.optional(),
  })
  .strict();

const healthCommonsContextualExpectedSignalEstimateSchema = z
  .object({
    kind: z.literal("mixed_or_contextual"),
    window: shortStringSchema.optional(),
    confidence: z
      .enum(HEALTH_COMMONS_EXPECTED_SIGNAL_ESTIMATE_CONFIDENCE)
      .optional(),
    basis: longStringSchema.optional(),
  })
  .strict();

export const healthCommonsExpectedSignalEstimateSchema = z.discriminatedUnion(
  "kind",
  [
    healthCommonsNumericExpectedSignalEstimateSchema,
    healthCommonsContextualExpectedSignalEstimateSchema,
  ],
);

export type HealthCommonsExpectedSignalEstimate = z.infer<
  typeof healthCommonsExpectedSignalEstimateSchema
>;

export const healthCommonsExpectedSignalDescriptionSchema = z
  .object({
    biomarkerKey: healthCommonsKeySchema,
    description: longStringSchema,
    expected: shortStringSchema.optional(),
    expectedDirection: z
      .enum(HEALTH_COMMONS_BIOMARKER_PROTOCOL_EXPECTED_DIRECTIONS)
      .optional(),
    displayValue: shortStringSchema.optional(),
    estimatedChange: healthCommonsExpectedSignalEstimateSchema.optional(),
    protocolProminence: z.enum(["focus", "context"]).optional(),
  })
  .strict();

export type HealthCommonsExpectedSignalDescription = z.infer<
  typeof healthCommonsExpectedSignalDescriptionSchema
>;

export const HEALTH_COMMONS_MEASUREMENT_METHOD_TIERS = [
  "default_home",
  "optional_home",
  "consumer_device",
  "clinic",
  "research",
  "reference",
] as const;

export type HealthCommonsMeasurementMethodTier =
  (typeof HEALTH_COMMONS_MEASUREMENT_METHOD_TIERS)[number];

export const HEALTH_COMMONS_MEASUREMENT_METHOD_MODALITIES = [
  "self_rating",
  "standardized_photo",
  "calibrated_photo",
  "image_analysis",
  "clinical_scale",
  "instrumented_imaging",
  "biophysical_device",
  "colorimetry",
  "wearable",
  "lab",
  "other",
] as const;

export type HealthCommonsMeasurementMethodModality =
  (typeof HEALTH_COMMONS_MEASUREMENT_METHOD_MODALITIES)[number];

const HEALTH_COMMONS_PRIVACY_SENSITIVE_IMAGE_MODALITIES: readonly HealthCommonsMeasurementMethodModality[] = [
  "standardized_photo",
  "calibrated_photo",
  "image_analysis",
  "instrumented_imaging",
];

export const HEALTH_COMMONS_MEASUREMENT_METHOD_OUTPUT_VALUE_TYPES = [
  "score",
  "number",
  "index",
  "symptom_log",
  "photo",
  "enum",
  "boolean",
  "text",
] as const;

export type HealthCommonsMeasurementMethodOutputValueType =
  (typeof HEALTH_COMMONS_MEASUREMENT_METHOD_OUTPUT_VALUE_TYPES)[number];

export const HEALTH_COMMONS_MEASUREMENT_METHOD_OUTPUT_DIRECTIONS = [
  "higher_is_better",
  "lower_is_better",
  "lower_or_stable",
  "mixed_or_contextual",
] as const;

export type HealthCommonsMeasurementMethodOutputDirection =
  (typeof HEALTH_COMMONS_MEASUREMENT_METHOD_OUTPUT_DIRECTIONS)[number];

export const healthCommonsMeasurementMethodOutputSchema = z
  .object({
    outputId: healthCommonsStableIdSchema,
    label: shortStringSchema,
    valueType: z.enum(HEALTH_COMMONS_MEASUREMENT_METHOD_OUTPUT_VALUE_TYPES),
    unit: shortStringSchema.optional(),
    mapsToBiomarkerKey: healthCommonsKeySchema.optional(),
    direction: z.enum(HEALTH_COMMONS_MEASUREMENT_METHOD_OUTPUT_DIRECTIONS).optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsMeasurementMethodOutput = z.infer<
  typeof healthCommonsMeasurementMethodOutputSchema
>;

export const healthCommonsMeasurementMethodProcedureSchema = z
  .object({
    summary: longStringSchema,
    materials: z.array(shortStringSchema).optional(),
    steps: z.array(longStringSchema).min(1),
    schedule: z.array(shortStringSchema).optional(),
  })
  .strict();

export type HealthCommonsMeasurementMethodProcedure = z.infer<
  typeof healthCommonsMeasurementMethodProcedureSchema
>;

export const healthCommonsMeasurementMethodFidelitySchema = z
  .object({
    minimumRequirements: z.array(longStringSchema).optional(),
    repeatabilityRisks: z.array(shortStringSchema).optional(),
    calibration: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsMeasurementMethodFidelity = z.infer<
  typeof healthCommonsMeasurementMethodFidelitySchema
>;

export const healthCommonsMeasurementMethodPrivacySchema = z
  .object({
    containsIdentifiableImages: z.boolean().optional(),
    localOnlyRecommended: z.boolean().optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsMeasurementMethodPrivacy = z.infer<
  typeof healthCommonsMeasurementMethodPrivacySchema
>;

export const healthCommonsMeasurementMethodBurdenSchema = z
  .object({
    userBurden: z.enum(["low", "moderate", "high"]),
    costTier: z.enum(["free", "low_cost", "consumer_device", "clinic", "research"]),
  })
  .strict();

export type HealthCommonsMeasurementMethodBurden = z.infer<
  typeof healthCommonsMeasurementMethodBurdenSchema
>;

export const healthCommonsMeasurementMethodInterpretationSchema = z
  .object({
    principle: longStringSchema,
    caveat: longStringSchema,
  })
  .strict();

export type HealthCommonsMeasurementMethodInterpretation = z.infer<
  typeof healthCommonsMeasurementMethodInterpretationSchema
>;

export const healthCommonsMeasurementMethodSchema = z
  .object({
    shortName: shortStringSchema.optional(),
    displayName: shortStringSchema.optional(),
    tier: z.enum(HEALTH_COMMONS_MEASUREMENT_METHOD_TIERS),
    modalities: z.array(z.enum(HEALTH_COMMONS_MEASUREMENT_METHOD_MODALITIES)).min(1),
    measuredBiomarkerKeys: z.array(healthCommonsKeySchema).optional(),
    outputs: z.array(healthCommonsMeasurementMethodOutputSchema).min(1),
    procedure: healthCommonsMeasurementMethodProcedureSchema,
    fidelity: healthCommonsMeasurementMethodFidelitySchema.optional(),
    privacy: healthCommonsMeasurementMethodPrivacySchema.optional(),
    burden: healthCommonsMeasurementMethodBurdenSchema.optional(),
    confounders: z.array(shortStringSchema).optional(),
    interpretation: healthCommonsMeasurementMethodInterpretationSchema.optional(),
  })
  .strict()
  .superRefine((method, context) => {
    const hasPrivacySensitiveImageModality = method.modalities.some((modality) =>
      HEALTH_COMMONS_PRIVACY_SENSITIVE_IMAGE_MODALITIES.includes(modality)
    );

    if (!hasPrivacySensitiveImageModality) {
      return;
    }

    if (!method.privacy) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Photo or image measurement methods must include explicit privacy metadata.",
        path: ["privacy"],
      });
      return;
    }

    if (method.privacy.containsIdentifiableImages === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Photo or image measurement methods must explicitly set containsIdentifiableImages.",
        path: ["privacy", "containsIdentifiableImages"],
      });
    }

    if (method.privacy.localOnlyRecommended === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Photo or image measurement methods must explicitly set localOnlyRecommended.",
        path: ["privacy", "localOnlyRecommended"],
      });
    }

    if (
      method.privacy.localOnlyRecommended === false
      && (method.privacy.notes ?? []).length === 0
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Photo or image measurement methods without local-only recommendation must document the privacy exception.",
        path: ["privacy", "notes"],
      });
    }
  });

export type HealthCommonsMeasurementMethod = z.infer<
  typeof healthCommonsMeasurementMethodSchema
>;

export const healthCommonsMeasurementPlanPathSchema = z
  .object({
    pathId: healthCommonsStableIdSchema,
    label: shortStringSchema,
    tier: z.enum(HEALTH_COMMONS_MEASUREMENT_METHOD_TIERS),
    required: z.boolean(),
    methodKeys: z.array(healthCommonsKeySchema).min(1),
    outcomeKeys: z.array(healthCommonsKeySchema).optional(),
    safetyOutcomeKeys: z.array(healthCommonsKeySchema).optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsMeasurementPlanPath = z.infer<
  typeof healthCommonsMeasurementPlanPathSchema
>;

export const healthCommonsMeasurementPlanSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_MEASUREMENT_PLAN_SCHEMA_VERSION),
    defaultPathId: healthCommonsStableIdSchema,
    paths: z.array(healthCommonsMeasurementPlanPathSchema).min(1),
  })
  .strict()
  .superRefine((plan, context) => {
    addDuplicateStableIdIssues(
      context,
      plan.paths,
      ["paths"],
      "pathId",
    );
    if (!plan.paths.some((path) => path.pathId === plan.defaultPathId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "defaultPathId must match one measurement plan pathId.",
        path: ["defaultPathId"],
      });
    }
  });

export type HealthCommonsMeasurementPlan = z.infer<
  typeof healthCommonsMeasurementPlanSchema
>;

export const HEALTH_COMMONS_PROTOCOL_SESSION_SHAPE_SEGMENT_KINDS = [
  "preparation",
  "stimulus",
  "recovery",
  "cooldown",
  "transition",
  "context",
] as const;

export type HealthCommonsProtocolSessionShapeSegmentKind =
  (typeof HEALTH_COMMONS_PROTOCOL_SESSION_SHAPE_SEGMENT_KINDS)[number];

export const healthCommonsProtocolSessionShapeSegmentSchema = z
  .object({
    label: shortStringSchema,
    kind: z.enum(HEALTH_COMMONS_PROTOCOL_SESSION_SHAPE_SEGMENT_KINDS),
    durationMinutes: z.number().positive(),
  })
  .strict();

export type HealthCommonsProtocolSessionShapeSegment = z.infer<
  typeof healthCommonsProtocolSessionShapeSegmentSchema
>;

export const healthCommonsProtocolSessionShapeTickSchema = z.union([
  shortStringSchema,
  z
    .object({
      label: shortStringSchema,
      offsetMinutes: z.number().finite().nonnegative(),
    })
    .strict(),
  z
    .object({
      label: shortStringSchema,
      positionPercent: z.number().finite().min(0).max(100),
    })
    .strict(),
]);

export type HealthCommonsProtocolSessionShapeTick = z.infer<
  typeof healthCommonsProtocolSessionShapeTickSchema
>;

export const healthCommonsProtocolSessionShapeSchema = z
  .object({
    label: shortStringSchema.optional(),
    segments: z.array(healthCommonsProtocolSessionShapeSegmentSchema).min(1),
    summarySegments: z
      .array(healthCommonsProtocolSessionShapeSegmentSchema)
      .min(1)
      .optional(),
    ticks: z.array(healthCommonsProtocolSessionShapeTickSchema).min(2).optional(),
  })
  .strict();

export type HealthCommonsProtocolSessionShape = z.infer<
  typeof healthCommonsProtocolSessionShapeSchema
>;

export const healthCommonsActivitySessionEvidenceSchema = z
  .object({
    activityKinds: z
      .array(nonEmptyStringSchema.max(80))
      .min(1)
      .max(16)
      .meta({ uniqueItems: true })
      .superRefine((values, context) => {
        if (new Set(values).size !== values.length) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Expected unique activity kinds.",
          });
        }
      }),
    minimumDurationMinutes: z.number().int().positive().optional(),
  })
  .strict();

export type HealthCommonsActivitySessionEvidence = z.infer<
  typeof healthCommonsActivitySessionEvidenceSchema
>;

export const healthCommonsProtocolSpecSchema = z
  .object({
    doseSignature: shortStringSchema,
    target: shortStringSchema.optional(),
    activitySessionEvidence: healthCommonsActivitySessionEvidenceSchema.optional(),
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
    sessionShape: healthCommonsProtocolSessionShapeSchema.optional(),
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
    safetyNotes: z.array(longStringSchema).optional(),
    tips: z.array(longStringSchema).optional(),
    keepInMind: z.array(longStringSchema).optional(),
    logFields: z.array(shortStringSchema).optional(),
    sessionFieldIds: healthCommonsStableIdArraySchema({ minItems: 1 }).optional(),
    stopConditions: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsProtocolSpec = z.infer<typeof healthCommonsProtocolSpecSchema>;

export const HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS = [
  "low",
  "moderate",
  "high",
  "unknown",
] as const;

export type HealthCommonsExperimentOnboardingCautionLevel =
  (typeof HEALTH_COMMONS_EXPERIMENT_ONBOARDING_CAUTION_LEVELS)[number];

export const HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SETUP_TARGET_OBJECTS = [
  "protocol",
  "experimentRun",
  "onboardingCapture",
  "assistantSupport",
  "analysisPlan",
] as const;

export type HealthCommonsExperimentOnboardingSetupTargetObject =
  (typeof HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SETUP_TARGET_OBJECTS)[number];

const RESERVED_SETUP_TARGET_FIELD_PREFIXES = [
  "protocol",
  "run",
  "runPlan",
  "onboarding",
  "assistantSupport",
  "analysisPlan",
  "tracking",
  "experiment",
] as const;

const RESERVED_TARGET_FIELD_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

export const HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS = [
  "continue_with_caution",
  "clinician_guidance_before_unsupervised_start",
  "do_not_start_unsupervised",
  "do_not_start_unsupervised_explicit_clinician_clearance_required",
] as const;

export type HealthCommonsExperimentOnboardingPositiveDisposition =
  (typeof HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS)[number];

export const HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES = [
  "never",
  "opt_in_only",
  "default_on",
] as const;

export type HealthCommonsExperimentOnboardingMissedLogPolicy =
  (typeof HEALTH_COMMONS_EXPERIMENT_ONBOARDING_MISSED_LOG_POLICIES)[number];

const experimentOnboardingIdSchema = healthCommonsStableIdSchema;
const experimentOnboardingUnknownRecordSchema = z.record(z.string(), z.unknown());

export const healthCommonsExperimentStartIntentSchema = z
  .object({
    displayPrompt: longStringSchema,
    intentSummary: shortStringSchema,
  })
  .strict();

export type HealthCommonsExperimentStartIntent = z.infer<
  typeof healthCommonsExperimentStartIntentSchema
>;

export const healthCommonsExperimentOnboardingSafetyQuestionSchema = z
  .object({
    id: experimentOnboardingIdSchema,
    prompt: longStringSchema,
    ifPositive: z.enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS).optional(),
    ifNegative: z.enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS).optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingSafetyQuestion = z.infer<
  typeof healthCommonsExperimentOnboardingSafetyQuestionSchema
>;

export const healthCommonsExperimentOnboardingStopPolicySchema = z
  .object({
    additionalConditions: z.array(shortStringSchema).optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingStopPolicy = z.infer<
  typeof healthCommonsExperimentOnboardingStopPolicySchema
>;

export const healthCommonsExperimentOnboardingSafetyScreenSchema = z
  .object({
    dispositionIfAnyPositive: z.enum(
      HEALTH_COMMONS_EXPERIMENT_ONBOARDING_POSITIVE_DISPOSITIONS,
    ),
    mustAsk: z.array(healthCommonsExperimentOnboardingSafetyQuestionSchema).min(1),
    stopIf: healthCommonsExperimentOnboardingStopPolicySchema.optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingSafetyScreen = z.infer<
  typeof healthCommonsExperimentOnboardingSafetyScreenSchema
>;

const experimentOnboardingSetupTargetFieldSchema = shortStringSchema
  .regex(new RegExp(TARGET_FIELD_PATTERN, "u"), "Target field must be a safe dot path.")
  .superRefine(addReservedDotPathSegmentIssues);

export const healthCommonsExperimentOnboardingSetupTargetSchema = z
  .object({
    object: z.enum(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SETUP_TARGET_OBJECTS),
    field: experimentOnboardingSetupTargetFieldSchema,
  })
  .strict()
  .superRefine((target, context) => {
    const firstSegment = target.field.split(".")[0];
    if (
      firstSegment &&
      (RESERVED_SETUP_TARGET_FIELD_PREFIXES as readonly string[]).includes(firstSegment)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Target field must be relative to ${target.object}; omit legacy prefix ${firstSegment}.`,
        path: ["field"],
      });
    }
  });

export type HealthCommonsExperimentOnboardingSetupTarget = z.infer<
  typeof healthCommonsExperimentOnboardingSetupTargetSchema
>;

export const healthCommonsExperimentOnboardingSetupSlotSchema = z
  .object({
    id: experimentOnboardingIdSchema,
    label: shortStringSchema,
    question: longStringSchema,
    options: z.array(experimentOnboardingIdSchema).optional(),
    constraints: experimentOnboardingUnknownRecordSchema.optional(),
    notes: z.array(longStringSchema).optional(),
    target: healthCommonsExperimentOnboardingSetupTargetSchema.optional(),
    writePath: experimentOnboardingSetupTargetFieldSchema.optional(),
  })
  .strict()
  .superRefine((slot, context) => {
    if (!slot.target && !slot.writePath) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Setup slots must declare target or writePath.",
        path: ["target"],
      });
    }
  });

export type HealthCommonsExperimentOnboardingSetupSlot = z.infer<
  typeof healthCommonsExperimentOnboardingSetupSlotSchema
>;

export const healthCommonsExperimentOnboardingPlanDefaultsSchema = z
  .object({
    testPlanId: healthCommonsStableIdSchema.optional(),
    firstSessionGuidance: longStringSchema.optional(),
    missedSessionGuidance: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingPlanDefaults = z.infer<
  typeof healthCommonsExperimentOnboardingPlanDefaultsSchema
>;

export const healthCommonsExperimentOnboardingTrackingHintsSchema = z
  .object({
    confounderFields: healthCommonsStableIdArraySchema({ minItems: 1 }).optional(),
    confounders: z.array(longStringSchema).optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingTrackingHints = z.infer<
  typeof healthCommonsExperimentOnboardingTrackingHintsSchema
>;

export const healthCommonsExperimentOnboardingSupportHintsSchema = z
  .object({
    missedLogFollowupCopy: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingSupportHints = z.infer<
  typeof healthCommonsExperimentOnboardingSupportHintsSchema
>;

export const healthCommonsExperimentOnboardingAdaptationFieldSchema = z
  .object({
    id: experimentOnboardingIdSchema,
    label: shortStringSchema,
    target: healthCommonsExperimentOnboardingSetupTargetSchema,
    sourceSlotIds: z.array(experimentOnboardingIdSchema).optional(),
    requiredForRunSpec: z.boolean().optional(),
    protocolReusable: z.boolean().optional(),
    guidance: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingAdaptationField = z.infer<
  typeof healthCommonsExperimentOnboardingAdaptationFieldSchema
>;

export const healthCommonsExperimentOnboardingAdaptationMeasurementPlanSchema = z
  .object({
    testPlanId: healthCommonsStableIdSchema.optional(),
    requiredSignals: z.array(healthCommonsKeySchema).optional(),
    optionalSignals: z.array(healthCommonsKeySchema).optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingAdaptationMeasurementPlan = z.infer<
  typeof healthCommonsExperimentOnboardingAdaptationMeasurementPlanSchema
>;

export const healthCommonsExperimentOnboardingAdaptationReusableSetupSchema = z
  .object({
    enabled: z.boolean(),
    target: healthCommonsExperimentOnboardingSetupTargetSchema.optional(),
    sourceSlotIds: z.array(experimentOnboardingIdSchema).optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingAdaptationReusableSetup = z.infer<
  typeof healthCommonsExperimentOnboardingAdaptationReusableSetupSchema
>;

export const healthCommonsExperimentOnboardingAdaptationPolicySchema = z
  .object({
    fields: z.array(healthCommonsExperimentOnboardingAdaptationFieldSchema).min(1),
    measurementPlan: healthCommonsExperimentOnboardingAdaptationMeasurementPlanSchema.optional(),
    reusableSetup: healthCommonsExperimentOnboardingAdaptationReusableSetupSchema.optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsExperimentOnboardingAdaptationPolicy = z.infer<
  typeof healthCommonsExperimentOnboardingAdaptationPolicySchema
>;

export const healthCommonsExperimentOnboardingSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_EXPERIMENT_ONBOARDING_SCHEMA_VERSION),
    startIntent: healthCommonsExperimentStartIntentSchema,
    safetyScreen: healthCommonsExperimentOnboardingSafetyScreenSchema.optional(),
    adaptationPolicy: healthCommonsExperimentOnboardingAdaptationPolicySchema.optional(),
    setupSlots: z.array(healthCommonsExperimentOnboardingSetupSlotSchema).optional(),
    planDefaults: healthCommonsExperimentOnboardingPlanDefaultsSchema.optional(),
    trackingHints: healthCommonsExperimentOnboardingTrackingHintsSchema.optional(),
    supportHints: healthCommonsExperimentOnboardingSupportHintsSchema.optional(),
  })
  .strict()
  .superRefine((onboarding, context) => {
    addDuplicateIdIssues(context, onboarding.safetyScreen?.mustAsk ?? [], [
      "safetyScreen",
      "mustAsk",
    ]);
    addDuplicateIdIssues(context, onboarding.adaptationPolicy?.fields ?? [], [
      "adaptationPolicy",
      "fields",
    ]);
    addDuplicateIdIssues(context, onboarding.setupSlots ?? [], ["setupSlots"]);
  });

export type HealthCommonsExperimentOnboarding = z.infer<
  typeof healthCommonsExperimentOnboardingSchema
>;


function addReservedDotPathSegmentIssues(field: string, context: z.RefinementCtx): void {
  for (const segment of field.split(".")) {
    if (RESERVED_TARGET_FIELD_SEGMENTS.has(segment)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Target field segment ${segment} is reserved.`,
      });
    }
  }
}

function addDuplicateIdIssues(
  context: z.RefinementCtx,
  entries: readonly { id: string }[],
  pathPrefix: readonly (string | number)[],
): void {
  const firstIndexById = new Map<string, number>();

  entries.forEach((entry, index) => {
    const firstIndex = firstIndexById.get(entry.id);
    if (firstIndex === undefined) {
      firstIndexById.set(entry.id, index);
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate onboarding id ${entry.id}; first seen at index ${firstIndex}.`,
      path: [...pathPrefix, index, "id"],
    });
  });
}

function addDuplicateStableIdIssues<TField extends string, TEntry extends Record<TField, string>>(
  context: z.RefinementCtx,
  entries: readonly TEntry[],
  pathPrefix: readonly (string | number)[],
  fieldName: TField,
): void {
  const firstIndexById = new Map<string, number>();

  entries.forEach((entry, index) => {
    const id = entry[fieldName];
    const firstIndex = firstIndexById.get(id);
    if (firstIndex === undefined) {
      firstIndexById.set(id, index);
      return;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Duplicate ${fieldName} ${id}; first seen at index ${firstIndex}.`,
      path: [...pathPrefix, index, fieldName],
    });
  });
}

export const healthCommonsSafetySchema = z
  .object({
    cautionLevel: z.enum(["low", "moderate", "high", "unknown"]),
    avoidOrGetClinicianGuidance: z.array(longStringSchema).optional(),
    stopIf: z.array(longStringSchema).optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsSafety = z.infer<typeof healthCommonsSafetySchema>;

export const healthCommonsResearchEvidenceSchema = z
  .object({
    designKind: z.enum(HEALTH_COMMONS_RESEARCH_EVIDENCE_DESIGN_KINDS),
    designLabel: shortStringSchema.optional(),
    participantCount: z.number().int().nonnegative().optional(),
    participantCountKind: z
      .enum(HEALTH_COMMONS_RESEARCH_EVIDENCE_PARTICIPANT_COUNT_KINDS)
      .optional(),
    includedStudyCount: z.number().int().positive().optional(),
    includedStudyCountKind: z
      .enum(HEALTH_COMMONS_RESEARCH_EVIDENCE_PARTICIPANT_COUNT_KINDS)
      .optional(),
    populationLabel: shortStringSchema.optional(),
    durationLabel: shortStringSchema.optional(),
    aggregateRole: z.enum(HEALTH_COMMONS_RESEARCH_EVIDENCE_AGGREGATE_ROLES).optional(),
    aggregationNote: longStringSchema.optional(),
    cohortKey: shortStringSchema.optional(),
    notes: z.array(longStringSchema).optional(),
  })
  .strict();

export type HealthCommonsResearchEvidence = z.infer<
  typeof healthCommonsResearchEvidenceSchema
>;

export const healthCommonsEvidenceAppraisalSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_EVIDENCE_APPRAISAL_SCHEMA_VERSION),
    key: healthCommonsKeySchema,
    sourceKey: healthCommonsKeySchema,
    targetKey: healthCommonsKeySchema,
    targetKind: healthCommonsEntityTypeSchema,
    groupId: healthCommonsStableIdSchema,
    stance: z.enum(HEALTH_COMMONS_PROTOCOL_EVIDENCE_STANCES),
    scope: z.enum(HEALTH_COMMONS_PROTOCOL_EVIDENCE_SCOPES),
    result: z.enum(HEALTH_COMMONS_PROTOCOL_EVIDENCE_RESULTS),
    endpointKeys: z.array(healthCommonsKeySchema).optional(),
    findingKeys: z.array(healthCommonsKeySchema).optional(),
    headline: longStringSchema,
    implication: longStringSchema,
    caveat: longStringSchema.optional(),
    displayPriority: z.number().int().optional(),
  })
  .strict();

export type HealthCommonsEvidenceAppraisal = z.infer<
  typeof healthCommonsEvidenceAppraisalSchema
>;

export const healthCommonsResearchLandscapeGroupSchema = z
  .object({
    id: healthCommonsStableIdSchema,
    label: shortStringSchema,
    stance: z.enum(HEALTH_COMMONS_PROTOCOL_EVIDENCE_STANCES),
    summary: longStringSchema,
    sourceKeys: z.array(healthCommonsKeySchema),
    defaultOpen: z.boolean().optional(),
  })
  .strict();

export type HealthCommonsResearchLandscapeGroup = z.infer<
  typeof healthCommonsResearchLandscapeGroupSchema
>;

export const healthCommonsResearchLandscapeSchema = z
  .object({
    bottomLine: longStringSchema,
    confidenceLabel: z.enum(HEALTH_COMMONS_RESEARCH_LANDSCAPE_CONFIDENCE_LABELS),
    primaryClaim: longStringSchema,
    mainCaveat: longStringSchema,
    groups: z.array(healthCommonsResearchLandscapeGroupSchema),
  })
  .strict();

export type HealthCommonsResearchLandscape = z.infer<
  typeof healthCommonsResearchLandscapeSchema
>;

export const healthCommonsSourceIdentityIdentifiersSchema = z
  .object({
    pmid: z.string().regex(/^\d+$/u).optional(),
    pmcid: shortStringSchema.optional(),
    doi: shortStringSchema.optional(),
    registryId: shortStringSchema.optional(),
    titleHash: healthCommonsSha256HexSchema.optional(),
    url: z.string().url().optional(),
  })
  .strict();

export type HealthCommonsSourceIdentityIdentifiers = z.infer<
  typeof healthCommonsSourceIdentityIdentifiersSchema
>;

export const healthCommonsSourceIdentitySchema = z
  .object({
    identityKind: z.enum(HEALTH_COMMONS_SOURCE_IDENTITY_KINDS),
    canonicalIdBasis: z.enum(HEALTH_COMMONS_SOURCE_CANONICAL_ID_BASES),
    identifiers: healthCommonsSourceIdentityIdentifiersSchema.optional(),
    canonicalUrl: z.string().url().optional(),
    identityAliases: z.array(shortStringSchema).optional(),
  })
  .strict()
  .superRefine((identity, context) => {
    const identifiers = Object.values(identity.identifiers ?? {}).filter((value) => Boolean(value));
    const hasUrlIdentity = Boolean(identity.identifiers?.url || identity.canonicalUrl);

    if (
      identifiers.length === 0
      && !identity.canonicalUrl
      && (!identity.identityAliases || identity.identityAliases.length === 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity must include at least one identifier, canonicalUrl, or identityAlias.",
        path: ["identifiers"],
      });
    }

    if (identity.canonicalIdBasis === "url" && !hasUrlIdentity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity canonicalIdBasis=url requires identifiers.url or canonicalUrl.",
        path: ["canonicalIdBasis"],
      });
    }

    if (identity.canonicalIdBasis === "pmid" && !identity.identifiers?.pmid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity canonicalIdBasis=pmid requires identifiers.pmid.",
        path: ["identifiers", "pmid"],
      });
    }

    if (identity.canonicalIdBasis === "doi" && !identity.identifiers?.doi) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity canonicalIdBasis=doi requires identifiers.doi.",
        path: ["identifiers", "doi"],
      });
    }

    if (identity.canonicalIdBasis === "pmcid" && !identity.identifiers?.pmcid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity canonicalIdBasis=pmcid requires identifiers.pmcid.",
        path: ["identifiers", "pmcid"],
      });
    }

    if (identity.canonicalIdBasis === "registry_id" && !identity.identifiers?.registryId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity canonicalIdBasis=registry_id requires identifiers.registryId.",
        path: ["identifiers", "registryId"],
      });
    }

    if (identity.canonicalIdBasis === "title_hash" && !identity.identifiers?.titleHash) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity canonicalIdBasis=title_hash requires identifiers.titleHash.",
        path: ["identifiers", "titleHash"],
      });
    }
  });

export type HealthCommonsSourceIdentity = z.infer<typeof healthCommonsSourceIdentitySchema>;

export const healthCommonsSourceFindingSchema = z
  .object({
    findingId: healthCommonsKeySchema,
    sourceKey: healthCommonsKeySchema.optional(),
    extractedFromArtifactId: healthCommonsStableIdSchema.optional(),
    sourceRevisionId: z.string().startsWith("sha256:").optional(),
    extractionRevisionId: z.string().startsWith("sha256:").optional(),
    findingKind: z.enum(HEALTH_COMMONS_SOURCE_FINDING_KINDS),
    population: longStringSchema.optional(),
    exposure: longStringSchema.optional(),
    outcome: longStringSchema.optional(),
    summary: longStringSchema.optional(),
    evidenceUse: z.array(z.enum(HEALTH_COMMONS_SOURCE_FINDING_EVIDENCE_USES)).optional(),
  })
  .strict()
  .superRefine((finding, context) => {
    if (!finding.summary && !finding.outcome) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceFindings entries must include summary or outcome.",
        path: ["summary"],
      });
    }
  });

export type HealthCommonsSourceFinding = z.infer<typeof healthCommonsSourceFindingSchema>;

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
    registryId: shortStringSchema.optional(),
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

export const healthCommonsInterpretationFrameSchema = z
  .object({
    principle: longStringSchema,
    caveat: longStringSchema,
  })
  .strict();

export type HealthCommonsInterpretationFrame = z.infer<
  typeof healthCommonsInterpretationFrameSchema
>;

export const healthCommonsBiomarkerDirectionSchema = z
  .object({
    desired: z.enum(HEALTH_COMMONS_BIOMARKER_DESIRED_DIRECTIONS),
    label: shortStringSchema,
    nuance: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsBiomarkerDirection = z.infer<
  typeof healthCommonsBiomarkerDirectionSchema
>;

export const healthCommonsBiomarkerPrivateMetricBindingSchema = z
  .object({
    source: z.literal("metric"),
    metricKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    role: z.enum(HEALTH_COMMONS_BIOMARKER_METRIC_BINDING_ROLES).optional(),
    unit: shortStringSchema.optional(),
  })
  .strict();

export type HealthCommonsBiomarkerPrivateMetricBinding = z.infer<
  typeof healthCommonsBiomarkerPrivateMetricBindingSchema
>;

export const healthCommonsBiomarkerTrendDefaultsSchema = z
  .object({
    latestWindowDays: z.number().int().positive(),
    comparisonWindowDays: z.number().int().positive(),
    minimumPoints: z.number().int().positive(),
    aggregation: z.enum(HEALTH_COMMONS_BIOMARKER_TREND_AGGREGATIONS),
  })
  .strict();

export type HealthCommonsBiomarkerTrendDefaults = z.infer<
  typeof healthCommonsBiomarkerTrendDefaultsSchema
>;

export const healthCommonsBiomarkerExplainerCardSchema = z
  .object({
    title: shortStringSchema,
    body: longStringSchema,
  })
  .strict();

export type HealthCommonsBiomarkerExplainerCard = z.infer<
  typeof healthCommonsBiomarkerExplainerCardSchema
>;

export const healthCommonsBiomarkerMeasurementSchema = z
  .object({
    bestContext: longStringSchema,
    howToMeasure: z.array(longStringSchema).min(1),
    confounders: z.array(shortStringSchema).optional(),
  })
  .strict();

export type HealthCommonsBiomarkerMeasurement = z.infer<
  typeof healthCommonsBiomarkerMeasurementSchema
>;

export const healthCommonsBiomarkerGuidanceBoundSchema = z
  .object({
    value: z.number().finite(),
    inclusive: z.boolean(),
  })
  .strict();

export type HealthCommonsBiomarkerGuidanceBound = z.infer<
  typeof healthCommonsBiomarkerGuidanceBoundSchema
>;

export const healthCommonsBiomarkerGuidanceNumericValueSchema = z
  .object({
    label: shortStringSchema,
    unit: shortStringSchema,
    lowerBound: healthCommonsBiomarkerGuidanceBoundSchema.optional(),
    upperBound: healthCommonsBiomarkerGuidanceBoundSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.lowerBound && !value.upperBound) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Numeric guidance must preserve at least one explicit bound.",
      });
    }
    if (
      value.lowerBound
      && value.upperBound
      && value.lowerBound.value >= value.upperBound.value
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Numeric guidance lower bounds must be lower than upper bounds.",
      });
    }
  });

export type HealthCommonsBiomarkerGuidanceNumericValue = z.infer<
  typeof healthCommonsBiomarkerGuidanceNumericValueSchema
>;

export const healthCommonsBiomarkerGuidanceSourceSchema = z
  .object({
    title: shortStringSchema,
    organization: shortStringSchema,
    year: z.number().int().min(1900).max(2100),
    sourceType: z.enum(HEALTH_COMMONS_BIOMARKER_GUIDANCE_SOURCE_TYPES),
    url: z.string().url().optional(),
    doi: shortStringSchema.optional(),
    pmid: z.string().regex(/^\d+$/u).optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (!source.url && !source.doi && !source.pmid) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Guidance sources require a URL, DOI, or PMID.",
      });
    }
  });

export type HealthCommonsBiomarkerGuidanceSource = z.infer<
  typeof healthCommonsBiomarkerGuidanceSourceSchema
>;

export const healthCommonsBiomarkerFallbackRangeSchema = z
  .object({
    eligibleSpecimenKinds: z
      .array(z.enum(HEALTH_COMMONS_BIOMARKER_FALLBACK_SPECIMEN_KINDS))
      .min(1),
    label: shortStringSchema,
    unit: shortStringSchema,
    lowerBound: healthCommonsBiomarkerGuidanceBoundSchema.optional(),
    upperBound: healthCommonsBiomarkerGuidanceBoundSchema.optional(),
    applicability: longStringSchema,
    source: healthCommonsBiomarkerGuidanceSourceSchema,
  })
  .strict()
  .superRefine((range, context) => {
    if (!range.lowerBound && !range.upperBound) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fallback ranges must preserve at least one explicit bound.",
      });
    }
    if (
      range.lowerBound
      && range.upperBound
      && range.lowerBound.value >= range.upperBound.value
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fallback range lower bounds must be lower than upper bounds.",
      });
    }
  });

export type HealthCommonsBiomarkerFallbackRange = z.infer<
  typeof healthCommonsBiomarkerFallbackRangeSchema
>;

export const healthCommonsBiomarkerGuidanceItemSchema = z
  .object({
    kind: z.enum(HEALTH_COMMONS_BIOMARKER_GUIDANCE_ITEM_KINDS),
    guidance: longStringSchema,
    applicability: longStringSchema,
    numericValues: z.array(healthCommonsBiomarkerGuidanceNumericValueSchema).min(1).optional(),
    source: healthCommonsBiomarkerGuidanceSourceSchema,
  })
  .strict();

export type HealthCommonsBiomarkerGuidanceItem = z.infer<
  typeof healthCommonsBiomarkerGuidanceItemSchema
>;

export const healthCommonsBiomarkerReferenceGuidanceSchema = z
  .object({
    classification: z.enum(HEALTH_COMMONS_BIOMARKER_GUIDANCE_CLASSIFICATIONS),
    reviewStatus: z.literal("reviewed"),
    use: z.literal("context_only"),
    fallbackRanges: z.array(healthCommonsBiomarkerFallbackRangeSchema).min(1).optional(),
    items: z.array(healthCommonsBiomarkerGuidanceItemSchema).min(1),
  })
  .strict()
  .superRefine((guidance, context) => {
    if (
      (guidance.classification === "generally_applicable_numeric"
        || guidance.classification === "conditional_numeric")
      && !guidance.items.some((item) => item.numericValues && item.numericValues.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Numeric guidance classifications require at least one bounded numeric value.",
      });
    }
    if (
      guidance.classification === "qualitative"
      && guidance.items.some((item) => item.numericValues && item.numericValues.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Qualitative guidance must not manufacture numeric values.",
      });
    }
    if (
      guidance.fallbackRanges
      && new Set(guidance.fallbackRanges.map((range) => range.unit)).size
        !== guidance.fallbackRanges.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Fallback ranges must use unique exact units.",
        path: ["fallbackRanges"],
      });
    }
  });

export type HealthCommonsBiomarkerReferenceGuidance = z.infer<
  typeof healthCommonsBiomarkerReferenceGuidanceSchema
>;

export const healthCommonsBiomarkerDetailSchema = z
  .object({
    shortName: shortStringSchema.optional(),
    displayName: shortStringSchema.optional(),
    unit: shortStringSchema.optional(),
    valuePrecision: z.number().int().min(0).max(4).optional(),
    direction: healthCommonsBiomarkerDirectionSchema.optional(),
    privateMetricBindings: z.array(healthCommonsBiomarkerPrivateMetricBindingSchema).optional(),
    trendDefaults: healthCommonsBiomarkerTrendDefaultsSchema.optional(),
    explainerCards: z.array(healthCommonsBiomarkerExplainerCardSchema).optional(),
    measurement: healthCommonsBiomarkerMeasurementSchema.optional(),
  })
  .strict();

export type HealthCommonsBiomarkerDetail = z.infer<
  typeof healthCommonsBiomarkerDetailSchema
>;

export const healthCommonsBiomarkerCommunityOutcomeSummarySchema = z
  .object({
    state: z.enum(HEALTH_COMMONS_BIOMARKER_COMMUNITY_OUTCOME_STATES),
    minimumCohortSize: z.number().int().positive().optional(),
    placeholder: longStringSchema.optional(),
  })
  .strict();

export type HealthCommonsBiomarkerCommunityOutcomeSummary = z.infer<
  typeof healthCommonsBiomarkerCommunityOutcomeSummarySchema
>;

export const healthCommonsMechanismChainStepSchema = z
  .object({
    label: shortStringSchema,
    content: longStringSchema,
  })
  .strict();

export type HealthCommonsMechanismChainStep = z.infer<
  typeof healthCommonsMechanismChainStepSchema
>;

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
    hidden: z.boolean().optional(),
    preferredRouteId: healthCommonsStableIdSchema.optional(),
    sortRank: z.number().finite().optional(),
    aliases: z.array(shortStringSchema).optional(),
    categories: z.array(shortStringSchema).optional(),
    relations: z.array(healthCommonsRelationSchema).optional(),
    lineage: healthCommonsLineageSchema.optional(),
    attribution: healthCommonsAttributionSchema.optional(),
    protocol: healthCommonsProtocolSpecSchema.optional(),
    unit: shortStringSchema.optional(),
    measurementContexts: z.array(shortStringSchema).optional(),
    interpretationFrame: healthCommonsInterpretationFrameSchema.optional(),
    biomarker: healthCommonsBiomarkerDetailSchema.optional(),
    referenceGuidance: healthCommonsBiomarkerReferenceGuidanceSchema.optional(),
    measurementMethod: healthCommonsMeasurementMethodSchema.optional(),
    communityOutcomeSummary: healthCommonsBiomarkerCommunityOutcomeSummarySchema.optional(),
    testPlans: z.array(healthCommonsTestPlanSchema).optional(),
    expectedSignalDescriptions: z.array(healthCommonsExpectedSignalDescriptionSchema).optional(),
    measurementPlan: healthCommonsMeasurementPlanSchema.optional(),
    experimentOnboarding: healthCommonsExperimentOnboardingSchema.optional(),
    whyItWorks: z.array(longStringSchema).optional(),
    mechanismChain: z.array(healthCommonsMechanismChainStepSchema).optional(),
    claims: z.array(healthCommonsClaimSchema).optional(),
    safety: healthCommonsSafetySchema.optional(),
    sourceIdentity: healthCommonsSourceIdentitySchema.optional(),
    source: healthCommonsSourceSchema.optional(),
    sourceFindings: z.array(healthCommonsSourceFindingSchema).optional(),
    researchEvidence: healthCommonsResearchEvidenceSchema.optional(),
    researchLandscape: healthCommonsResearchLandscapeSchema.optional(),
    artifacts: z.array(healthCommonsArtifactPointerSchema).optional(),
    options: z.array(healthCommonsDisambiguationOptionSchema).optional(),
  })
  .passthrough()
  .superRefine((page, context) => {
    const rawPage = page as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(rawPage, "canonicalMetadata")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "canonicalMetadata has been replaced by sourceIdentity.",
        path: ["canonicalMetadata"],
      });
    }
    if (Object.prototype.hasOwnProperty.call(rawPage, "protocolEvidence")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "protocolEvidence has moved to standalone evidence_appraisal records.",
        path: ["protocolEvidence"],
      });
    }
    if (Object.prototype.hasOwnProperty.call(rawPage, "protocolRanking")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "protocolRanking has been replaced by protocol expectedSignalDescriptions.",
        path: ["protocolRanking"],
      });
    }

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

    if (page.entityType === "measurement_method") {
      if (!page.measurementMethod) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "measurement_method pages must include a measurementMethod block.",
          path: ["measurementMethod"],
        });
      }
    } else if (page.measurementMethod) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "measurementMethod is only valid on measurement_method pages.",
        path: ["measurementMethod"],
      });
    }

    if (page.entityType !== "biomarker" && page.referenceGuidance) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "referenceGuidance is only valid on biomarker pages.",
        path: ["referenceGuidance"],
      });
    }

    if (page.entityType !== "protocol_variant" && page.measurementPlan) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "measurementPlan is only valid on protocol_variant pages.",
        path: ["measurementPlan"],
      });
    }
    if (page.entityType !== "protocol_variant" && page.mechanismChain) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "mechanismChain is only valid on protocol_variant pages.",
        path: ["mechanismChain"],
      });
    }

    if (page.entityType === "source_artifact" && !page.source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source_artifact pages must include source metadata.",
        path: ["source"],
      });
    }

    if (page.entityType !== "source_artifact" && page.sourceIdentity) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceIdentity is only valid on source_artifact pages.",
        path: ["sourceIdentity"],
      });
    }

    if (page.entityType !== "source_artifact" && page.sourceFindings) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceFindings are only valid on source_artifact pages.",
        path: ["sourceFindings"],
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

export const healthCommonsSourceIndexEntrySchema = z
  .object({
    sourceKey: healthCommonsKeySchema,
    relativePath: healthCommonsRelativePathSchema,
    title: shortStringSchema,
    sourceKind: shortStringSchema.nullable(),
    identityKind: z.enum(HEALTH_COMMONS_SOURCE_IDENTITY_KINDS).nullable(),
    canonicalIdBasis: z.enum(HEALTH_COMMONS_SOURCE_CANONICAL_ID_BASES).nullable(),
    identifiers: healthCommonsSourceIdentityIdentifiersSchema,
    canonicalUrl: z.string().url().nullable(),
    sourceUrl: z.string().url().nullable(),
    identityAliases: z.array(shortStringSchema),
    identityKeys: z.array(nonEmptyStringSchema.max(1_000)),
    artifactIds: z.array(healthCommonsStableIdSchema),
    findingIds: z.array(healthCommonsKeySchema),
    metadataFetchedAt: z.string().datetime().nullable(),
    extractionStatus: z.enum(HEALTH_COMMONS_SOURCE_EXTRACTION_STATUSES),
    sourceRevisionId: z.string().startsWith("sha256:"),
  })
  .strict();

export type HealthCommonsSourceIndexEntry = z.infer<typeof healthCommonsSourceIndexEntrySchema>;

export const healthCommonsSourceIdentityLookupEntrySchema = z
  .object({
    identityKey: nonEmptyStringSchema.max(1_000),
    sourceKeys: z.array(healthCommonsKeySchema).min(1),
    canonicalSourceKey: healthCommonsKeySchema.nullable(),
  })
  .strict();

export type HealthCommonsSourceIdentityLookupEntry = z.infer<
  typeof healthCommonsSourceIdentityLookupEntrySchema
>;

export const healthCommonsSourceIndexSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_SOURCE_INDEX_SCHEMA_VERSION),
    generatedFromCatalogHash: z.string().startsWith("sha256:"),
    sources: z.array(healthCommonsSourceIndexEntrySchema),
    identityLookup: z.array(healthCommonsSourceIdentityLookupEntrySchema),
    duplicateIdentities: z.array(healthCommonsSourceIdentityLookupEntrySchema),
  })
  .strict();

export type HealthCommonsSourceIndex = z.infer<typeof healthCommonsSourceIndexSchema>;

export const healthCommonsSourceArtifactIndexEntrySchema = z.intersection(
  healthCommonsArtifactPointerSchema,
  z
    .object({
      manifestKey: healthCommonsKeySchema,
      sourceKey: healthCommonsKeySchema,
    })
    .strict(),
);

export type HealthCommonsSourceArtifactIndexEntry = z.infer<
  typeof healthCommonsSourceArtifactIndexEntrySchema
>;

export const healthCommonsSourceArtifactIndexSchema = z
  .object({
    schemaVersion: z.literal(HEALTH_COMMONS_SOURCE_ARTIFACT_INDEX_SCHEMA_VERSION),
    generatedFromCatalogHash: z.string().startsWith("sha256:"),
    artifacts: z.array(healthCommonsSourceArtifactIndexEntrySchema),
    sources: z.array(
      z
        .object({
          sourceKey: healthCommonsKeySchema,
          artifactIds: z.array(healthCommonsStableIdSchema),
        })
        .strict(),
    ),
  })
  .strict();

export type HealthCommonsSourceArtifactIndex = z.infer<
  typeof healthCommonsSourceArtifactIndexSchema
>;

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
    evidenceAppraisals: z.array(healthCommonsEvidenceAppraisalSchema).default([]),
  })
  .strict();

export type HealthCommonsCatalog = z.infer<typeof healthCommonsCatalogSchema>;

export function isHealthCommonsEntityType(value: string): value is HealthCommonsEntityType {
  return (HEALTH_COMMONS_ENTITY_TYPES as readonly string[]).includes(value);
}
