import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeRecapWorkspace, readCommittedRecapReplies } from '../src/assistant/recap-workspace.js'
import { resolveAssistantStatePaths } from '../src/assistant/store/paths.js'
import { resolveAssistantTranscriptPath } from '../src/assistant/store/persistence.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const sessionId = 'asess_' + 'a'.repeat(32)
const startedAt = '2026-11-01T00:00:00Z', settledAt = '2026-11-08T00:00:00Z'
const material = { game: { id: 'game_synthetic', days: [] }, players: ['Player A', 'Player B'], entries: [],
  result: [{ memberId: 'player-a', name: 'Player A', score: 4 }, { memberId: 'player-b', name: 'Player B', score: 3 }], startedAt, settledAt, references: [] }

describe('recap workspace material', () => {
  it('exports over 100 ordered player messages and committed Murph replies with coverage gaps', async () => {
    const vault = await mkdtemp(path.join(os.tmpdir(), 'recap-inputs-')); roots.push(vault)
    const transcript = resolveAssistantTranscriptPath(resolveAssistantStatePaths(vault), sessionId)
    await mkdir(path.dirname(transcript), { recursive: true })
    await writeFile(transcript, JSON.stringify({ schema: 'murph.assistant-transcript-entry.v1', kind: 'assistant', text: 'Synthetic mat report.', createdAt: '2026-11-03T00:00:00Z' }) + '\n')
    const cursors: Array<string | undefined> = []
    const exported = await materializeRecapWorkspace({ vault, eventId: 'game-recap:game_synthetic', gameId: 'game_synthetic', sessionId, material, lore: 'A fictional mat rivalry.',
      tool: { async request(request) {
        if (request.action !== 'read_game' || request.recapRead?.kind !== 'transcript') throw new Error('Unexpected tool request')
        cursors.push(request.recapRead.after)
        const start = request.recapRead.after === undefined ? 1 : 201
        const count = start === 1 ? 200 : 5
        return { action: 'read_game', result: { status: 'ok', recapGame: {
          messages: Array.from({ length: count }, (_, index) => ({ id: `message-${start + index}`, source: 'player', playerName: 'Player A', text: `Synthetic line ${start + index}`, at: '2026-11-02T00:00:00Z', laneSeq: String(start + index) })),
          next: start === 1 ? '200' : null, through: '205', since: startedAt, until: settledAt, retainedSince: '2026-10-09T00:00:00Z', incomplete: false,
        } } }
      } },
    })
    expect(cursors).toEqual([undefined, '200'])
    const lines = exported.chat
    expect(lines).toHaveLength(206)
    expect(lines[0].id).toBe('message-1')
    expect(lines[204].id).toBe('message-205')
    expect(lines[205]).toMatchObject({ source: 'assistant', text: 'Synthetic mat report.' })
    expect(exported.manifest).toMatchObject({ coverage: { incomplete: true, throughConversationLaneSeq: '205' } })
    expect(JSON.stringify(exported.manifest)).not.toContain(vault)
  })
  it('reports unavailable reply history and cannot import another session', async () => {
    const vault = await mkdtemp(path.join(os.tmpdir(), 'recap-replies-')); roots.push(vault)
    expect(await readCommittedRecapReplies(vault, sessionId, startedAt, settledAt)).toEqual({ messages: [], incomplete: true })
    await expect(readCommittedRecapReplies(vault, '../foreign', startedAt, settledAt)).rejects.toThrow()
  })
})
