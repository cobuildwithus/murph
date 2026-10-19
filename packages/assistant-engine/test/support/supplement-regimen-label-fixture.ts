import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { initializeVault } from '@murphai/core'

const execFileAsync = promisify(execFile)
const CLI_ENTRYPOINT = fileURLToPath(new URL('../../../cli/src/bin.ts', import.meta.url))
const TSX_LOADER = fileURLToPath(new URL('../../../../node_modules/tsx/dist/loader.mjs', import.meta.url))
const TSX_TSCONFIG_PATH = fileURLToPath(new URL('../../../../tsconfig.base.json', import.meta.url))
const DATA_API_ORIGIN = 'http://murph-data-api.worker'

const SHAKE = 'Making a shake with one scoop of my Nimbus Forge whey and one scoop of my Halcyon Vale plant protein.'
const MACRO_PROMPT = `${SHAKE} What are the total calories, carbs, and fat? Do not log anything.`

// `labels`: which supplement labels the corpus returns for the saved products.
export const REGIMEN_LABEL_SCENARIOS = {
  'regimen-label-available': { prompt: MACRO_PROMPT, labels: 'complete' },
  // Matching labels omit fat; calories and carbs remain authoritative.
  'regimen-label-partial': { prompt: MACRO_PROMPT, labels: 'without-fat' },
  'regimen-label-unavailable': { prompt: MACRO_PROMPT, labels: 'none' },
  // Saved regimen protein answers the request.
  'regimen-verified-protein': { prompt: `${SHAKE} How much protein is that? Do not log anything.`, labels: 'complete' },
} as const

export type RegimenLabelScenario = keyof typeof REGIMEN_LABEL_SCENARIOS
type SupplementLabels = (typeof REGIMEN_LABEL_SCENARIOS)[RegimenLabelScenario]['labels']

// Totals from the synthetic supplement labels below.
export const REGIMEN_SHAKE_TOTALS = { calories: 270, carbsGrams: 8, fatGrams: 5, proteinGrams: 44 } as const

const SUPPLEMENTS = [
  { slug: 'nimbus-forge-vanilla-whey', name: 'Nimbus Forge Vanilla Whey', brand: 'Nimbus Forge',
    serving: { description: '1 scoop (32 g)', grams: 32 }, calories: 130, fat: 2, carbs: 3, protein: 24 },
  { slug: 'halcyon-vale-plant-protein', name: 'Halcyon Vale Plant Protein', brand: 'Halcyon Vale',
    serving: { description: '1 scoop (35 g)', grams: 35 }, calories: 140, fat: 3, carbs: 5, protein: 20 },
] as const

// Unrelated products that share only a brand-like word with the saved supplements.
export const REGIMEN_FUZZY_FOOD_NAMES = ['Nimbus Bakery Cloud Bread', 'Halcyon Sparkling Apple Cider'] as const

// Mirrors the hosted /api/foods nutritionOnly projection (toFoodNutritionSearchItem).
function fuzzyFoodItem(name: string, index: number) {
  const row = (rowName: string, value: number, unit: string) =>
    ({ name: rowName, amount: { display: String(value), unit, value }, dailyValuePercent: null, basis: 'per_100_g' })
  return {
    id: `fdc:990001${index}`, dataOrigin: 'usda_branded', dataOriginId: `990001${index}`, name,
    brand: name.split(' ').slice(0, 2).join(' '), upc: null, offMarket: false,
    contaminantSummary: { status: 'no_known_product_tests', murphConcernLevel: 'unknown', alertCount: 0,
      alertsTruncated: false, alerts: [], observationCount: 0, observationsTruncated: false, observations: [] },
    label: {
      nutrition: { basis: 'per_100_g', rows: [row('Energy', 250, 'kcal'), row('Protein', 9, 'g'),
        row('Total lipid (fat)', 3, 'g'), row('Carbohydrate, by difference', 47, 'g')] },
      serving: { amount: 1, description: 'serving', grams: 28, unit: null },
    },
  }
}

// Mirrors the brand-site supplement label rows in apps/web/sql/supplements.
function supplementLabelItem(product: (typeof SUPPLEMENTS)[number], includeFat: boolean) {
  return {
    id: `brand-site:${product.slug}`, dataOrigin: 'brand_site', dataOriginId: product.slug,
    name: product.name, brand: product.brand, upc: null, offMarket: false,
    label: {
      schemaVersion: 1, sourceType: 'official_brand_page', evidenceStatus: 'official_facts_panel',
      productType: 'Protein powder', factsPanelType: 'Nutrition Facts', name: product.name, brandName: product.brand,
      servingSizes: [{ description: product.serving.description, amount: 1, unit: 'scoop', grams: product.serving.grams }],
      calories: product.calories,
      nutritionRows: [
        ...(includeFat ? [{ name: 'Total Fat', amount: String(product.fat), unit: 'g' }] : []),
        { name: 'Total Carbohydrate', amount: String(product.carbs), unit: 'g' },
        { name: 'Protein', amount: String(product.protein), unit: 'g' },
      ],
    },
  }
}

// Stands in for the hosted Worker egress intercept: only the label paths
// answer, and every other request fails and is logged. A query resolves the
// first rule whose words all appear in it; this is a stub, not search ranking.
function dataApiPreload(input: { labelQueryLogPath: string, routesPath: string }): string {
  return [
    "import { appendFileSync, readFileSync } from 'node:fs';",
    `const origin = ${JSON.stringify(DATA_API_ORIGIN)};`,
    `const log = (entry) => appendFileSync(${JSON.stringify(input.labelQueryLogPath)}, JSON.stringify(entry) + '\\n');`,
    `const routes = JSON.parse(readFileSync(${JSON.stringify(input.routesPath)}, 'utf8'));`,
    "const words = (query) => query.toLowerCase().split(/[^a-z]+/u);",
    'const resolve = (rules, query) => rules.find((rule) => rule.words.every((word) => words(query).includes(word)))?.item;',
    'globalThis.fetch = async (request, init) => {',
    '  const url = new URL(request instanceof Request ? request.url : String(request));',
    '  const rules = url.origin === origin ? routes[url.pathname] : undefined;',
    '  if (!rules) {',
    "    log({ unexpected: `${url.origin}${url.pathname}` });",
    "    throw new TypeError('fixture network unavailable');",
    '  }',
    "  const post = (init?.method ?? 'GET') === 'POST';",
    "  const queries = post ? JSON.parse(String(init.body)).queries : [url.searchParams.get('q')];",
    '  const items = queries.map((query) => resolve(rules, query));',
    "  log({ path: url.pathname, queries, hits: items.map(Boolean) });",
    '  const body = post',
    '    ? { results: queries.map((query, index) => ({ query, items: items[index] ? [items[index]] : [] })) }',
    '    : { items: items[0] ? [items[0]] : [] };',
    "  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });",
    '};',
    '',
  ].join('\n')
}

// Runs the real CLI from source against the synthetic vault.
function cliWrapper(input: { commandLogPath: string, preloadPath: string, vaultRoot: string }): string {
  return [
    `#!${process.execPath}`,
    "const { appendFileSync } = require('node:fs');",
    "const { spawnSync } = require('node:child_process');",
    'const args = process.argv.slice(2);',
    `appendFileSync(${JSON.stringify(input.commandLogPath)}, JSON.stringify(args) + '\\n');`,
    'const env = {',
    '  ...process.env,',
    "  MURPH_DATA_API_KEY: 'synthetic-data-api-placeholder',",
    "  MURPH_HOSTED_RUNTIME_PROCESS: '1',",
    `  TSX_TSCONFIG_PATH: ${JSON.stringify(TSX_TSCONFIG_PATH)},`,
    `  VAULT: ${JSON.stringify(input.vaultRoot)},`,
    '};',
    `const result = spawnSync(process.execPath, ['--import', ${JSON.stringify(TSX_LOADER)}, '--import', ${JSON.stringify(input.preloadPath)}, ${JSON.stringify(CLI_ENTRYPOINT)}, ...args], { env, stdio: 'inherit' });`,
    'process.exit(result.status ?? 1);',
    '',
  ].join('\n')
}

// Seeds sparse supplement regimens through `vault-cli regimen save`: brand,
// serving and protein only, with no structured nutrition provenance.
export async function materializeRegimenLabelFixture(input: { root: string, labels: SupplementLabels }) {
  const binDirectory = path.join(input.root, 'bin')
  const vaultRoot = path.join(input.root, 'vault')
  const commandLogPath = path.join(input.root, 'commands.jsonl')
  const labelQueryLogPath = path.join(input.root, 'label-queries.jsonl')
  const routesPath = path.join(binDirectory, 'label-routes.json')
  const preloadPath = path.join(binDirectory, 'data-api-preload.mjs')
  const executablePath = path.join(binDirectory, 'vault-cli')
  const routes = {
    '/api/foods': REGIMEN_FUZZY_FOOD_NAMES.map((name, index) =>
      ({ words: [name.split(' ')[0]!.toLowerCase()], item: fuzzyFoodItem(name, index) })),
    '/api/supplements': input.labels === 'none' ? [] : SUPPLEMENTS.map((product) => ({
      words: product.brand.toLowerCase().split(' '),
      item: supplementLabelItem(product, input.labels === 'complete'),
    })),
  }
  await mkdir(binDirectory, { recursive: true })
  await initializeVault({ vaultRoot, timezone: 'America/New_York' })
  await Promise.all([
    writeFile(routesPath, JSON.stringify(routes), 'utf8'),
    writeFile(preloadPath, dataApiPreload({ labelQueryLogPath, routesPath }), 'utf8'),
    writeFile(executablePath, cliWrapper({ commandLogPath, preloadPath, vaultRoot }), { mode: 0o700 }),
  ])
  const cli = async (args: readonly string[]) =>
    (await execFileAsync(executablePath, [...args], { env: { PATH: process.env.PATH }, timeout: 60_000 })).stdout
  for (const product of SUPPLEMENTS) {
    await cli(['regimen', 'save', product.name, '--kind', 'supplement', '--brand', product.brand,
      '--serving-size', product.serving.description, '--ingredient-compound', 'protein',
      '--ingredient-amount', String(product.protein), '--ingredient-unit', 'g', '--format', 'json'])
  }
  const resetLogs = async () => {
    await Promise.all([writeFile(commandLogPath, '', 'utf8'), writeFile(labelQueryLogPath, '', 'utf8')])
  }
  await resetLogs()
  const readJsonLines = async (filePath: string) =>
    (await readFile(filePath, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line) as unknown)
  return {
    binDirectory,
    cli,
    readCommands: async () => await readJsonLines(commandLogPath) as string[][],
    readLabelRequests: async () => await readJsonLines(labelQueryLogPath) as Array<
      { path: string, queries: string[], hits: boolean[] } | { unexpected: string }
    >,
    resetLogs,
    vaultRoot,
  }
}
