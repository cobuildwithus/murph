import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium } from "@playwright/test";

const DEFAULT_URL = "http://127.0.0.1:3000/pitch";
const DEFAULT_OUTPUT = ".artifacts/pitch/murph-pitch.pdf";
const PDF_WIDTH = "1600px";
const PDF_HEIGHT = "900px";
const DEFAULT_TIMEOUT_MS = 60_000;

interface ExportPitchPdfOptions {
  headed: boolean;
  outputPath: string;
  timeoutMs: number;
  url: string;
}

function readFlagValue(argv: readonly string[], flag: string): string | null {
  const prefixed = `${flag}=`;
  const inline = argv.find((arg) => arg.startsWith(prefixed));
  if (inline) {
    return inline.slice(prefixed.length);
  }

  const index = argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return argv[index + 1] ?? null;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${JSON.stringify(value)}.`);
  }

  return parsed;
}

function parseOptions(argv: readonly string[]): ExportPitchPdfOptions {
  const url = readFlagValue(argv, "--url") ?? DEFAULT_URL;
  const outputPath = path.resolve(readFlagValue(argv, "--out") ?? DEFAULT_OUTPUT);
  const timeoutMs = parsePositiveInteger(
    readFlagValue(argv, "--timeout-ms"),
    DEFAULT_TIMEOUT_MS,
  );

  return {
    headed: argv.includes("--headed"),
    outputPath,
    timeoutMs,
    url,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  await mkdir(path.dirname(options.outputPath), { recursive: true });

  const browser = await chromium.launch({ headless: !options.headed });
  try {
    const context = await browser.newContext({
      deviceScaleFactor: 1,
      viewport: { width: 1600, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs);
    page.setDefaultNavigationTimeout(options.timeoutMs);

    try {
      await page.goto(options.url, { waitUntil: "domcontentloaded" });
    } catch (error) {
      throw new Error(
        `Could not load ${options.url}. Start the hosted web dev server or pass --url to an accessible /pitch page.`,
        { cause: error },
      );
    }

    await page.locator("[data-pitch-deck]").waitFor();
    const slideCount = await page.locator("[data-pitch-slide]").count();
    if (slideCount === 0) {
      throw new Error("The /pitch page rendered without any pitch slides.");
    }

    await page.evaluate(async () => {
      if ("fonts" in document) {
        await document.fonts.ready;
      }
      await Promise.all(
        Array.from(document.images, (image) => {
          if (image.complete) {
            return Promise.resolve();
          }

          return new Promise<void>((resolve) => {
            image.addEventListener("load", () => resolve(), { once: true });
            image.addEventListener("error", () => resolve(), { once: true });
          });
        }),
      );
    });

    await page.emulateMedia({ media: "print", reducedMotion: "reduce" });
    await page.pdf({
      displayHeaderFooter: false,
      height: PDF_HEIGHT,
      margin: { bottom: 0, left: 0, right: 0, top: 0 },
      path: options.outputPath,
      preferCSSPageSize: true,
      printBackground: true,
      tagged: true,
      width: PDF_WIDTH,
    });

    const relativeOutputPath = path.relative(process.cwd(), options.outputPath);
    console.log(
      `Exported ${slideCount} pitch slides to ${relativeOutputPath || options.outputPath}.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Failed to export pitch PDF: ${message}`);
  process.exitCode = 1;
});
