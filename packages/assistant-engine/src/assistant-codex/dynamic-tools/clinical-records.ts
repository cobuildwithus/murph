import * as z from '@murphai/contracts/zod-runtime'

import type {
  SafeToolCallValidationDigest,
} from '../../assistant/tool-validation-digest.js'
import { parseDynamicToolArguments } from './dynamic-tool-wrapper.js'

const clinicalRecordsConnectLinkArgumentsSchema = z.object({}).strict()

export const MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL = {
  namespace: 'murph',
  name: 'create_clinical_records_connect_link',
  description: [
    'Create a Murph link for the current user to connect Epic or MyChart clinical records.',
    'Use it in a private conversation when the user asks to connect or import their provider records, or on a scheduled occurrence whose saved instructions ask for the link.',
    'Put the returned connectUrl in the reply unchanged.',
    'Each link is single-use and expires quickly, so create a new one each time and never reuse an earlier link.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
} as const

export type ClinicalRecordsConnectLinkDynamicToolRequest =
  | {
      kind: 'create-clinical-records-connect-link'
    }
  | {
      kind: 'invalid-clinical-records-connect-link-arguments'
      validationDigest: SafeToolCallValidationDigest
    }

export function readClinicalRecordsConnectLinkDynamicToolRequest(input: {
  arguments: unknown
  tool: string | null
}): ClinicalRecordsConnectLinkDynamicToolRequest | null {
  if (input.tool !== MURPH_CREATE_CLINICAL_RECORDS_CONNECT_LINK_TOOL.name) {
    return null
  }

  const parsed = parseDynamicToolArguments({
    schema: clinicalRecordsConnectLinkArgumentsSchema,
    toolName: 'murph.create_clinical_records_connect_link',
    value: input.arguments,
  })

  return parsed.ok
    ? { kind: 'create-clinical-records-connect-link' }
    : {
        kind: 'invalid-clinical-records-connect-link-arguments',
        validationDigest: parsed.validationDigest,
      }
}
