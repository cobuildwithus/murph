import { Cli, z } from 'incur'
import {
  mapboxAddressResolveResultSchema,
  resolveMapboxAddress,
} from '../mapbox-address.js'
import {
  estimateMapboxRoute,
  mapboxRouteEstimateResultSchema,
  mapboxRouteProfileSchema,
} from '../mapbox-route.js'

const isoCountryCodeSchema = z.string().regex(/^[A-Za-z]{2}$/u)

export function registerRouteCommands(cli: Cli.Cli) {
  const route = Cli.create('route', {
    description:
      'Resolve addresses or estimate route distance, duration, and optional approximate elevation through temporary Mapbox lookups without persisting location data in Murph state.',
  })

  route.command('resolve-address', {
    description:
      'Resolve a partial or complete mailing address into bounded structured candidates through temporary Mapbox geocoding without persisting the lookup in Murph state.',
    args: z.object({
      query: z
        .string()
        .min(1)
        .max(256)
        .describe('Partial or complete mailing address supplied for the current task.'),
    }),
    options: z.object({
      country: z
        .array(isoCountryCodeSchema)
        .max(10)
        .optional()
        .describe(
          'Optional ISO 3166-1 alpha-2 country restriction. Repeat --country to add more than one.',
        ),
      language: z
        .string()
        .min(1)
        .max(10)
        .optional()
        .describe('Optional language hint for provider display names.'),
    }),
    examples: [
      {
        description: 'Complete a US street address before mailing something.',
        args: {
          query: '42 Example Lane',
        },
        options: {
          country: ['US'],
        },
      },
    ],
    hint:
      'Set MAPBOX_ACCESS_TOKEN first. Use recommendedCandidate only when it is non-null; otherwise ask for the unresolved delivery-critical detail. The lookup is temporary, does not identify the recipient, and does not grant permission to mail anything.',
    output: mapboxAddressResolveResultSchema,
    async run({ args, options }) {
      return await resolveMapboxAddress({
        query: args.query,
        country: options.country,
        language: options.language,
      })
    },
  })

  route.command('estimate', {
    description:
      'Estimate one route between two points. Accept addresses, place names, hiking POIs such as trailheads or huts, and lon,lat coordinate literals. More specific text can improve geocoding, but provider display labels may still stay broad.',
    args: z.object({
      origin: z
        .string()
        .min(1)
        .describe(
          'Origin as plain text or a lon,lat literal such as 144.9631,-37.8136; for more precise text matches, include suburb/state/postcode, or use coordinates when you need the routed point pinned exactly.',
        ),
      destination: z
        .string()
        .min(1)
        .describe(
          'Destination as plain text or a lon,lat literal such as 144.9780,-37.8640; for more precise text matches, include suburb/state/postcode, or use coordinates when you need the routed point pinned exactly.',
        ),
    }),
    options: z.object({
      waypoint: z
        .array(z.string().min(1))
        .max(23)
        .optional()
        .describe('Optional intermediate stops. Repeat --waypoint to add more than one.'),
      profile: mapboxRouteProfileSchema
        .optional()
        .describe('Routing profile. Use walking for hikes, runs, and on-foot trail estimates.'),
      elevation: z
        .boolean()
        .optional()
        .describe('Include an approximate elevation summary from bounded terrain contour samples.'),
      geometry: z
        .boolean()
        .optional()
        .describe('Include the routed GeoJSON LineString in the response.'),
      country: z
        .array(isoCountryCodeSchema)
        .max(10)
        .optional()
        .describe(
          'Optional ISO 3166-1 alpha-2 country hints for geocoding when plain-text places are ambiguous. Repeat --country to add more than one.',
        ),
      language: z
        .string()
        .min(1)
        .max(10)
        .optional()
        .describe('Optional language hint for provider geocoding display names.'),
      elevationSampleSpacingMeters: z
        .number()
        .positive()
        .max(10_000)
        .optional()
        .describe('Approximate spacing between elevation samples when --elevation is set.'),
      maxElevationSamples: z
        .number()
        .int()
        .positive()
        .max(24)
        .optional()
        .describe('Maximum number of elevation sample points when --elevation is set.'),
    }),
    examples: [
      {
        description: 'Estimate a run from an address to a beach.',
        args: {
          origin: '123 Example St, Melbourne VIC',
          destination: 'St Kilda Beach',
        },
        options: {
          profile: 'walking',
        },
      },
      {
        description: 'Estimate a hike with an approximate elevation summary.',
        args: {
          origin: 'Mount Buffalo Chalet',
          destination: 'The Horn, Mount Buffalo National Park',
        },
        options: {
          profile: 'walking',
          elevation: true,
        },
      },
      {
        description: 'Estimate a cycling route directly from coordinate literals.',
        args: {
          origin: '144.9631,-37.8136',
          destination: '144.9780,-37.8640',
        },
        options: {
          profile: 'cycling',
        },
      },
    ],
    hint:
      'Set MAPBOX_ACCESS_TOKEN in the runtime environment before using this command. Route geometry is omitted by default, elevation is approximate when enabled, and text lookups stay temporary. More specific text or coordinates can improve point matching, but provider labels may still be broader than the routed point.',
    output: mapboxRouteEstimateResultSchema,
    async run({ args, options }) {
      return await estimateMapboxRoute({
        origin: args.origin,
        destination: args.destination,
        waypoints: options.waypoint,
        profile: options.profile,
        includeElevation: options.elevation,
        includeGeometry: options.geometry,
        country: options.country,
        language: options.language,
        elevationSampleSpacingMeters: options.elevationSampleSpacingMeters,
        maxElevationSamples: options.maxElevationSamples,
      })
    },
  })

  cli.command(route)
}
