import { RECIPE_STATUSES } from '@murphai/contracts'
import { Cli, z } from 'incur'

import {
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/assistant-engine/vault-services'
import {
  deleteRecipeRecord,
  editRecipeRecord,
} from '@murphai/assistant-engine/usecases/recipe'
import { registerRegistryDocEntityGroup } from './health-command-factory.js'
import {
  createEntityDeleteCommandConfig,
  createEntityEditCommandConfig,
} from './record-mutation-command-helpers.js'

const recipeStatusSchema = z.enum(RECIPE_STATUSES)

const recipeScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('recipe'),
  payload: z.record(z.string(), z.unknown()),
})

const recipeUpsertResultSchema = z.object({
  vault: pathSchema,
  recipeId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
})

const recipeListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: z.string().nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export function registerRecipeCommands(cli: Cli.Cli, services: VaultServices) {
  registerRegistryDocEntityGroup(cli, {
    commandName: 'recipe',
    description: 'Recipe registry commands for bank/recipes Markdown records.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit a recipe payload template for `recipe upsert`.',
      output: recipeScaffoldResultSchema,
      async run({ options, requestId }) {
        return services.core.scaffoldRecipe({
          vault: String(options.vault ?? ''),
          requestId,
        })
      },
    },
    upsert: {
      description: 'Create or update one recipe Markdown record from a JSON payload file or stdin.',
      output: recipeUpsertResultSchema,
      async run(input) {
        return services.core.upsertRecipe({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one recipe by canonical id or slug.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Recipe id or slug to show.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showRecipe({
          lookup: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List recipe records with an optional status filter.',
      output: recipeListResultSchema,
      statusOption: recipeStatusSchema.optional(),
      async run(input) {
        return services.query.listRecipes({
          vault: input.vault,
          requestId: input.requestId,
          status: input.status,
          limit: input.limit ?? 50,
        })
      },
    },
    additionalCommands: [
      createEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: z.string().min(1).describe('Recipe id or slug to edit.'),
        },
        description:
          'Edit one recipe by merging a partial JSON patch or one or more path assignments into the saved record.',
        run(input) {
          return editRecipeRecord({
            vault: input.vault,
            lookup: input.lookup,
            inputFile: input.inputFile,
            set: input.set,
            clear: input.clear,
          })
        },
      }),
      createEntityDeleteCommandConfig({
        arg: {
          name: 'id',
          schema: z.string().min(1).describe('Recipe id or slug to delete.'),
        },
        description: 'Delete one recipe Markdown record.',
        run(input) {
          return deleteRecipeRecord({
            vault: input.vault,
            lookup: input.lookup,
          })
        },
      }),
    ],
  })
}
