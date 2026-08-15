#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN_X = 54;
const MARGIN_TOP = 54;
const MARGIN_BOTTOM = 54;
const TEXT_WIDTH = PAGE_WIDTH - (MARGIN_X * 2);

type FontName = "F1" | "F2";
type BlockType = "h1" | "h2" | "h3" | "p" | "bullet" | "numbered";

interface DocumentSpec {
  aliases?: string[];
  effectiveDate: string;
  id: string;
  input: string;
  lastUpdated: string;
  latestOutput: string;
  slug: string;
  title: string;
  version: string;
}

interface GeneratedDocument {
  aliases: ManifestFile[];
  effectiveDate: string;
  id: string;
  latest: ManifestFile;
  lastUpdated: string;
  source: string;
  title: string;
  version: string;
  versions: ManifestFile[];
}

interface ManifestFile {
  bytes: number;
  path: string;
  sha256: string;
}

interface Style {
  after: number;
  before: number;
  font: FontName;
  lineHeight: number;
  size: number;
}

interface TextBlock {
  text: string;
  type: Exclude<BlockType, "bullet" | "numbered">;
}

interface ListBlock {
  marker: string;
  text: string;
  type: Extract<BlockType, "bullet" | "numbered">;
}

type Block = TextBlock | ListBlock;

interface RenderPdfInput {
  blocks: Block[];
  title: string;
}

interface WriteLineInput {
  font: FontName;
  size: number;
  text: string;
  x: number;
  yPosition: number;
}

const DOCUMENTS = [
  {
    effectiveDate: "2026-04-09",
    id: "privacy-policy",
    input: "apps/web/legal/privacy-policy.md",
    lastUpdated: "2026-07-23",
    latestOutput: "apps/web/public/legal/privacy.pdf",
    slug: "privacy",
    title: "Murph Privacy Policy",
    version: "2026-07-23",
  },
  {
    effectiveDate: "2026-07-23",
    id: "terms-of-service",
    input: "apps/web/legal/terms-of-service.md",
    lastUpdated: "2026-07-23",
    latestOutput: "apps/web/public/legal/terms.pdf",
    slug: "terms",
    title: "Murph Terms of Service",
    version: "2026-07-23",
  },
  {
    aliases: ["apps/web/public/legal/consumer-health-data-privacy.pdf"],
    effectiveDate: "2026-04-29",
    id: "consumer-health-data-notice",
    input: "apps/web/legal/consumer-health-data-notice.md",
    lastUpdated: "2026-07-23",
    latestOutput: "apps/web/public/legal/consumer-health-data-notice.pdf",
    slug: "consumer-health-data-notice",
    title: "Murph Consumer Health Data Notice",
    version: "2026-07-23",
  },
  {
    effectiveDate: "2026-04-29",
    id: "health-ai-safety-disclosure",
    input: "apps/web/legal/health-ai-safety-disclosure.md",
    lastUpdated: "2026-07-23",
    latestOutput: "apps/web/public/legal/health-ai-safety-disclosure.pdf",
    slug: "health-ai-safety-disclosure",
    title: "Murph Health AI Safety Disclosure",
    version: "2026-07-23",
  },
  {
    effectiveDate: "2026-04-29",
    id: "subprocessors",
    input: "apps/web/legal/subprocessors.md",
    lastUpdated: "2026-08-12",
    latestOutput: "apps/web/public/legal/subprocessors.pdf",
    slug: "subprocessors",
    title: "Murph Subprocessors, Model Providers, and Connected Services",
    version: "2026-08-12",
  },
  {
    effectiveDate: "2026-04-29",
    id: "legal-documents",
    input: "apps/web/legal/legal-documents.md",
    lastUpdated: "2026-08-12",
    latestOutput: "apps/web/public/legal/legal-documents.pdf",
    slug: "legal-documents",
    title: "Murph Legal Documents",
    version: "2026-08-12",
  },
] satisfies DocumentSpec[];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");

const STYLES: Record<BlockType, Style> = {
  h1: { after: 8, before: 0, font: "F2", lineHeight: 24, size: 19 },
  h2: { after: 6, before: 10, font: "F2", lineHeight: 18, size: 14 },
  h3: { after: 4, before: 8, font: "F2", lineHeight: 15, size: 11 },
  p: { after: 4, before: 0, font: "F1", lineHeight: 14, size: 10 },
  bullet: { after: 2, before: 0, font: "F1", lineHeight: 14, size: 10 },
  numbered: { after: 2, before: 0, font: "F1", lineHeight: 14, size: 10 },
};

function main() {
  const generatedDocuments: GeneratedDocument[] = [];

  for (const document of DOCUMENTS) {
    const inputPath = path.resolve(repoRoot, document.input);
    const markdown = fs.readFileSync(inputPath, "utf8");
    const blocks = parseMarkdown(markdown);
    const pdf = renderPdf({
      blocks,
      title: document.title,
    });
    const latest = writePdfFile(document.latestOutput, pdf);
    const versionedOutput = buildVersionedOutputPath(document);
    const versioned = writePdfFile(versionedOutput, pdf);
    const aliases = (document.aliases ?? []).map((alias) => writePdfFile(alias, pdf));

    generatedDocuments.push({
      aliases,
      effectiveDate: document.effectiveDate,
      id: document.id,
      latest,
      lastUpdated: document.lastUpdated,
      source: toPublicManifestPath(document.input),
      title: document.title,
      version: document.version,
      versions: [versioned],
    });
  }

  writeManifest(generatedDocuments);
}

function writePdfFile(relativeOutputPath: string, pdf: string): ManifestFile {
  const outputPath = path.resolve(repoRoot, relativeOutputPath);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, pdf);
  return describeManifestFile(relativeOutputPath);
}

function buildVersionedOutputPath(document: DocumentSpec): string {
  return `apps/web/public/legal/${document.slug}-${document.version}.pdf`;
}

function writeManifest(documents: GeneratedDocument[]) {
  const manifest = {
    schema: "murph.legal-document-manifest.v1",
    generatedBy: "apps/web/scripts/generate-legal-pdfs.ts",
    documents,
  };
  const outputPath = path.resolve(repoRoot, "apps/web/public/legal/manifest.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function describeManifestFile(relativePath: string): ManifestFile {
  const filePath = path.resolve(repoRoot, relativePath);
  const bytes = fs.readFileSync(filePath);

  return {
    bytes: bytes.byteLength,
    path: toPublicManifestPath(relativePath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function toPublicManifestPath(relativePath: string): string {
  const publicPrefix = "apps/web/public";
  return relativePath.startsWith(publicPrefix)
    ? relativePath.slice(publicPrefix.length)
    : relativePath;
}

function parseMarkdown(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let tableHeader: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    const text = normalizeInline(paragraph.join(" "));
    if (text.length > 0) {
      blocks.push({ text, type: "p" });
    }
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      tableHeader = null;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      tableHeader = null;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      tableHeader = null;
      const level = headingMatch[1].length;
      blocks.push({
        text: normalizeInline(headingMatch[2]),
        type: level === 1 ? "h1" : level === 2 ? "h2" : "h3",
      });
      continue;
    }

    if (isMarkdownTableLine(trimmed)) {
      flushParagraph();
      const cells = splitMarkdownTableRow(trimmed);
      if (isMarkdownTableSeparatorRow(cells)) {
        continue;
      }
      if (!tableHeader) {
        tableHeader = cells;
        continue;
      }
      blocks.push({
        text: normalizeInline(formatMarkdownTableRowForPdf(tableHeader, cells)),
        type: "p",
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      tableHeader = null;
      blocks.push({
        marker: "-",
        text: normalizeInline(bulletMatch[1]),
        type: "bullet",
      });
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (numberedMatch) {
      flushParagraph();
      tableHeader = null;
      blocks.push({
        marker: `${numberedMatch[1]}.`,
        text: normalizeInline(numberedMatch[2]),
        type: "numbered",
      });
      continue;
    }

    tableHeader = null;
    paragraph.push(trimmed);
  }

  flushParagraph();
  return blocks;
}

function isMarkdownTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.includes("|");
}

function splitMarkdownTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isMarkdownTableSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));
}

function formatMarkdownTableRowForPdf(
  header: readonly string[],
  cells: readonly string[],
): string {
  if (header.length !== cells.length) {
    return cells.join(" | ");
  }

  return cells.map((cell, index) => `${header[index]}: ${cell}`).join("; ");
}

function normalizeInline(text: string): string {
  return normalizePdfText(
    text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function normalizePdfText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "");
}

function renderPdf({ blocks, title }: RenderPdfInput): string {
  const pages: string[][] = [];
  let currentPage: string[] = [];
  let y = PAGE_HEIGHT - MARGIN_TOP;

  const startPage = () => {
    currentPage = [];
    pages.push(currentPage);
    y = PAGE_HEIGHT - MARGIN_TOP;
  };

  const ensurePage = (requiredHeight: number) => {
    if (pages.length === 0) {
      startPage();
      return;
    }
    if (y - requiredHeight < MARGIN_BOTTOM) {
      startPage();
    }
  };

  const writeLine = ({ font, size, text, x, yPosition }: WriteLineInput) => {
    currentPage.push(
      `BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${yPosition.toFixed(2)} Tm (${escapePdfString(text)}) Tj ET`,
    );
  };

  for (const block of blocks) {
    const style = STYLES[block.type];
    const isList = block.type === "bullet" || block.type === "numbered";
    const marker = isList ? `${block.marker} ` : "";
    const textIndent = isList ? 18 : 0;
    const maxWidth = TEXT_WIDTH - textIndent;
    const wrapped = wrapText(block.text, style.size, maxWidth);
    const lineCount = Math.max(1, wrapped.length);
    const requiredHeight = style.before + (lineCount * style.lineHeight) + style.after;

    ensurePage(requiredHeight);
    y -= style.before;

    if (isList) {
      writeLine({
        font: style.font,
        size: style.size,
        text: marker.trimEnd(),
        x: MARGIN_X,
        yPosition: y,
      });
    }

    wrapped.forEach((line, index) => {
      writeLine({
        font: style.font,
        size: style.size,
        text: line,
        x: MARGIN_X + textIndent,
        yPosition: y - (index * style.lineHeight),
      });
    });

    y -= lineCount * style.lineHeight;
    y -= style.after;
  }

  return buildPdfDocument({ pages, title });
}

function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`;
    if (measureText(candidate, fontSize) <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    if (currentLine.length > 0) {
      lines.push(currentLine);
      currentLine = word;
      continue;
    }

    lines.push(word);
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function measureText(text: string, fontSize: number): number {
  let units = 0;
  for (const character of text) {
    if (character === " ") {
      units += 0.28;
    } else if ("il.,;:!'|".includes(character)) {
      units += 0.26;
    } else if ("mwMW@#%&".includes(character)) {
      units += 0.9;
    } else if (/[A-Z]/.test(character)) {
      units += 0.68;
    } else if (/[0-9]/.test(character)) {
      units += 0.56;
    } else {
      units += 0.54;
    }
  }
  return units * fontSize;
}

function buildPdfDocument({ pages, title }: { pages: string[][]; title: string }): string {
  const objects: string[] = [];

  const addObject = (body: string): number => {
    objects.push(body);
    return objects.length;
  };

  const fontRegular = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  const contentRefs = pages.map((commands: string[]) => {
    const stream = commands.join("\n");
    return addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
  });

  const pageRefs = contentRefs.map((contentRef: number) =>
    addObject(
      `<< /Type /Page /Parent {{PAGES}} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentRef} 0 R >>`,
    ),
  );

  const pagesBody = `<< /Type /Pages /Count ${pageRefs.length} /Kids [${pageRefs.map((ref) => `${ref} 0 R`).join(" ")}] >>`;
  const pagesRef = addObject(pagesBody);

  for (let index = 0; index < pageRefs.length; index += 1) {
    objects[pageRefs[index] - 1] = objects[pageRefs[index] - 1].replace("{{PAGES}}", String(pagesRef));
  }

  const infoRef = addObject(
    `<< /Title (${escapePdfString(normalizePdfText(title))}) /Producer (Murph legal PDF generator) /Creator (apps/web/scripts/generate-legal-pdfs.ts) >>`,
  );
  const catalogRef = addObject(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`);

  let output = "%PDF-1.4\n";
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, "utf8"));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(output, "utf8");
  output += `xref\n0 ${objects.length + 1}\n`;
  output += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogRef} 0 R /Info ${infoRef} 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n%%EOF\n`;

  return output;
}

function escapePdfString(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

main();
