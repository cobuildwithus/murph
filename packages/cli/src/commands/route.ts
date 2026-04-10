import { Cli, z } from 'incur'
import {
  estimateMapboxRoute,
  mapboxRouteEstimateResultSchema,
  mapboxRouteProfileSchema,
} from '../mapbox-route.js'

const isoCountryCodeSchema = z.string().regex(/^[A-Za-z]{2}$/u)

export function registerRouteCommands(cli: Cli.Cli) {
  const route = Cli.create('route', {
    description:
      'Estimate route distance, duration, and optional approximate elevation through temporary Mapbox lookups without persisting route data in Murph state.',
  })

  route.command('estimate', {
    description:
      'Estimate one route between two points. Accept addresses, place names, hiking POIs such as trailheads or huts, and lon,lat coordinate literals.',
    args: z.object({
      origin: z
        .string()
        .min(1)
        .describe('Origin as plain text or a lon,lat literal such as 144.9631,-37.8136.'),
      destination: z
        .string()
        .min(1)
        .describe('Destination as plain text or a lon,lat literal such as 144.9780,-37.8640.'),
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
        .describe('Optional ISO 3166-1 alpha-2 country hints for geocoding. Repeat --country to add more than one.'),
      language: z
        .string()
        .min(1)
        .max(10)
        .optional()
        .describe('Optional language hint for geocoding display names.'),
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
      'Set MAPBOX_ACCESS_TOKEN in the runtime environment before using this command. Route geometry is omitted by default, elevation is approximate when enabled, and text lookups stay temporary.',
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
