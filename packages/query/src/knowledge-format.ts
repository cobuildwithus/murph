import { orderedUniqueStrings } from './knowledge-model.ts'

const GENERATED_KNOWLEDGE_SECTION_HEADINGS = ['Related', 'Sources'] as const

export function renderKnowledgePageBody(input: {
  title: string
  body: string
  relatedSlugs: readonly string[]
  sourcePaths: readonly string[]
}): string {
  const lines = [`# ${input.title.trim()}`]
  const narrativeBody = String(input.body ?? '').trim()

  if (narrativeBody.length > 0) {
    lines.push('', narrativeBody)
  }

  const relatedSlugs = orderedUniqueStrings(
    input.relatedSlugs
      .map((slug) => String(slug ?? '').trim())
      .filter((slug) => slug.length > 0),
  )
  if (relatedSlugs.length > 0) {
    lines.push('', '## Related', '', ...relatedSlugs.map((slug) => `- [[${slug}]]`))
  }

  const sourcePaths = orderedUniqueStrings(
    input.sourcePaths
      .map((sourcePath) => String(sourcePath ?? '').trim())
      .filter((sourcePath) => sourcePath.length > 0),
  )
  if (sourcePaths.length > 0) {
    lines.push('', '## Sources', '', ...sourcePaths.map((sourcePath) => `- \`${sourcePath}\``))
  }

  return `${lines.join('\n').trim()}\n`
}

export function stripGeneratedKnowledgeSections(body: string): string {
  let normalized = String(body ?? '')

  for (const heading of GENERATED_KNOWLEDGE_SECTION_HEADINGS) {
    const pattern = new RegExp(
      `(^|\\n)##\\s+${escapeRegExp(heading)}\\s*\\n[\\s\\S]*?(?=\\n##\\s+|$)`,
      'giu',
    )
    normalized = normalized.replace(pattern, '$1').trim()
  }

  return normalized
}

export function stripKnowledgeLeadingHeading(body: string): string {
  return String(body ?? '')
    .replace(/^#\s+[^\n]*\n*/u, '')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
