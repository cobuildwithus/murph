import { Cli, z } from 'incur'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
} from '@murphai/vault-usecases'
import {
  fetchExaResearchScoutCandidates,
  researchScoutProfileSchema,
  researchScoutResultSchema,
} from '../research-scout.js'

const researchScoutIsoTimestampSchema = z.string().datetime()

export function registerResearchCommands(cli: Cli.Cli) {
  const research = Cli.create('research', {
    description:
      'Run bounded external research-provider lookups without persisting vault data.',
  })

  research.command('scout', {
    description:
      'Search Exa for bounded recent health research candidates from a compact non-identifying profile without writing vault records.',
    args: z.object({}),
    options: z.object({
      input: inputFileOptionSchema.describe(
        'Compact tag-profile JSON in @file.json form or - for stdin. Do not include raw labs, names, dates of birth, full notes, or medical records.',
      ),
      since: researchScoutIsoTimestampSchema.describe(
        'Inclusive lower publication date bound as an ISO timestamp.',
      ),
      until: researchScoutIsoTimestampSchema.describe(
        'Inclusive upper publication date bound as an ISO timestamp.',
      ),
      maxCandidates: z
        .number()
        .int()
        .min(1)
        .max(12)
        .default(12)
        .describe('Maximum research candidates to request and return.'),
    }),
    examples: [
      {
        description: 'Search for recent research candidates from a compact profile.',
        options: {
          input: '@research-profile.json',
          since: '2026-04-18T00:00:00.000Z',
          until: '2026-06-17T00:00:00.000Z',
          maxCandidates: 12,
        },
      },
    ],
    hint:
      'Requires EXA_API_KEY. Pass a compact tag profile only; do not include raw labs, names, dates of birth, full notes, or medical records. The tool returns candidates; local vault relevance and final medical framing remain the assistant job.',
    output: researchScoutResultSchema,
    async run({ options }) {
      const rawProfile = await loadJsonInputObject(
        options.input,
        'research scout profile',
      )
      const profile = researchScoutProfileSchema.parse(rawProfile)

      return await fetchExaResearchScoutCandidates({
        profile,
        since: options.since,
        until: options.until,
        maxCandidates: options.maxCandidates,
      })
    },
  })

  cli.command(research)
}
