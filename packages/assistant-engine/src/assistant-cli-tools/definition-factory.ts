import { z, type ZodTypeAny } from 'zod'
import type { AssistantToolProvenance } from '../inbox-model-contracts.js'
import {
  defineAssistantCapability,
  type AssistantCapabilityBackendKind,
  type AssistantCapabilityDefinition,
  type AssistantCapabilityExecutor,
  type AssistantCapabilityHostKind,
} from '../model-harness.js'
import { assistantCliPolicyWrapperKinds } from './policy-wrappers.js'

export type AssistantCapabilityToolDefinitionInput<
  TSchema extends ZodTypeAny,
  TResult,
> =
  | (Omit<AssistantCapabilityDefinition<TSchema, TResult>, 'executionBindings'> & {
    execute(input: z.infer<TSchema>): Promise<TResult>
  })
  | (Omit<AssistantCapabilityDefinition<TSchema, TResult>, 'executionBindings'> & {
    executionBindings: Partial<
      Record<
        AssistantCapabilityHostKind,
        AssistantCapabilityExecutor<TSchema, TResult>
      >
    >
  })

export function defineHandAuthoredHelperTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'hand-authored-helper',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'local-service')
}

export function defineVaultServiceBackedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'vault-service-backed',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'local-service')
}

export function defineCliBackedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'cli-backed',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: [...assistantCliPolicyWrapperKinds],
  }, 'cli-backed', 'cli-wrapper')
}

export function defineConfiguredWebReadTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'configured-web-read',
    localOnly: false,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'configured-web-read')
}

export function defineHostedApiBackedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'hosted-api-backed',
    localOnly: false,
    generatedFrom: null,
    policyWrappers: [],
  }, 'native-local', 'hosted-api')
}

export function defineNativeLocalOnlyTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'native-local-only',
    localOnly: true,
    generatedFrom: null,
    policyWrappers: ['output-redaction'],
  }, 'native-local', 'native-file')
}

export function defineDescriptorGeneratedTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
  generatedFrom: string,
) {
  return defineAssistantCapabilityTool(definition, {
    origin: 'descriptor-generated',
    localOnly: true,
    generatedFrom,
    policyWrappers: [],
  }, 'native-local', 'local-service')
}

export function defineAssistantCapabilityTool<
  TSchema extends ZodTypeAny,
  TResult,
>(
  definition: AssistantCapabilityToolDefinitionInput<TSchema, TResult>,
  provenance: AssistantToolProvenance,
  defaultHostKind: AssistantCapabilityHostKind,
  defaultBackendKind: AssistantCapabilityBackendKind,
) {
  const executionBindings =
    'executionBindings' in definition
      ? definition.executionBindings
      : {
          [defaultHostKind]: definition.execute,
        }
  const {
    backendKind = defaultBackendKind,
    preferredHostKind = defaultHostKind,
    ...capability
  } = definition
  return defineAssistantCapability({
    ...capability,
    backendKind,
    preferredHostKind,
    executionBindings,
    provenance,
  })
}
