import { z } from 'zod'
import {
  fetchAssistantWeb,
} from '../../assistant/web-fetch.js'
import {
  assistantWebFetchExtractModeValues,
  resolveAssistantWebFetchEnabled,
} from '../../assistant/web-fetch/config.js'
import {
  assistantWebPdfReadMaxChars,
  assistantWebPdfReadMaxPages,
  readAssistantWebPdf,
} from '../../assistant/web-pdf-read.js'
import {
  assistantWebSearchFreshnessValues,
  assistantWebSearchProviderValues,
  resolveConfiguredAssistantWebSearchProvider,
  searchAssistantWeb,
} from '../../assistant/web-search.js'
import { defineConfiguredWebReadTool } from '../definition-factory.js'

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)

const assistantWebFetchExtractModeSchema = z.enum(assistantWebFetchExtractModeValues)
const assistantWebSearchProviderSchema = z.enum(assistantWebSearchProviderValues)
const assistantWebSearchFreshnessSchema = z.enum(assistantWebSearchFreshnessValues)
const assistantWebSearchDomainFilterSchema = z.array(z.string().min(1)).max(20).optional()

export function createWebSearchToolDefinitions() {
  if (resolveConfiguredAssistantWebSearchProvider() === null) {
    return []
  }

  return [
    defineConfiguredWebReadTool({
      name: 'web.search',
      description:
        'Search the public web through the configured Murph search backend. Use this for current events, provider docs, product pages, release notes, and other information that is not available inside the active vault.',
      inputSchema: z.object({
        query: z.string().min(1),
        provider: assistantWebSearchProviderSchema.optional(),
        count: z.number().int().positive().max(10).optional(),
        country: z.string().min(1).optional(),
        language: z.string().min(1).optional(),
        freshness: assistantWebSearchFreshnessSchema.optional(),
        dateAfter: localDateSchema.optional(),
        dateBefore: localDateSchema.optional(),
        domainFilter: assistantWebSearchDomainFilterSchema,
      }),
      inputExample: {
        query: 'OpenAI Responses API web search tool',
        provider: 'auto',
        count: 5,
        domainFilter: ['platform.openai.com', 'openai.com'],
      },
      execute: async ({
        count,
        country,
        dateAfter,
        dateBefore,
        domainFilter,
        freshness,
        language,
        provider,
        query,
      }) =>
        await searchAssistantWeb({
          query,
          provider,
          count,
          country,
          language,
          freshness,
          dateAfter,
          dateBefore,
          domainFilter,
        }),
    }),
  ]
}

export function createWebFetchToolDefinitions() {
  if (!resolveAssistantWebFetchEnabled()) {
    return []
  }

  return [
    defineConfiguredWebReadTool({
      name: 'web.fetch',
      description:
        'Fetch one public webpage over HTTP(S) from Murph\'s explicitly enabled web-read surface, block private-network targets, redact query/fragment-bearing URL details in tool output, and extract readable text for the assistant. Use this after discovery tools like web.search when you need the actual page contents of a docs page, menu, article, or product page. Use only stable public URLs; do not pass signed or session-bound links.',
      inputSchema: z.object({
        url: z.string().url(),
        extractMode: assistantWebFetchExtractModeSchema.optional(),
        maxChars: z.number().int().positive().max(40_000).optional(),
      }),
      inputExample: {
        url: 'https://example.com/menu',
        extractMode: 'markdown',
        maxChars: 8_000,
      },
      execute: async ({ extractMode, maxChars, url }) =>
        await fetchAssistantWeb({
          url,
          extractMode,
          maxChars,
        }),
    }),
  ]
}

export function createWebPdfReadToolDefinitions() {
  if (!resolveAssistantWebFetchEnabled()) {
    return []
  }

  return [
    defineConfiguredWebReadTool({
      name: 'web.pdf.read',
      description:
        'Fetch one public PDF over HTTP(S) from Murph\'s explicitly enabled web-read surface, block private-network targets, redact query/fragment-bearing URL details in tool output, and extract readable text with bounded page and character limits. Use this for menus, manuals, reports, or docs that are published as PDFs. Use only stable public URLs; do not pass signed or session-bound links.',
      inputSchema: z.object({
        url: z.string().url(),
        maxChars: z.number().int().positive().max(assistantWebPdfReadMaxChars).optional(),
        maxPages: z.number().int().positive().max(assistantWebPdfReadMaxPages).optional(),
      }),
      inputExample: {
        url: 'https://example.com/menu.pdf',
        maxPages: 4,
        maxChars: 8_000,
      },
      execute: async ({ maxChars, maxPages, url }) =>
        await readAssistantWebPdf({
          url,
          maxChars,
          maxPages,
        }),
    }),
  ]
}
