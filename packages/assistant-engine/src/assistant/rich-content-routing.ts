import type { AssistantUserMessageContentPart } from '../model-harness.js'
import type { ResolvedAssistantFailoverRoute } from './failover.js'
import { resolveAssistantProviderTargetCapabilities } from './provider-registry.js'

export function hasAssistantRichUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): boolean {
  return (userMessageContent ?? []).some((part) => part.type !== 'text')
}

export function assistantRoutesSupportRichUserMessageContent(
  routes: readonly ResolvedAssistantFailoverRoute[],
): boolean {
  return routes.some((route) => assistantRouteSupportsRichUserMessageContent(route))
}

export function prioritizeAssistantRoutesForRichUserMessageContent(input: {
  routes: readonly ResolvedAssistantFailoverRoute[]
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined
}): ResolvedAssistantFailoverRoute[] {
  const routes = [...input.routes]
  if (!hasAssistantRichUserMessageContent(input.userMessageContent)) {
    return routes
  }

  const richRoutes: ResolvedAssistantFailoverRoute[] = []
  const textOnlyRoutes: ResolvedAssistantFailoverRoute[] = []

  for (const route of routes) {
    if (assistantRouteSupportsRichUserMessageContent(route)) {
      richRoutes.push(route)
      continue
    }

    textOnlyRoutes.push(route)
  }

  if (richRoutes.length === 0 || textOnlyRoutes.length === 0) {
    return routes
  }

  return [...richRoutes, ...textOnlyRoutes]
}

export function resolveAssistantRouteUserMessageContent(input: {
  route: ResolvedAssistantFailoverRoute
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined
}): AssistantUserMessageContentPart[] | null {
  const normalized = normalizeAssistantUserMessageContent(input.userMessageContent)
  if (normalized === null) {
    return null
  }

  if (!hasAssistantRichUserMessageContent(normalized)) {
    return normalized
  }

  return assistantRouteSupportsRichUserMessageContent(input.route)
    ? normalized
    : null
}

export function assistantRouteSupportsRichUserMessageContent(
  route: ResolvedAssistantFailoverRoute,
): boolean {
  return resolveAssistantProviderTargetCapabilities({
    provider: route.provider,
    ...route.providerOptions,
  }).supportsRichUserMessageContent
}

function normalizeAssistantUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): AssistantUserMessageContentPart[] | null {
  if (!Array.isArray(userMessageContent) || userMessageContent.length === 0) {
    return null
  }

  return [...userMessageContent]
}
