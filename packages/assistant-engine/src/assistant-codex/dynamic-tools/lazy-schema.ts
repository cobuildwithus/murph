import { z } from 'zod'

export const MURPH_LAZY_DYNAMIC_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: {
      type: 'string',
      enum: ['schema', 'execute'],
    },
    request: {
      type: 'object',
      description:
        'Required for execute. Call schema first, then pass one object matching the returned requestSchema.',
    },
  },
  required: ['action'],
} as const

export const murphLazyDynamicToolArgumentsSchema = z.discriminatedUnion(
  'action',
  [
    z.object({
      action: z.literal('schema'),
    }).strict(),
    z.object({
      action: z.literal('execute'),
      request: z.unknown(),
    }).strict(),
  ],
)

export function buildLazyDynamicToolSchemaResponse<RequestSchema>(input: {
  description: string
  requestSchema: RequestSchema
  toolName: string
}): {
  action: 'schema'
  description: string
  instruction: string
  requestSchema: RequestSchema
  toolName: string
} {
  return {
    action: 'schema',
    description: input.description,
    instruction:
      'Call this tool with action="execute" and request set to one object matching requestSchema.',
    requestSchema: input.requestSchema,
    toolName: input.toolName,
  }
}
