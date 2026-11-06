import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Real Markdown documents, including irrelevant sessions and expired/archived work. */
export async function createRoutePlanningTailFixture(vault: string, count: number): Promise<void> {
  await mkdir(path.join(vault, 'bank/automations'), { recursive: true })
  for (let index = 0; index < count; index++) {
    await writeFile(path.join(vault, 'bank/automations', `${index}.md`), [
      '---',
      'schemaVersion: murph.frontmatter.automation.v1',
      'docType: automation',
      `automationId: auto_tail_${String(index).padStart(3, '0')}`,
      `slug: tail-${index}`,
      'title: Optional follow-up',
      `status: ${index % 5 === 4 ? 'archived' : index % 5 === 1 ? 'paused' : 'active'}`,
      `followUpSourceIntentId: synthetic-source-${index}`,
      `activeUntil: ${index % 5 === 3 ? '2000' : '2099'}-01-03T00:00:00.000Z`,
      'schedule:',
      '  kind: at',
      `  at: ${index % 5 === 3 ? '2000' : '2099'}-01-02T00:00:00.000Z`,
      'route:',
      '  channel: telegram',
      '  participantId: synthetic-actor',
      `  threadId: ${index % 5 === 2 ? 'other-thread' : 'synthetic-thread'}`,
      '  threadIsDirect: true',
      'createdAt: 2026-01-01T00:00:00.000Z',
      'updatedAt: 2026-01-02T00:00:00.000Z',
      '---', '', `Check synthetic matter ${index}.`, '',
      'Preserve the second paragraph and punctuation.', '',
    ].join('\n'))
  }
}
