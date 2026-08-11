import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, expect, it } from 'vitest'

import {
  readMaterializedExportPackReceipt,
  retireMaterializedExportPack,
} from '../src/export-packs.ts'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) =>
    rm(root, { force: true, recursive: true })
  ))
})

it('retires only an unchanged export pack with a matching manifest id', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-export-pack-receipt-'))
  tempRoots.push(vaultRoot)
  const packDirectory = path.join(vaultRoot, 'exports/packs/pack-one')
  const manifestPath = path.join(packDirectory, 'manifest.json')
  await mkdir(packDirectory, { recursive: true })
  await writeFile(manifestPath, JSON.stringify({
    generatedAt: '2026-08-09T12:00:00.000Z',
    packId: 'pack-one',
  }))
  const staleReceipt = await readMaterializedExportPackReceipt(
    vaultRoot,
    'pack-one',
  )

  await writeFile(manifestPath, JSON.stringify({
    generatedAt: '2026-08-09T12:01:00.000Z',
    packId: 'pack-one',
  }))
  await expect(
    retireMaterializedExportPack(vaultRoot, staleReceipt),
  ).resolves.toBe(false)
  await expect(readFile(manifestPath, 'utf8')).resolves.toContain('12:01:00')

  const currentReceipt = await readMaterializedExportPackReceipt(
    vaultRoot,
    'pack-one',
  )
  await expect(
    retireMaterializedExportPack(vaultRoot, currentReceipt),
  ).resolves.toBe(true)
  await expect(readFile(manifestPath)).rejects.toMatchObject({ code: 'ENOENT' })

  await mkdir(packDirectory, { recursive: true })
  await writeFile(manifestPath, JSON.stringify({ packId: 'pack-two' }))
  await expect(
    readMaterializedExportPackReceipt(vaultRoot, 'pack-one'),
  ).rejects.toMatchObject({ code: 'manifest_invalid' })
  await expect(readFile(manifestPath, 'utf8')).resolves.toContain('pack-two')
})
