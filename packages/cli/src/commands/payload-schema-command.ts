import { Cli, z } from 'incur'
import * as zod from '@murphai/contracts/zod-runtime'

export const payloadSchemaResultSchema = z.object({
  schemaVersion: z.literal('murph.payload-schema.v1'),
  command: z.string().min(1),
  mediaType: z.enum(['application/json', 'application/jsonl']),
  schemaName: z.string().min(1).optional(),
  lineSchemaName: z.string().min(1).optional(),
  schema: z.record(z.string(), z.unknown()),
  examples: z.array(z.unknown()).optional(),
})

export interface PayloadSchemaCommandConfig {
  command: string
  description?: string
  examples?: unknown[]
  mediaType?: 'application/json' | 'application/jsonl'
  schema: zod.ZodTypeAny
  schemaName?: string
  lineSchemaName?: string
}

export function createPayloadSchemaResult(config: PayloadSchemaCommandConfig) {
  return payloadSchemaResultSchema.parse({
    schemaVersion: 'murph.payload-schema.v1',
    command: config.command,
    mediaType: config.mediaType ?? 'application/json',
    schemaName: config.schemaName,
    lineSchemaName: config.lineSchemaName,
    schema: zod.toJSONSchema(config.schema) as Record<string, unknown>,
    examples: config.examples,
  })
}

export function registerPayloadSchemaCommand(
  group: Cli.Cli,
  config: PayloadSchemaCommandConfig,
) {
  group.command('payload-schema', {
    description:
      config.description ??
      `Emit the exact JSON payload schema for ${config.command}.`,
    args: z.object({}),
    examples: [
      {
        description: `Print the JSON payload contract for ${config.command}.`,
        args: {},
        options: {},
      },
    ],
    hint:
      'This command returns the file-body contract. Incur --schema still describes how to call this payload-schema command, not the imported JSON file body.',
    options: z.object({}),
    output: payloadSchemaResultSchema,
    run() {
      return createPayloadSchemaResult(config)
    },
  })
}
