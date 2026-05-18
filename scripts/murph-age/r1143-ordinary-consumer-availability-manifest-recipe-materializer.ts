import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { findForbiddenAggregateEgress } from "./midus2-local-benchmark.ts";

export const R1143_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_RECIPE_MATERIALIZER_SCHEMA_VERSION =
  "murph-age-r1143-ordinary-consumer-availability-manifest-recipe-materializer.v1" as const;

const AVAILABILITY_MANIFEST_SCHEMA_VERSION =
  "murph-age-r1133-ordinary-consumer-data-availability-manifest.v1" as const;
const DEFAULT_MODEL_RUNS_DIR = path.join(
  ".runtime",
  "operations",
  "research",
  "murph-age",
  "model-runs",
);
const OUTPUT_FILE_NAME =
  "r1143-ordinary-consumer-availability-manifest-recipe-materializer.latest.json";
const GENERATED_MANIFEST_FILE_NAME =
  "r1143-generated-safe-ordinary-consumer-availability-manifest.latest.json";
const DEFAULT_RECIPE_ID = "lab_plus_wearable_minimum_manifest";
const MATERIALIZER_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID=<recipe-id> MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED=true pnpm exec tsx scripts/murph-age/r1143-ordinary-consumer-availability-manifest-recipe-materializer.ts" as const;
const R1133_PREFLIGHT_WITH_GENERATED_MANIFEST_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<generated-safe-availability-manifest.json> pnpm exec tsx scripts/murph-age/r1133-ordinary-consumer-data-availability-preflight.ts" as const;
const R1136_CHAIN_WITH_GENERATED_MANIFEST_COMMAND =
  "MURPH_AGE_ORDINARY_CONSUMER_DATA_AVAILABILITY_MANIFEST_PATH=<generated-safe-availability-manifest.json> pnpm exec tsx scripts/murph-age/r1136-ordinary-consumer-availability-chain-runner.ts" as const;
const R1135_EXPECTED = {
  artifact: "r1135-ordinary-consumer-availability-manifest-packet.latest.json",
  packetId: "r1135-ordinary-consumer-availability-manifest-packet",
  schemaVersion: "murph-age-r1135-ordinary-consumer-availability-manifest-packet.v1",
} as const;
const R1150_EXPECTED = {
  artifact: "r1150-ordinary-consumer-safe-availability-confirmation-intake.latest.json",
  packetId: "r1150-ordinary-consumer-safe-availability-confirmation-intake",
  schemaVersion: "murph-age-r1150-ordinary-consumer-safe-availability-confirmation-intake.v1",
} as const;

const ORDINARY_SOURCE_FAMILY_IDS = [
  "join_time_alignment",
  "outcome_linkage",
  "bloodwork_glycemia",
  "common_bloodwork_core",
  "vitals_body_context",
  "wearable_activity_daily",
] as const;
const BLOCKED_MANIFEST_CONTENT = [
  "private_paths",
  "header_names",
  "source_variable_names",
  "file_names",
  "row_values",
  "participant_identifiers",
  "predictions",
  "coefficients",
  "source_text",
] as const;
const REQUIRED_SAFE_MANIFEST_ATTESTATIONS = [
  "aggregateOnly",
  "noCoefficientEgress",
  "noHeaderNameEgress",
  "noParticipantEgress",
  "noPredictionEgress",
  "noRowEgress",
  "noSmallCellEgress",
  "noSourceTextEgress",
] as const;

type MaterializerConclusion =
  | "ordinary_manifest_recipe_materializer_generated_safe_manifest"
  | "ordinary_manifest_recipe_materializer_recipe_not_found"
  | "ordinary_manifest_recipe_materializer_waiting_on_r1135"
  | "ordinary_manifest_recipe_materializer_waiting_on_row_owner_confirmation";
type MaterializerNextAction =
  | "choose_supported_manifest_recipe_id"
  | "confirm_recipe_availability_assertions_before_generating_manifest"
  | "refresh_r1135_manifest_packet"
  | "run_r1133_with_generated_safe_manifest_then_r1136_or_r1142";
type OrdinarySourceFamilyId = typeof ORDINARY_SOURCE_FAMILY_IDS[number];
type RequiredSafeManifestAttestation = typeof REQUIRED_SAFE_MANIFEST_ATTESTATIONS[number];

interface ArtifactSummary {
  artifact: string;
  packetId: string | null;
  schemaVersion: string | null;
  status: "available" | "missing";
}

interface RouteRecipe {
  expectedEligiblePartialRouteIds: string[];
  expectedFullSupportedRouteId: string | null;
  expectedFullSupportedRouteReady: boolean;
  recipeId: string;
  recipeRouteGroupId: string;
  routeKind: string;
  routeUse: string;
  sourceFamiliesToDeclareAvailable: OrdinarySourceFamilyId[];
  sourceFamiliesToDeclareUnavailable: OrdinarySourceFamilyId[];
}

interface RowOwnerAssertionChecklistItem {
  assertionId: string;
  familyId: OrdinarySourceFamilyId;
  requiredStatus: "confirmed_available_for_this_recipe_before_generation";
}

interface GeneratedAvailabilityManifest {
  aggregateReadinessFacts: {
    eventCountBand: "10_plus";
    outcomeLinked: true;
    sameDenominator: true;
    targetAgeBand: "roughly_16_50";
    usableRecordCountBand: "50_plus";
  };
  attestations: Record<RequiredSafeManifestAttestation, true>;
  blockedManifestContent: typeof BLOCKED_MANIFEST_CONTENT[number][];
  recipeMaterialization: {
    expectedEligiblePartialRouteIds: string[];
    expectedFullSupportedRouteId: string | null;
    expectedFullSupportedRouteReady: boolean;
    generatedBy: "r1143-ordinary-consumer-availability-manifest-recipe-materializer";
    productDisplayAuthorized: false;
    recipeId: string;
    recipeRouteGroupId: string;
    rowOwnerAssertionsConfirmed: true;
  };
  schemaVersion: typeof AVAILABILITY_MANIFEST_SCHEMA_VERSION;
  selectedTableLayout: "single_primary_table_fallback";
  sourceFamilies: Array<{
    available: boolean;
    familyId: OrdinarySourceFamilyId;
  }>;
  targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
}

export interface R1143OrdinaryConsumerAvailabilityManifestRecipeMaterializerOptions {
  assertionsConfirmed?: boolean;
  createdAt?: string;
  outputDir?: string;
  r1135Path?: string;
  r1150Path?: string;
  recipeId?: string;
}

export interface R1143OrdinaryConsumerAvailabilityManifestRecipeMaterializerOutput {
  artifactBoundary: {
    aggregateOnly: true;
    availabilityManifestPathStored: false;
    codebookTextStored: false;
    coefficientsStored: false;
    fileNamesStored: false;
    headerValuesStored: false;
    localPathsStored: false;
    modelParametersStored: false;
    outcomeScoringPerformedByR1143: false;
    participantIdentifiersStored: false;
    participantIdentifiersWritten: false;
    predictionsStored: false;
    privateConfigValuesStored: false;
    privateFieldRefsStored: false;
    privateTableRefsStored: false;
    productClaimsIncluded: false;
    productDisplayAuthorized: false;
    productPromotionAuthorized: false;
    recommendationClaimsIncluded: false;
    rowParsingPerformedByR1143: false;
    rowValuesStored: false;
    smallCellsStored: false;
    sourceBodiesStored: false;
    sourceFileNamesStored: false;
    sourceVariableNamesStored: false;
    splitMembershipStored: false;
  };
  createdAt: string;
  inputArtifacts: {
    r1135: ArtifactSummary;
    r1150: ArtifactSummary;
  };
  manifestRecipeMaterializer: {
    availableRecipeIds: string[];
    availabilityChainWithGeneratedManifestCommand: typeof R1136_CHAIN_WITH_GENERATED_MANIFEST_COMMAND;
    availabilityPreflightWithGeneratedManifestCommand: typeof R1133_PREFLIGHT_WITH_GENERATED_MANIFEST_COMMAND;
    generatedAvailabilityManifestArtifact: typeof GENERATED_MANIFEST_FILE_NAME | null;
    generatedAvailabilityManifestSchemaVersion: typeof AVAILABILITY_MANIFEST_SCHEMA_VERSION | null;
    generatedManifestWritten: boolean;
    materializerCommand: typeof MATERIALIZER_COMMAND;
    partialPrivateChainRunnerCommand: string | null;
    privateDetailsStored: false;
    requestedRecipeId: string;
    rowOwnerAssertionChecklist: RowOwnerAssertionChecklistItem[];
    rowOwnerAssertionsConfirmed: boolean;
    safeAvailabilityConfirmationReadyForRecipeReadinessChain: boolean;
    selectedRecipe: RouteRecipe | null;
    sourceFamiliesDeclaredAvailable: OrdinarySourceFamilyId[];
    sourceFamiliesDeclaredUnavailable: OrdinarySourceFamilyId[];
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
  packetId: "r1143-ordinary-consumer-availability-manifest-recipe-materializer";
  productDisplayAuthorized: false;
  schemaVersion: typeof R1143_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_RECIPE_MATERIALIZER_SCHEMA_VERSION;
  status: "research-local-aggregate-only";
  summary: {
    conclusion: MaterializerConclusion;
    generatedAvailabilityManifestArtifact: typeof GENERATED_MANIFEST_FILE_NAME | null;
    generatedManifestWritten: boolean;
    nextAction: MaterializerNextAction;
    productDisplayAuthorized: false;
    recipeId: string;
    reviewGptRequiredNow: false;
    rowOwnerAssertionsConfirmed: boolean;
    rowParsingPerformedByR1143: false;
    safeAvailabilityConfirmationReadyForRecipeReadinessChain: boolean;
    safeManifestAttestationsComplete: boolean;
    sourceFamiliesDeclaredAvailable: OrdinarySourceFamilyId[];
    sourceFamiliesDeclaredUnavailable: OrdinarySourceFamilyId[];
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first";
  };
}

export async function runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer(
  options: R1143OrdinaryConsumerAvailabilityManifestRecipeMaterializerOptions = {},
): Promise<{
  generatedManifestPath: string | null;
  output: R1143OrdinaryConsumerAvailabilityManifestRecipeMaterializerOutput;
  outputPath: string;
}> {
  const outputDir = options.outputDir ?? DEFAULT_MODEL_RUNS_DIR;
  const requestedRecipeId = options.recipeId?.trim() || DEFAULT_RECIPE_ID;
  const r1135 = await readJsonIfPresent(options.r1135Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1135_EXPECTED.artifact));
  validateInputBoundary("r1135", r1135);
  const r1150 = await readJsonIfPresent(options.r1150Path ?? path.join(DEFAULT_MODEL_RUNS_DIR, R1150_EXPECTED.artifact));
  validateInputBoundary("r1150", r1150);
  const r1135Expected = matchesExpected(r1135, R1135_EXPECTED);
  const r1150Expected = matchesExpected(r1150, R1150_EXPECTED);
  const safeAvailabilityConfirmationReadyForRecipeReadinessChain = r1150Expected
    && readBooleanAt(r1150, ["summary", "readyForRecipeReadinessChain"]) === true;
  const recipes = r1135Expected ? routeRecipesFrom(r1135) : [];
  const selectedRecipe = recipes.find((recipe) => recipe.recipeId === requestedRecipeId) ?? null;
  const rowOwnerAssertionsConfirmed = options.assertionsConfirmed === true
    || safeAvailabilityConfirmationReadyForRecipeReadinessChain;
  const conclusion = conclusionFor({ r1135Expected, rowOwnerAssertionsConfirmed, selectedRecipe });
  const generatedManifest = conclusion === "ordinary_manifest_recipe_materializer_generated_safe_manifest" && selectedRecipe
    ? generatedManifestFromRecipe(selectedRecipe)
    : null;
  const generatedManifestPath = generatedManifest ? path.join(outputDir, GENERATED_MANIFEST_FILE_NAME) : null;
  const output: R1143OrdinaryConsumerAvailabilityManifestRecipeMaterializerOutput = {
    artifactBoundary: safeBoundary(),
    createdAt: options.createdAt ?? new Date().toISOString(),
    inputArtifacts: {
      r1135: summarizeInput(r1135, R1135_EXPECTED),
      r1150: summarizeInput(r1150, R1150_EXPECTED),
    },
    manifestRecipeMaterializer: {
      availableRecipeIds: recipes.map((recipe) => recipe.recipeId),
      availabilityChainWithGeneratedManifestCommand: R1136_CHAIN_WITH_GENERATED_MANIFEST_COMMAND,
      availabilityPreflightWithGeneratedManifestCommand: R1133_PREFLIGHT_WITH_GENERATED_MANIFEST_COMMAND,
      generatedAvailabilityManifestArtifact: generatedManifest ? GENERATED_MANIFEST_FILE_NAME : null,
      generatedAvailabilityManifestSchemaVersion: generatedManifest ? AVAILABILITY_MANIFEST_SCHEMA_VERSION : null,
      generatedManifestWritten: generatedManifest !== null,
      materializerCommand: MATERIALIZER_COMMAND,
      partialPrivateChainRunnerCommand: readStringAt(r1135, ["summary", "partialPrivateChainRunnerCommand"]),
      privateDetailsStored: false,
      requestedRecipeId,
      rowOwnerAssertionChecklist: selectedRecipe
        ? rowOwnerAssertionChecklistFor(selectedRecipe.sourceFamiliesToDeclareAvailable)
        : [],
      rowOwnerAssertionsConfirmed,
      safeAvailabilityConfirmationReadyForRecipeReadinessChain,
      selectedRecipe,
      sourceFamiliesDeclaredAvailable: selectedRecipe?.sourceFamiliesToDeclareAvailable ?? [],
      sourceFamiliesDeclaredUnavailable: selectedRecipe?.sourceFamiliesToDeclareUnavailable ?? [],
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
    packetId: "r1143-ordinary-consumer-availability-manifest-recipe-materializer",
    productDisplayAuthorized: false,
    schemaVersion: R1143_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_RECIPE_MATERIALIZER_SCHEMA_VERSION,
    status: "research-local-aggregate-only",
    summary: {
      conclusion,
      generatedAvailabilityManifestArtifact: generatedManifest ? GENERATED_MANIFEST_FILE_NAME : null,
      generatedManifestWritten: generatedManifest !== null,
      nextAction: nextActionFor(conclusion),
      productDisplayAuthorized: false,
      recipeId: requestedRecipeId,
      reviewGptRequiredNow: false,
      rowOwnerAssertionsConfirmed,
      rowParsingPerformedByR1143: false,
      safeAvailabilityConfirmationReadyForRecipeReadinessChain,
      safeManifestAttestationsComplete: generatedManifest !== null,
      sourceFamiliesDeclaredAvailable: selectedRecipe?.sourceFamiliesToDeclareAvailable ?? [],
      sourceFamiliesDeclaredUnavailable: selectedRecipe?.sourceFamiliesToDeclareUnavailable ?? [],
      targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
    },
  };

  const findings = [
    ...findForbiddenAggregateEgress(output),
    ...(generatedManifest ? findForbiddenAggregateEgress(generatedManifest) : []),
  ];
  if (findings.length > 0) {
    throw new Error(`R1143 ordinary consumer manifest recipe materializer failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }

  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, OUTPUT_FILE_NAME);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  if (generatedManifest && generatedManifestPath) {
    await writeFile(generatedManifestPath, `${JSON.stringify(generatedManifest, null, 2)}\n`);
  }
  return { generatedManifestPath, output, outputPath };
}

async function readJsonIfPresent(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function validateInputBoundary(name: string, value: unknown | null): void {
  if (!value) return;
  const findings = findForbiddenAggregateEgress(value);
  if (findings.length > 0) {
    throw new Error(`R1143 input ${name} failed aggregate-egress validation: ${formatFindingCount(findings)}`);
  }
}

function matchesExpected(value: unknown | null, expected: { packetId: string; schemaVersion: string }): boolean {
  return readStringAt(value, ["packetId"]) === expected.packetId
    && readStringAt(value, ["schemaVersion"]) === expected.schemaVersion;
}

function routeRecipesFrom(r1135: unknown | null): RouteRecipe[] {
  return readObjectArrayAt(r1135, ["availabilityManifestPacket", "partialRouteManifestRecipes"])
    .flatMap((recipe): RouteRecipe[] => {
      const recipeId = readStringAt(recipe, ["recipeId"]);
      const recipeRouteGroupId = readStringAt(recipe, ["recipeRouteGroupId"]);
      if (!recipeId || !recipeRouteGroupId) return [];
      return [{
        expectedEligiblePartialRouteIds: readStringArrayAt(recipe, ["expectedEligiblePartialRouteIds"]),
        expectedFullSupportedRouteId: readStringAt(recipe, ["expectedFullSupportedRouteId"]),
        expectedFullSupportedRouteReady: readBooleanAt(recipe, ["expectedFullSupportedRouteReady"]) === true,
        recipeId,
        recipeRouteGroupId,
        routeKind: readStringAt(recipe, ["routeKind"]) ?? "ordinary_consumer_manifest_route",
        routeUse: readStringAt(recipe, ["routeUse"]) ?? "ordinary consumer labs and wearable manifest route",
        sourceFamiliesToDeclareAvailable: readOrdinarySourceFamilyArrayAt(recipe, ["sourceFamiliesToDeclareAvailable"]),
        sourceFamiliesToDeclareUnavailable: readOrdinarySourceFamilyArrayAt(recipe, ["sourceFamiliesToDeclareUnavailable"]),
      }];
    });
}

function generatedManifestFromRecipe(recipe: RouteRecipe): GeneratedAvailabilityManifest {
  const available = new Set(recipe.sourceFamiliesToDeclareAvailable);
  return {
    aggregateReadinessFacts: {
      eventCountBand: "10_plus",
      outcomeLinked: true,
      sameDenominator: true,
      targetAgeBand: "roughly_16_50",
      usableRecordCountBand: "50_plus",
    },
    attestations: REQUIRED_SAFE_MANIFEST_ATTESTATIONS.reduce(
      (result, attestationId) => ({ ...result, [attestationId]: true }),
      {} as Record<RequiredSafeManifestAttestation, true>,
    ),
    blockedManifestContent: [...BLOCKED_MANIFEST_CONTENT],
    recipeMaterialization: {
      expectedEligiblePartialRouteIds: [...recipe.expectedEligiblePartialRouteIds],
      expectedFullSupportedRouteId: recipe.expectedFullSupportedRouteId,
      expectedFullSupportedRouteReady: recipe.expectedFullSupportedRouteReady,
      generatedBy: "r1143-ordinary-consumer-availability-manifest-recipe-materializer",
      productDisplayAuthorized: false,
      recipeId: recipe.recipeId,
      recipeRouteGroupId: recipe.recipeRouteGroupId,
      rowOwnerAssertionsConfirmed: true,
    },
    schemaVersion: AVAILABILITY_MANIFEST_SCHEMA_VERSION,
    selectedTableLayout: "single_primary_table_fallback",
    sourceFamilies: ORDINARY_SOURCE_FAMILY_IDS.map((familyId) => ({
      available: available.has(familyId),
      familyId,
    })),
    targetInputPriority: "consumer_bloodwork_labs_wearables_16_50_first",
  };
}

function rowOwnerAssertionChecklistFor(
  sourceFamiliesToDeclareAvailable: readonly OrdinarySourceFamilyId[],
): RowOwnerAssertionChecklistItem[] {
  return sourceFamiliesToDeclareAvailable.map((familyId) => ({
    assertionId: `actual_source_family_available:${familyId}`,
    familyId,
    requiredStatus: "confirmed_available_for_this_recipe_before_generation",
  }));
}

function conclusionFor(input: {
  r1135Expected: boolean;
  rowOwnerAssertionsConfirmed: boolean;
  selectedRecipe: RouteRecipe | null;
}): MaterializerConclusion {
  if (!input.r1135Expected) return "ordinary_manifest_recipe_materializer_waiting_on_r1135";
  if (!input.selectedRecipe) return "ordinary_manifest_recipe_materializer_recipe_not_found";
  if (!input.rowOwnerAssertionsConfirmed) {
    return "ordinary_manifest_recipe_materializer_waiting_on_row_owner_confirmation";
  }
  return "ordinary_manifest_recipe_materializer_generated_safe_manifest";
}

function nextActionFor(conclusion: MaterializerConclusion): MaterializerNextAction {
  if (conclusion === "ordinary_manifest_recipe_materializer_waiting_on_r1135") return "refresh_r1135_manifest_packet";
  if (conclusion === "ordinary_manifest_recipe_materializer_recipe_not_found") return "choose_supported_manifest_recipe_id";
  if (conclusion === "ordinary_manifest_recipe_materializer_waiting_on_row_owner_confirmation") {
    return "confirm_recipe_availability_assertions_before_generating_manifest";
  }
  return "run_r1133_with_generated_safe_manifest_then_r1136_or_r1142";
}

function summarizeInput(
  value: unknown | null,
  expected: { artifact: string; packetId: string; schemaVersion: string },
): ArtifactSummary {
  return {
    artifact: expected.artifact,
    packetId: readStringAt(value, ["packetId"]),
    schemaVersion: readStringAt(value, ["schemaVersion"]),
    status: matchesExpected(value, expected) ? "available" : "missing",
  };
}

function safeBoundary(): R1143OrdinaryConsumerAvailabilityManifestRecipeMaterializerOutput["artifactBoundary"] {
  return {
    aggregateOnly: true,
    availabilityManifestPathStored: false,
    codebookTextStored: false,
    coefficientsStored: false,
    fileNamesStored: false,
    headerValuesStored: false,
    localPathsStored: false,
    modelParametersStored: false,
    outcomeScoringPerformedByR1143: false,
    participantIdentifiersStored: false,
    participantIdentifiersWritten: false,
    predictionsStored: false,
    privateConfigValuesStored: false,
    privateFieldRefsStored: false,
    privateTableRefsStored: false,
    productClaimsIncluded: false,
    productDisplayAuthorized: false,
    productPromotionAuthorized: false,
    recommendationClaimsIncluded: false,
    rowParsingPerformedByR1143: false,
    rowValuesStored: false,
    smallCellsStored: false,
    sourceBodiesStored: false,
    sourceFileNamesStored: false,
    sourceVariableNamesStored: false,
    splitMembershipStored: false,
  };
}

function readOrdinarySourceFamilyArrayAt(value: unknown | null, pathParts: readonly string[]): OrdinarySourceFamilyId[] {
  return readStringArrayAt(value, pathParts).filter(isOrdinarySourceFamilyId);
}

function isOrdinarySourceFamilyId(value: string): value is OrdinarySourceFamilyId {
  return ORDINARY_SOURCE_FAMILY_IDS.includes(value as OrdinarySourceFamilyId);
}

function readBooleanAt(value: unknown | null, pathParts: readonly string[]): boolean | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "boolean" ? resolved : null;
}

function readStringAt(value: unknown | null, pathParts: readonly string[]): string | null {
  const resolved = readAt(value, pathParts);
  return typeof resolved === "string" ? resolved : null;
}

function readStringArrayAt(value: unknown | null, pathParts: readonly string[]): string[] {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved) ? resolved.filter((item): item is string => typeof item === "string") : [];
}

function readObjectArrayAt(value: unknown | null, pathParts: readonly string[]): Array<Record<string, unknown>> {
  const resolved = readAt(value, pathParts);
  return Array.isArray(resolved)
    ? resolved.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function readAt(value: unknown | null, pathParts: readonly string[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function formatFindingCount(findings: readonly string[]): string {
  return `${findings.length} forbidden aggregate egress finding(s)`;
}

async function main(): Promise<void> {
  const { output } = await runR1143OrdinaryConsumerAvailabilityManifestRecipeMaterializer({
    assertionsConfirmed: process.env.MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ASSERTIONS_CONFIRMED === "true",
    outputDir: process.env.MURPH_AGE_RESEARCH_OUTPUT_DIR,
    r1135Path: process.env.MURPH_AGE_R1135_ORDINARY_CONSUMER_AVAILABILITY_MANIFEST_PACKET_PATH,
    r1150Path: process.env.MURPH_AGE_R1150_ORDINARY_CONSUMER_SAFE_AVAILABILITY_CONFIRMATION_INTAKE_PATH,
    recipeId: process.env.MURPH_AGE_ORDINARY_CONSUMER_MANIFEST_RECIPE_ID,
  });
  process.stdout.write(`${JSON.stringify({
    conclusion: output.summary.conclusion,
    generatedAvailabilityManifestArtifact: output.summary.generatedAvailabilityManifestArtifact,
    generatedManifestWritten: output.summary.generatedManifestWritten,
    nextAction: output.summary.nextAction,
    packetId: output.packetId,
    productDisplayAuthorized: output.productDisplayAuthorized,
    recipeId: output.summary.recipeId,
    reviewGptRequiredNow: output.summary.reviewGptRequiredNow,
    rowOwnerAssertionsConfirmed: output.summary.rowOwnerAssertionsConfirmed,
    safeAvailabilityConfirmationReadyForRecipeReadinessChain:
      output.summary.safeAvailabilityConfirmationReadyForRecipeReadinessChain,
    safeManifestAttestationsComplete: output.summary.safeManifestAttestationsComplete,
    schemaVersion: output.schemaVersion,
    sourceFamiliesDeclaredAvailable: output.summary.sourceFamiliesDeclaredAvailable,
    sourceFamiliesDeclaredUnavailable: output.summary.sourceFamiliesDeclaredUnavailable,
    status: output.status,
  }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeCliErrorMessage(error, "R1143 manifest recipe materializer failed.")}\n`);
    process.exitCode = 1;
  });
}

function safeCliErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  return /(?:\/|\\)/u.test(error.message) ? fallback : error.message;
}
