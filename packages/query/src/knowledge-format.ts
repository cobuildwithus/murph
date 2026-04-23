import { orderedUniqueStrings } from './knowledge-model.ts'

const GENERATED_KNOWLEDGE_SECTION_DEFINITIONS = [
  {
    heading: 'Sources',
    itemPattern: /^-\s+`[^`\n]+`\s*$/u,
  },
  {
    heading: 'Related',
    itemPattern: /^-\s+\[\[[^\]\n]+\]\]\s*$/u,
  },
] as const

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
  let normalized = String(body ?? '').replace(/\r\n?/gu, '\n').trim()

  while (normalized.length > 0) {
    const stripped = stripTrailingGeneratedKnowledgeSection(normalized)
    if (stripped === normalized) {
      break
    }

    normalized = stripped
  }

  return normalized
}

export function stripKnowledgeLeadingHeading(body: string): string {
  return String(body ?? '')
    .replace(/^#\s+[^\n]*\n*/u, '')
    .trim()
}

function stripTrailingGeneratedKnowledgeSection(body: string): string {
  const lines = body.split('\n')
  const sectionStart = findTrailingKnowledgeSectionStart(lines)

  if (sectionStart === null) {
    return body
  }

  const definition = matchGeneratedKnowledgeSectionDefinition(lines[sectionStart] ?? '')
  if (!definition) {
    return body
  }

  const contentLines = trimKnowledgeSectionLines(lines.slice(sectionStart + 1))
  if (
    contentLines.length === 0 ||
    contentLines.some((line) => !definition.itemPattern.test(line))
  ) {
    return body
  }

  return lines.slice(0, sectionStart).join('\n').trim()
}

function findTrailingKnowledgeSectionStart(lines: readonly string[]): number | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^##\s+/u.test(lines[index]?.trim() ?? '')) {
      return index
    }
  }

  return null
}

function matchGeneratedKnowledgeSectionDefinition(
  headingLine: string,
): (typeof GENERATED_KNOWLEDGE_SECTION_DEFINITIONS)[number] | null {
  const headingMatch = headingLine.trim().match(/^##\s+(.+?)\s*$/u)
  if (!headingMatch) {
    return null
  }

  const heading = headingMatch[1]
  if (!heading) {
    return null
  }

  return (
    GENERATED_KNOWLEDGE_SECTION_DEFINITIONS.find(
      (definition) => definition.heading === heading,
    ) ?? null
  )
}

function trimKnowledgeSectionLines(lines: readonly string[]): string[] {
  let start = 0
  let end = lines.length

  while (start < end && lines[start]?.trim() === '') {
    start += 1
  }

  while (end > start && lines[end - 1]?.trim() === '') {
    end -= 1
  }

  return lines.slice(start, end).map((line) => line.trimEnd())
}
