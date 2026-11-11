#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { recapMaterialSchema, recapTranscriptMessageSchema } from '@murphai/contracts/recap-material'
import { previewRecap } from './assistant/recap-preview.js'
import { readRecapFile } from './assistant/recap-files.js'

const { values } = parseArgs({ options: { vault: { type: 'string', default: '.' }, directory: { type: 'string' }, draft: { type: 'string' } } })
if (!values.directory || !values.draft) throw new Error('Usage: murph-recap-preview --directory <task-relative-directory> --draft <vault-relative-JSON> [--vault <vault>]')
const input = { vault: values.vault, relativeRoot: values.directory }
const read = async (file: string, maxBytes: number) => readRecapFile({ ...input, file: `${values.directory}/${file}`, maxBytes })
try {
  const material = recapMaterialSchema.parse(JSON.parse((await read('inputs/material.json', 4 * 1024 * 1024)).toString('utf8')))
  const chat = (await read('inputs/chat.jsonl', 32 * 1024 * 1024)).toString('utf8').split('\n').filter(Boolean).map(line => recapTranscriptMessageSchema.parse(JSON.parse(line)))
  const result = await previewRecap({ ...input, draftPath: values.draft, material, chat,
    lore: (await read('inputs/lore.txt', 64 * 1024)).toString('utf8'),
    photo: async entryId => {
      const reference = material.references.find(reference => reference.entryId === entryId)
      return reference ? read(`inputs/${reference.id}.jpg`, 2 * 1024 * 1024) : null
    } })
  process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  if (!result.valid) process.exitCode = 1
} catch {
  process.stderr.write('Preview failed: check the local draft, selected files and authorized inputs.\n')
  process.exitCode = 1
}
