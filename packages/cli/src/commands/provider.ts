import { Cli, z } from 'incur'
import {
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import { normalizeRepeatableFlagOption } from '@murphai/vault-usecases'
import {
  deleteProviderRecord,
  editProviderRecord,
  upsertProviderRecord,
  type ProviderPayload,
} from '@murphai/vault-usecases/records'
import { registerRegistryDocEntityGroup } from './entity-command-groups.js'
import { type FactoryCommandConfig } from './command-factory-primitives.js'
import {
  appendTypedClear,
  appendTypedSet,
  createEntityDeleteCommandConfig,
  createEntityEditCommandConfig,
  emptyToUndefined,
  stringArrayOption,
  stringOption,
} from './record-mutation-command-helpers.js'

const providerIdSchema = z
  .string()
  .regex(
    /^prov_[0-9A-HJKMNP-TV-Z]{26}$/u,
    'Expected a provider id like prov_01JNV422Y2M5ZBV64ZP4N1DRB1.',
  )
const providerSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')
const providerStatusSchema = z.string().min(1)
const providerTitleSchema = z
  .string()
  .min(1)
  .max(160)
  .describe('Provider title or name.')
const providerTextSchema = (max: number, label: string) =>
  z.string().min(1).max(max).optional().describe(label)
const providerBodySchema = z
  .string()
  .optional()
  .describe('Optional Markdown body for the provider document.')
const providerAliasOptionSchema = z
  .array(z.string().min(1).max(160))
  .optional()
  .describe('Optional alias for lookup and search. Repeat --alias for multiple values.')

const providerScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('provider'),
  payload: z.record(z.string(), z.unknown()),
})

const providerUpsertResultSchema = z.object({
  vault: pathSchema,
  providerId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
})

const providerListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: providerStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

function buildProviderSavePayload(input: {
  alias?: string[]
  body?: string
  id?: string
  location?: string
  note?: string
  organization?: string
  phone?: string
  slug?: string
  specialty?: string
  status?: string
  title: string
  website?: string
}): ProviderPayload {
  const aliases = normalizeRepeatableFlagOption(input.alias, 'alias')

  return {
    ...(input.id ? { providerId: input.id } : {}),
    ...(input.slug ? { slug: input.slug } : {}),
    title: input.title,
    status: input.status ?? 'active',
    ...(input.specialty ? { specialty: input.specialty } : {}),
    ...(input.organization ? { organization: input.organization } : {}),
    ...(input.location ? { location: input.location } : {}),
    ...(input.website ? { website: input.website } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(aliases ? { aliases } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
  }
}

const providerSaveOptions = {
  id: providerIdSchema
    .optional()
    .describe('Optional existing provider id to update.'),
  slug: providerSlugSchema
    .optional()
    .describe('Optional stable lowercase kebab-case slug.'),
  status: providerStatusSchema
    .max(64)
    .optional()
    .describe('Optional provider status. Defaults to active.'),
  specialty: providerTextSchema(160, 'Optional provider specialty.'),
  organization: providerTextSchema(160, 'Optional provider organization.'),
  location: providerTextSchema(160, 'Optional provider location.'),
  website: providerTextSchema(240, 'Optional provider website.'),
  phone: providerTextSchema(64, 'Optional provider phone label or number.'),
  note: providerTextSchema(4000, 'Optional provider note.'),
  alias: providerAliasOptionSchema,
  body: providerBodySchema,
}

const providerSaveCommand: FactoryCommandConfig<
  z.infer<typeof providerUpsertResultSchema>,
  { title: typeof providerTitleSchema },
  typeof providerSaveOptions
> = {
  name: 'save',
  args: z.object({
    title: providerTitleSchema,
  }),
  description: 'Create or update one provider from typed command fields.',
  examples: [
    {
      args: {
        title: 'Labcorp',
      },
      description: 'Save a provider without a JSON payload file.',
      options: {
        specialty: 'lab',
        status: 'active',
        vault: './vault',
      },
    },
  ],
  hint: 'Use provider import-json only when importing an advanced JSON payload from @file.json or stdin.',
  options: providerSaveOptions,
  output: providerUpsertResultSchema,
  async run({ args, options }) {
    return upsertProviderRecord({
      vault: options.vault,
      payload: buildProviderSavePayload({
        alias: options.alias,
        body: options.body,
        id: options.id,
        location: options.location,
        note: options.note,
        organization: options.organization,
        phone: options.phone,
        slug: options.slug,
        specialty: options.specialty,
        status: options.status,
        title: args.title,
        website: options.website,
      }),
    })
  },
}

export function registerProviderCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  registerRegistryDocEntityGroup(cli, {
    commandName: 'provider',
    description: 'Provider registry commands for bank/providers Markdown records.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit an advanced JSON provider payload template for `provider import-json`.',
      output: providerScaffoldResultSchema,
      async run({ options, requestId }) {
        return services.core.scaffoldProvider({
          vault: String(options.vault ?? ''),
          requestId,
        })
      },
    },
    importJson: {
      description: 'Import or bulk-update one provider Markdown record from an advanced JSON payload file or stdin.',
      hint: 'Use provider save for the canonical typed create/update path; keep provider import-json for advanced JSON imports from @file.json or stdin.',
      output: providerUpsertResultSchema,
      async run(input) {
        return services.core.upsertProvider({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one provider by canonical id or slug.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Provider id or slug to show.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showProvider({
          lookup: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List provider records with an optional status filter.',
      output: providerListResultSchema,
      statusOption: providerStatusSchema.optional(),
      async run(input) {
        return services.query.listProviders({
          vault: input.vault,
          requestId: input.requestId,
          status: input.status,
          limit: input.limit ?? 10,
        })
      },
    },
    additionalCommands: [
      providerSaveCommand,
      createEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: z.string().min(1).describe('Provider id or slug to edit.'),
        },
        description:
          'Edit one provider from typed fields.',
        options: {
          title: providerTitleSchema.optional().describe('Replace provider title or name.'),
          slug: providerSlugSchema.optional().describe('Replace provider slug and rename the underlying document.'),
          status: providerSaveOptions.status,
          specialty: providerSaveOptions.specialty,
          organization: providerSaveOptions.organization,
          location: providerSaveOptions.location,
          website: providerSaveOptions.website,
          phone: providerSaveOptions.phone,
          note: providerSaveOptions.note,
          alias: providerSaveOptions.alias,
          body: providerSaveOptions.body,
          clearSpecialty: z.boolean().optional().describe('Clear provider specialty.'),
          clearOrganization: z.boolean().optional().describe('Clear provider organization.'),
          clearLocation: z.boolean().optional().describe('Clear provider location.'),
          clearWebsite: z.boolean().optional().describe('Clear provider website.'),
          clearPhone: z.boolean().optional().describe('Clear provider phone.'),
          clearNote: z.boolean().optional().describe('Clear provider note.'),
          clearAliases: z.boolean().optional().describe('Clear provider aliases.'),
          clearBody: z.boolean().optional().describe('Clear provider Markdown body override.'),
        },
        buildInput(input, options) {
          const set: string[] = []
          const clear: string[] = []
          appendTypedSet(set, 'title', stringOption(options.title))
          appendTypedSet(set, 'slug', stringOption(options.slug))
          appendTypedSet(set, 'status', stringOption(options.status))
          appendTypedSet(set, 'specialty', stringOption(options.specialty))
          appendTypedSet(set, 'organization', stringOption(options.organization))
          appendTypedSet(set, 'location', stringOption(options.location))
          appendTypedSet(set, 'website', stringOption(options.website))
          appendTypedSet(set, 'phone', stringOption(options.phone))
          appendTypedSet(set, 'note', stringOption(options.note))
          appendTypedSet(set, 'aliases', stringArrayOption(options.alias))
          appendTypedSet(set, 'body', stringOption(options.body))
          appendTypedClear(clear, 'specialty', options.clearSpecialty === true)
          appendTypedClear(clear, 'organization', options.clearOrganization === true)
          appendTypedClear(clear, 'location', options.clearLocation === true)
          appendTypedClear(clear, 'website', options.clearWebsite === true)
          appendTypedClear(clear, 'phone', options.clearPhone === true)
          appendTypedClear(clear, 'note', options.clearNote === true)
          appendTypedClear(clear, 'aliases', options.clearAliases === true)
          appendTypedClear(clear, 'body', options.clearBody === true)
          return {
            ...input,
            set: emptyToUndefined(set),
            clear: emptyToUndefined(clear),
          }
        },
        run(input) {
          return editProviderRecord({
            vault: input.vault,
            lookup: input.lookup,
            set: input.set,
            clear: input.clear,
          })
        },
      }),
      createEntityDeleteCommandConfig({
        arg: {
          name: 'id',
          schema: z.string().min(1).describe('Provider id or slug to delete.'),
        },
        description: 'Delete one provider Markdown record.',
        run(input) {
          return deleteProviderRecord({
            vault: input.vault,
            lookup: input.lookup,
          })
        },
      }),
    ],
  })
}
