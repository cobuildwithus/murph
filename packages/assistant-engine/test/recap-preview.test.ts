import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { expect, test } from 'vitest'
import type { GameRecapDraft } from '@murphai/contracts/recap-show'
import { renderRecapPageSvg } from '@murphai/contracts/recap-renderer'
import { previewRecap, readRecapDraftFile, RecapDraftValidationError } from '../src/assistant/recap-preview.js'
import { recapDirectory, saveRecapMediaFile } from '../src/assistant/recap-files.js'

test('malformed drafts return actionable schema paths without echoing prose', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'recap-schema-'))
  const relativeRoot = '.runtime/tmp/recap/synthetic', draftPath = `${relativeRoot}/drafts/show.json`
  try {
    await recapDirectory(vault, `${relativeRoot}/drafts`)
    await writeFile(path.join(vault, draftPath), JSON.stringify({ story: { pages: [], chatLine: 'Synthetic private prose',
      song: { title: 'x'.repeat(31), style: 'Synthetic style', lyrics: ['one', 'two', 'three', 'four'] } }, files: [] }))
    await expect(readRecapDraftFile({ vault, relativeRoot, draftPath })).rejects.toThrow(/story.song.title/)
    await expect(readRecapDraftFile({ vault, relativeRoot, draftPath })).rejects.not.toThrow('Synthetic private prose')
    await writeFile(path.join(vault, draftPath), '{broken synthetic prose')
    await expect(readRecapDraftFile({ vault, relativeRoot, draftPath })).rejects.toEqual(new RecapDraftValidationError('Draft must contain valid JSON.'))
  } finally { await rm(vault, { recursive: true, force: true }) }
})

test('preview validates, keeps whole photos, renders every page and distinguishes revised drafts', async () => {
  const vault = await mkdtemp(path.join(tmpdir(), 'recap-preview-'))
  try {
    const relativeRoot = '.runtime/tmp/recap/synthetic', draftPath = `${relativeRoot}/drafts/show.json`
    await recapDirectory(vault, `${relativeRoot}/drafts`)
    const photo = await sharp({ create: { width: 320, height: 100, channels: 3, background: '#88aa77' } }).jpeg().toBuffer()
    const receipt = await saveRecapMediaFile({ vault, relativeRoot, operationId: 'cover', bytes: photo, mediaType: 'image/jpeg' })
    const scene = { kind: 'scene' as const, scene: { cast: ['Player A', 'Player B'], prompt: 'Two fictional players stand on a stage made from exercise mats, with an empty breakfast tray lit like the most precious exhibit in a museum.' } }
    const draft: GameRecapDraft = { files: [{ slot: 'scene-0', receipt }], story: { treatment: 'Museum tour', chatLine: 'The game ended in a tie. The mat stayed busy.', pages: [
      { background: 'night', blocks: [{ kind: 'headline', text: 'The mat gets a museum' }, scene, { kind: 'kicker', text: 'Breakfast waits' }] },
      { background: 'paper', blocks: [{ kind: 'headline', text: 'The tray was empty' }, scene, { kind: 'headline', text: 'Nobody owed breakfast' }] },
      { background: 'sage', blocks: [{ kind: 'headline', text: 'Player A brought a mat' }, { kind: 'photo', entryIds: ['photo-a'], style: 'print' }, { kind: 'headline', text: 'The mat did overtime' }] },
      { background: 'paper', blocks: [{ kind: 'headline', text: 'The mat stayed busy' }] },
      { background: 'night', blocks: [{ kind: 'headline', text: 'The tray can wait' }] },
    ] } }
    await writeFile(path.join(vault, draftPath), JSON.stringify(draft))
    const input = { vault, relativeRoot, draftPath, lore: '', chat: [], photo: async () => photo,
      material: { game: {}, players: ['Player A', 'Player B'], result: [{ memberId: 'a', name: 'Player A', score: 3 }, { memberId: 'b', name: 'Player B', score: 3 }],
        entries: [{ entryId: 'photo-a', playerName: 'Player A', kind: 'photo', text: null, visibleToBoth: true }],
        references: [], startedAt: '2026-11-01T00:00:00Z', settledAt: '2026-11-08T00:00:00Z' } }
    const first = await previewRecap(input)
    expect(first.errors).toEqual([])
    expect(first.pages).toHaveLength(6)
    expect(await sharp(await readFile(path.join(vault, first.pages[0]!))).metadata()).toMatchObject({ format: 'png', width: 768, height: 1280 })
    const rendered = renderRecapPageSvg({ page: { id: 'photo', kind: 'print', background: 'paper', blocks: [{ kind: 'photo', entryIds: ['photo-a'], style: 'print' }] },
      treatment: 'Museum tour', photos: new Map([['photo-a', `data:image/jpeg;base64,${photo.toString('base64')}`]]), result: input.material.result })
    expect(rendered.svg).toContain('preserveAspectRatio="xMidYMid meet"')
    draft.story.pages[4]!.blocks[0]!.text = 'Breakfast remains theoretical'
    await writeFile(path.join(vault, draftPath), JSON.stringify(draft))
    const revised = await previewRecap(input)
    expect(revised.valid).toBe(true)
    expect(revised.draftHash).not.toBe(first.draftHash)
    expect(revised.contactSheet).not.toBe(first.contactSheet)
    draft.story.pages[2]!.blocks[1]!.style = 'fullBleed'
    await writeFile(path.join(vault, draftPath), JSON.stringify(draft))
    expect((await previewRecap(input)).errors).toContainEqual(expect.stringContaining('whole image'))
  } finally { await rm(vault, { recursive: true, force: true }) }
})
