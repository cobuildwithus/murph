import { Cli, z } from 'incur'
import {
  exerciseCatalogCommonnessValues,
  exerciseCatalogEnvironmentValues,
  exerciseCatalogKindValues,
  exerciseCatalogLevelValues,
  getGeneratedExerciseCatalogReader,
} from '@murphai/exercise-library/runtime'
import { emptyArgsSchema } from '@murphai/operator-config/command-helpers'
import {
  exerciseFacetsResultSchema,
  exerciseListResultSchema,
  exerciseShowResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'

const exerciseKindOptions = z.enum(exerciseCatalogKindValues)
const exerciseEnvironmentOptions = z.enum(exerciseCatalogEnvironmentValues)
const exerciseLevelOptions = z.enum(exerciseCatalogLevelValues)
const exerciseCommonnessOptions = z.enum(exerciseCatalogCommonnessValues)

export function registerExerciseCommands(cli: Cli.Cli) {
  const exercise = Cli.create('exercise', {
    description: 'Read-only public exercise, stretch, and mobility reference catalog.',
  })

  exercise.command('list', {
    description: 'List public catalog movements with optional search and filter fields.',
    args: emptyArgsSchema,
    options: z.object({
      query: z.string().min(1).optional().describe('Optional text search over movement names, targets, categories, modality, and description.'),
      kind: z.array(exerciseKindOptions).optional().describe('Optional movement kind filter. Repeat --kind for multiple values.'),
      environment: z.array(exerciseEnvironmentOptions).optional().describe('Optional environment filter. Repeat --environment for multiple values.'),
      category: z.array(z.string().min(1)).optional().describe('Optional category filter. Repeat --category for multiple values.'),
      target: z.array(z.string().min(1)).optional().describe('Optional target-area filter. Repeat --target for multiple values.'),
      level: z.array(exerciseLevelOptions).optional().describe('Optional level filter. Repeat --level for multiple values.'),
      equipment: z.array(z.string().min(1)).optional().describe('Optional equipment filter. Use none for no-equipment movements. Repeat --equipment for multiple values.'),
      position: z.array(z.string().min(1)).optional().describe('Optional position filter. Repeat --position for multiple values.'),
      modality: z.array(z.string().min(1)).optional().describe('Optional modality filter. Repeat --modality for multiple values.'),
      commonness: z.array(exerciseCommonnessOptions).optional().describe('Optional commonness filter. Repeat --commonness for multiple values.'),
      limit: z.number().int().positive().max(500).default(10).describe('Maximum number of catalog items to return.'),
    }),
    examples: [
      {
        description: 'Find beginner bodyweight squat movements.',
        options: {
          query: 'squat',
          kind: ['exercise'],
          equipment: ['none'],
          level: ['beginner'],
          limit: 10,
        },
      },
      {
        description: 'Find hip stretches.',
        options: {
          kind: ['stretch'],
          target: ['hips'],
        },
      },
    ],
    output: exerciseListResultSchema,
    async run({ options }) {
      const reader = getGeneratedExerciseCatalogReader()
      const listOptions = {
        category: options.category,
        commonness: options.commonness,
        environment: options.environment,
        equipment: options.equipment,
        kind: options.kind,
        level: options.level,
        limit: options.limit,
        modality: options.modality,
        position: options.position,
        query: options.query,
        target: options.target,
      }
      const filters = reader.normalizeListOptions(listOptions)
      const result = reader.listExercises(listOptions)

      return {
        catalogHash: reader.catalogHash,
        filters,
        total: result.total,
        items: result.items,
      }
    },
  })

  exercise.command('show', {
    description: 'Show one public catalog movement by id, slug, or exact name.',
    args: z.object({
      lookup: z.string().min(1).describe('Exercise catalog id, slug, or exact name.'),
    }),
    options: z.object({}),
    examples: [
      {
        description: 'Show the bodyweight squat movement.',
        args: {
          lookup: 'bodyweight-squat',
        },
      },
      {
        description: 'Show by stable catalog id.',
        args: {
          lookup: 'EX001',
        },
      },
    ],
    output: exerciseShowResultSchema,
    async run({ args }) {
      const reader = getGeneratedExerciseCatalogReader()
      const result = reader.findByLookup(args.lookup)

      if (result.kind === 'not_found') {
        throw new VaultCliError(
          'exercise_not_found',
          `No public exercise catalog item matched "${args.lookup}".`,
        )
      }

      if (result.kind === 'ambiguous') {
        throw new VaultCliError(
          'exercise_lookup_ambiguous',
          `Exercise catalog lookup "${args.lookup}" is ambiguous. Use one of these ids or slugs: ${result.matches.map((item) => `${item.id}/${item.slug}`).join(', ')}.`,
        )
      }

      return {
        catalogHash: reader.catalogHash,
        lookup: args.lookup,
        item: result.item,
        sources: reader.sourcesForItem(result.item),
      }
    },
  })

  exercise.command('facets', {
    description: 'List available public exercise catalog filters.',
    args: emptyArgsSchema,
    options: z.object({}),
    output: exerciseFacetsResultSchema,
    async run() {
      const reader = getGeneratedExerciseCatalogReader()
      return {
        catalogHash: reader.catalogHash,
        facets: reader.facets(),
      }
    },
  })

  cli.command(exercise)
}
