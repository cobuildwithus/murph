import { chromium } from 'playwright'

const baseUrl = process.env.DESIGN_PROOF_BASE_URL ?? 'http://127.0.0.1:3000'
const scenarios = [
  {
    deviceScaleFactor: 1,
    output: '/tmp/optional-sponsorship-desktop.png',
    viewport: { height: 1000, width: 1280 },
  },
  {
    deviceScaleFactor: 2,
    isMobile: true,
    output: '/tmp/optional-sponsorship-mobile.png',
    viewport: { height: 844, width: 390 },
  },
]

const browser = await chromium.launch({ headless: true })
try {
  for (const scenario of scenarios) {
    const context = await browser.newContext({
      deviceScaleFactor: scenario.deviceScaleFactor,
      isMobile: scenario.isMobile ?? false,
      viewport: scenario.viewport,
    })
    const page = await context.newPage()
    await page.goto(
      `${baseUrl}/design?tab=components#group-usage-funding-component`,
      { waitUntil: 'networkidle' },
    )
    await page.locator('#group-usage-funding-component').scrollIntoViewIfNeeded()
    await page.getByRole('button', {
      name: 'Make a one-time contribution',
    }).click()
    await page.getByRole('button', {
      name: 'Personalize (optional)',
    }).click()
    await page.getByLabel('Send something fun to the group').check()
    await page.getByLabel('What should it be about?').fill(
      "Make this group’s theme song and use our latest running joke.",
    )
    await page.getByLabel('Genre or style reference').fill(
      'Warm ensemble-sitcom theme with a bright acoustic intro',
    )
    await page.getByRole('dialog').waitFor({ state: 'visible' })
    await page.screenshot({
      animations: 'disabled',
      fullPage: false,
      path: scenario.output,
    })
    await context.close()
  }
} finally {
  await browser.close()
}
