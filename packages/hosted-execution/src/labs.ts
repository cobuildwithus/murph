import { z } from "zod";

export const HOSTED_RUNTIME_LABS_OFFERING_KINDS = [
  "panel",
  "biomarker",
] as const;

export const HOSTED_RUNTIME_LABS_SEARCH_KINDS = [
  "all",
  ...HOSTED_RUNTIME_LABS_OFFERING_KINDS,
] as const;

export const HOSTED_RUNTIME_LABS_RADIUS_MILES = [10, 20, 25, 50] as const;

const boundedText = (maximumLength: number) =>
  z.string().trim().min(1).max(maximumLength);

const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

const nonnegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

const hostedRuntimeLabsRadiusMilesSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(25),
  z.literal(50),
]);

const hostedRuntimeLabsSearchRequestSchema = z
  .object({
    action: z.literal("search"),
    query: z.string().trim().min(2).max(120),
    kind: z.enum(HOSTED_RUNTIME_LABS_SEARCH_KINDS).optional(),
    page: z.number().int().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const hostedRuntimeLabsShowRequestSchema = z
  .object({
    action: z.literal("show"),
    labId: positiveIntegerSchema,
    providerId: boundedText(120),
  })
  .strict();

const hostedRuntimeLabsLocationsRequestSchema = z
  .object({
    action: z.literal("locations"),
    zipCode: z.string().regex(/^\d{5}$/u),
    labId: positiveIntegerSchema.optional(),
    radiusMiles: hostedRuntimeLabsRadiusMilesSchema.optional(),
    limit: z.number().int().min(1).max(10).optional(),
  })
  .strict();

export const hostedRuntimeLabsToolRequestSchema = z.discriminatedUnion(
  "action",
  [
    hostedRuntimeLabsSearchRequestSchema,
    hostedRuntimeLabsShowRequestSchema,
    hostedRuntimeLabsLocationsRequestSchema,
  ],
);

const hostedRuntimeLabsCatalogPriceSchema = z
  .object({
    amount: z.string().max(32).regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/u),
    currency: z.literal("USD"),
  })
  .strict();

const hostedRuntimeLabsIncludedMarkerSchema = z
  .object({
    name: boundedText(240),
    slug: boundedText(180).nullable(),
  })
  .strict();

export const hostedRuntimeLabsOfferingSchema = z
  .object({
    offeringId: boundedText(256),
    labId: positiveIntegerSchema,
    providerId: boundedText(120),
    name: boundedText(240),
    kind: z.enum(HOSTED_RUNTIME_LABS_OFFERING_KINDS),
    description: boundedText(8_000).nullable(),
    slug: boundedText(180).nullable(),
    unit: boundedText(120).nullable(),
    catalogPrice: hostedRuntimeLabsCatalogPriceSchema.nullable(),
    commonTurnaroundDays: nonnegativeIntegerSchema.nullable(),
    maximumTurnaroundDays: nonnegativeIntegerSchema.nullable(),
    includedMarkers: z.array(hostedRuntimeLabsIncludedMarkerSchema).max(40),
    includedMarkerCount: nonnegativeIntegerSchema,
  })
  .strict()
  .superRefine((offering, context) => {
    if (offering.includedMarkerCount < offering.includedMarkers.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Included marker count cannot be smaller than the returned marker list.",
        path: ["includedMarkerCount"],
      });
    }
  });

const hostedRuntimeLabsAddressSchema = z
  .object({
    line1: boundedText(240),
    line2: boundedText(240).nullable(),
    city: boundedText(120),
    state: z.string().regex(/^[A-Z]{2}$/u),
    postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/u),
  })
  .strict();

const hostedRuntimeLabsCoordinatesSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

export const hostedRuntimeLabsLocationSchema = z
  .object({
    labId: positiveIntegerSchema,
    labSlug: boundedText(180).nullable(),
    siteCode: boundedText(120),
    name: boundedText(240),
    address: hostedRuntimeLabsAddressSchema,
    distanceMiles: z.number().finite().nonnegative().max(1_000),
    coordinates: hostedRuntimeLabsCoordinatesSchema.nullable(),
    phoneNumber: boundedText(40).nullable(),
    capabilities: z.array(boundedText(120)).max(20),
  })
  .strict();

const hostedRuntimeLabsResponseBase = {
  checkedAt: z.string().datetime({ offset: true }),
  orderingStatus: z.literal("discovery_only"),
  orderableThroughMurph: z.literal(false),
} as const;

const hostedRuntimeLabsSearchResponseSchema = z
  .object({
    action: z.literal("search"),
    ...hostedRuntimeLabsResponseBase,
    items: z.array(hostedRuntimeLabsOfferingSchema).max(20),
    provider: z
      .object({
        page: positiveIntegerSchema,
        pages: nonnegativeIntegerSchema.nullable(),
        total: nonnegativeIntegerSchema.nullable(),
      })
      .strict(),
  })
  .strict();

const hostedRuntimeLabsShowResponseSchema = z
  .object({
    action: z.literal("show"),
    ...hostedRuntimeLabsResponseBase,
    offering: hostedRuntimeLabsOfferingSchema,
  })
  .strict();

const hostedRuntimeLabsLocationsResponseSchema = z
  .object({
    action: z.literal("locations"),
    ...hostedRuntimeLabsResponseBase,
    status: z.enum(["available", "not_served"]),
    zipCode: z.string().regex(/^\d{5}$/u),
    radiusMiles: hostedRuntimeLabsRadiusMilesSchema,
    homeCollectionAvailable: z.boolean(),
    locations: z.array(hostedRuntimeLabsLocationSchema).max(10),
  })
  .strict()
  .superRefine((response, context) => {
    if (
      response.status === "not_served"
      && (response.homeCollectionAvailable || response.locations.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A not-served response cannot include an available collection option.",
        path: ["status"],
      });
    }
  });

export const hostedRuntimeLabsToolResponseSchema = z.discriminatedUnion(
  "action",
  [
    hostedRuntimeLabsSearchResponseSchema,
    hostedRuntimeLabsShowResponseSchema,
    hostedRuntimeLabsLocationsResponseSchema,
  ],
);

export type HostedRuntimeLabsToolRequest = z.infer<
  typeof hostedRuntimeLabsToolRequestSchema
>;
export type HostedRuntimeLabsSearchRequest = z.infer<
  typeof hostedRuntimeLabsSearchRequestSchema
>;
export type HostedRuntimeLabsShowRequest = z.infer<
  typeof hostedRuntimeLabsShowRequestSchema
>;
export type HostedRuntimeLabsLocationsRequest = z.infer<
  typeof hostedRuntimeLabsLocationsRequestSchema
>;
export type HostedRuntimeLabsOffering = z.infer<
  typeof hostedRuntimeLabsOfferingSchema
>;
export type HostedRuntimeLabsLocation = z.infer<
  typeof hostedRuntimeLabsLocationSchema
>;
export type HostedRuntimeLabsToolResponse = z.infer<
  typeof hostedRuntimeLabsToolResponseSchema
>;
export type HostedRuntimeLabsSearchResponse = z.infer<
  typeof hostedRuntimeLabsSearchResponseSchema
>;
export type HostedRuntimeLabsShowResponse = z.infer<
  typeof hostedRuntimeLabsShowResponseSchema
>;
export type HostedRuntimeLabsLocationsResponse = z.infer<
  typeof hostedRuntimeLabsLocationsResponseSchema
>;

export function parseHostedRuntimeLabsToolRequest(
  value: unknown,
): HostedRuntimeLabsToolRequest {
  const parsed = hostedRuntimeLabsToolRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("Hosted Labs tool request is invalid.");
  }
  return parsed.data;
}

export function parseHostedRuntimeLabsToolResponse(
  value: unknown,
): HostedRuntimeLabsToolResponse {
  const parsed = hostedRuntimeLabsToolResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError("Hosted Labs tool response is invalid.");
  }
  return parsed.data;
}
