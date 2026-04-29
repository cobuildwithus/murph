import type { AssistantUserMessageContentPart } from './content-types.js'
import type { ResolvedAssistantProviderRoute } from './provider-route.js'
import { resolveAssistantProviderTargetCapabilities } from './provider-registry.js'
import type { AssistantUserMessageContentType } from './providers/types.js'

export function hasAssistantRichUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): boolean {
  return (userMessageContent ?? []).some((part) => part.type !== 'text')
}

export function prioritizeAssistantRoutesForRichUserMessageContent(input: {
  routes: readonly ResolvedAssistantProviderRoute[]
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined
}): ResolvedAssistantProviderRoute[] {
  const normalized = normalizeAssistantUserMessageContent(input.userMessageContent)
  const routes = [...input.routes]
  if (!hasAssistantRichUserMessageContent(normalized)) {
    return routes
  }

  const richRoutes: ResolvedAssistantProviderRoute[] = []
  const textOnlyRoutes: ResolvedAssistantProviderRoute[] = []

  for (const route of routes) {
    if (
      normalized
      && routeSupportsAssistantUserMessageContent({
        route,
        userMessageContent: normalized,
      })
    ) {
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
  route: ResolvedAssistantProviderRoute
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined
}): AssistantUserMessageContentPart[] | null {
  const normalized = normalizeAssistantUserMessageContent(input.userMessageContent)
  if (normalized === null) {
    return null
  }

  if (!hasAssistantRichUserMessageContent(normalized)) {
    return normalized
  }

  const supported = filterAssistantRouteUserMessageContent({
    route: input.route,
    userMessageContent: normalized,
  })

  return hasAssistantRichUserMessageContent(supported) ? supported : null
}

export function assistantRouteSupportsRichUserMessageContent(
  route: ResolvedAssistantProviderRoute,
): boolean {
  return resolveAssistantProviderTargetCapabilities(
    route.providerOptions,
  ).supportsRichUserMessageContent
}

export function resolveAssistantRouteSupportedUserMessageContentTypes(
  route: ResolvedAssistantProviderRoute,
): readonly AssistantUserMessageContentType[] {
  return resolveAssistantProviderTargetCapabilities(
    route.providerOptions,
  ).supportedUserMessageContentTypes
}

function normalizeAssistantUserMessageContent(
  userMessageContent: readonly AssistantUserMessageContentPart[] | null | undefined,
): AssistantUserMessageContentPart[] | null {
  if (!Array.isArray(userMessageContent) || userMessageContent.length === 0) {
    return null
  }

  return [...userMessageContent]
}

function routeSupportsAssistantUserMessageContent(input: {
  route: ResolvedAssistantProviderRoute
  userMessageContent: readonly AssistantUserMessageContentPart[]
}): boolean {
  return hasAssistantRichUserMessageContent(
    filterAssistantRouteUserMessageContent(input),
  )
}

function filterAssistantRouteUserMessageContent(input: {
  route: ResolvedAssistantProviderRoute
  userMessageContent: readonly AssistantUserMessageContentPart[]
}): AssistantUserMessageContentPart[] {
  const supportedTypes = new Set(
    resolveAssistantRouteSupportedUserMessageContentTypes(input.route),
  )

  return input.userMessageContent.flatMap<AssistantUserMessageContentPart>((part) => {
    if (supportedTypes.has(part.type)) {
      return [part]
    }

    return []
  })
}
