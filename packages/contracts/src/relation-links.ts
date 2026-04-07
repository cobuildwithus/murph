import * as z from "zod";

import { ID_PREFIXES } from "./constants.ts";
import { GENERIC_CONTRACT_ID_PATTERN, idPattern } from "./ids.ts";

interface RelationLinkSpec {
  type: string;
  targetPattern: string;
}

function patternedString(pattern: string): z.ZodString {
  return z.string().regex(new RegExp(pattern, "u"));
}

function buildRelationLinkObjectSchema(
  spec: RelationLinkSpec,
): z.ZodType<{ type: string; targetId: string }> {
  return z
    .object({
      type: z.literal(spec.type),
      targetId: patternedString(spec.targetPattern),
    })
    .strict();
}

function createRelationLinkSchema(
  specs: readonly [RelationLinkSpec, ...RelationLinkSpec[]],
): z.ZodType<{ type: string; targetId: string }> {
  const schemas = specs.map((spec) => buildRelationLinkObjectSchema(spec));

  if (schemas.length === 1) {
    return schemas[0];
  }

  return z.union(
    schemas as [
      z.ZodType<{ type: string; targetId: string }>,
      z.ZodType<{ type: string; targetId: string }>,
      ...z.ZodType<{ type: string; targetId: string }>[],
    ],
  ) as z.ZodType<{ type: string; targetId: string }>;
}

const goalIdPattern = idPattern(ID_PREFIXES.goal);
const conditionIdPattern = idPattern(ID_PREFIXES.condition);
const protocolIdPattern = idPattern(ID_PREFIXES.protocol);
const experimentIdPattern = idPattern(ID_PREFIXES.experiment);
const variantIdPattern = idPattern(ID_PREFIXES.variant);
const familyMemberIdPattern = idPattern(ID_PREFIXES.family);

export const CANONICAL_RELATION_LINK_TYPES = [
  "parent_of",
  "related_to",
  "supports_goal",
  "addresses_condition",
  "source_assessment",
  "source_event",
  "source_family_member",
  "top_goal",
  "snapshot_of",
] as const;

export type CanonicalRelationLinkType = (typeof CANONICAL_RELATION_LINK_TYPES)[number];

export const foodRelationLinkSchema = createRelationLinkSchema([
  {
    type: "related_protocol",
    targetPattern: protocolIdPattern,
  },
]);

export const recipeRelationLinkSchema = createRelationLinkSchema([
  {
    type: "supports_goal",
    targetPattern: goalIdPattern,
  },
  {
    type: "addresses_condition",
    targetPattern: conditionIdPattern,
  },
]);

export const goalRelationLinkSchema = createRelationLinkSchema([
  {
    type: "parent_goal",
    targetPattern: goalIdPattern,
  },
  {
    type: "related_goal",
    targetPattern: goalIdPattern,
  },
  {
    type: "related_experiment",
    targetPattern: experimentIdPattern,
  },
]);

export const conditionRelationLinkSchema = createRelationLinkSchema([
  {
    type: "related_goal",
    targetPattern: goalIdPattern,
  },
  {
    type: "related_protocol",
    targetPattern: protocolIdPattern,
  },
]);

export const allergyRelationLinkSchema = createRelationLinkSchema([
  {
    type: "related_condition",
    targetPattern: conditionIdPattern,
  },
]);

export const protocolRelationLinkSchema = createRelationLinkSchema([
  {
    type: "supports_goal",
    targetPattern: goalIdPattern,
  },
  {
    type: "addresses_condition",
    targetPattern: conditionIdPattern,
  },
  {
    type: "related_protocol",
    targetPattern: protocolIdPattern,
  },
]);

export const familyRelationLinkSchema = createRelationLinkSchema([
  {
    type: "related_variant",
    targetPattern: variantIdPattern,
  },
]);

export const geneticVariantRelationLinkSchema = createRelationLinkSchema([
  {
    type: "source_family_member",
    targetPattern: familyMemberIdPattern,
  },
]);

export const eventRelationLinkSchema = createRelationLinkSchema([
  {
    type: CANONICAL_RELATION_LINK_TYPES[0],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[1],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[2],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[3],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[4],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[5],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[6],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[7],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
  {
    type: CANONICAL_RELATION_LINK_TYPES[8],
    targetPattern: GENERIC_CONTRACT_ID_PATTERN,
  },
]);
