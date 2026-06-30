import fs from "node:fs/promises";
import path from "node:path";

import Link from "next/link";

import { SiteFooter } from "@/src/components/homepage/site-footer";

interface HeadingBlock {
  level: 1 | 2 | 3;
  text: string;
  type: "heading";
}

interface ListBlock {
  items: string[];
  ordered: boolean;
  start?: number;
  type: "list";
}

interface ParagraphBlock {
  text: string;
  type: "paragraph";
}

interface TableBlock {
  header: string[];
  rows: string[][];
  type: "table";
}

export interface LegalPolicyPageProps {
  markdownFileName: LegalPolicyMarkdownFileName;
  pdfHref: string;
}

type MarkdownBlock = HeadingBlock | ListBlock | ParagraphBlock | TableBlock;
type LegalPolicyMarkdownFileName = keyof typeof LEGAL_POLICY_MARKDOWN_FILES;

const LEGAL_POLICY_MARKDOWN_FILES = {
  "consumer-health-data-notice.md": "consumer-health-data-notice.md",
  "consumer-health-data-privacy-policy.md": "consumer-health-data-privacy-policy.md",
  "health-ai-safety-disclosure.md": "health-ai-safety-disclosure.md",
  "legal-documents.md": "legal-documents.md",
  "privacy-policy.md": "privacy-policy.md",
  "subprocessors.md": "subprocessors.md",
  "terms-of-service.md": "terms-of-service.md",
} as const;

export async function LegalPolicyPage({
  markdownFileName,
  pdfHref,
}: LegalPolicyPageProps) {
  const markdown = await readLegalMarkdown(markdownFileName);
  const blocks = parseLegalPolicyMarkdown(markdown);

  return (
    <>
      <main className="min-h-screen bg-background px-6 py-12 antialiased sm:px-10 lg:px-16">
        <article className="mx-auto max-w-2xl">
          <div className="mb-10 flex items-center justify-between border-b border-border pb-5">
            <Link
              href="/"
              className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-muted-foreground transition-colors hover:text-foreground"
            >
              Murph
            </Link>
            <a
              href={pdfHref}
              className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-primary transition-colors hover:text-foreground"
            >
              Download PDF
            </a>
          </div>
          <div className="space-y-5">{blocks.map(renderBlock)}</div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

export function parseLegalPolicyMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let listStart = 1;
  let tableRows: string[][] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      blocks.push({ text, type: "paragraph" });
    }
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }

    blocks.push({
      items: listItems,
      ordered: listOrdered,
      start: listOrdered ? listStart : undefined,
      type: "list",
    });
    listItems = [];
    listOrdered = false;
    listStart = 1;
  };

  const flushTable = () => {
    if (tableRows.length === 0) {
      return;
    }

    const [firstRow, secondRow, ...remainingRows] = tableRows;
    if (firstRow && secondRow && isTableSeparatorRow(secondRow)) {
      blocks.push({
        header: firstRow,
        rows: remainingRows,
        type: "table",
      });
    } else {
      blocks.push({
        header: [],
        rows: tableRows,
        type: "table",
      });
    }
    tableRows = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      flushParagraph();
      flushList();
      flushTable();
      continue;
    }

    if (isTableLine(trimmed)) {
      flushParagraph();
      flushList();
      tableRows.push(splitTableRow(trimmed));
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      flushTable();
      blocks.push({
        level: Math.min(headingMatch[1].length, 3) as 1 | 2 | 3,
        text: headingMatch[2],
        type: "heading",
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^-\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      flushTable();
      if (listItems.length > 0 && listOrdered) {
        flushList();
      }
      listOrdered = false;
      listItems.push(bulletMatch[1]);
      continue;
    }

    const orderedListMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedListMatch) {
      flushParagraph();
      flushTable();
      if (listItems.length > 0 && !listOrdered) {
        flushList();
      }
      if (listItems.length === 0) {
        listStart = Number.parseInt(orderedListMatch[1], 10);
      }
      listOrdered = true;
      listItems.push(orderedListMatch[2]);
      continue;
    }

    flushList();
    flushTable();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushTable();

  return blocks;
}

async function readLegalMarkdown(fileName: LegalPolicyMarkdownFileName): Promise<string> {
  const knownFileName = LEGAL_POLICY_MARKDOWN_FILES[fileName];
  const packageLocalPath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "legal",
    knownFileName,
  );

  try {
    return await fs.readFile(packageLocalPath, "utf8");
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }
  }

  return await fs.readFile(
    path.join(
      /* turbopackIgnore: true */ process.cwd(),
      "apps/web/legal",
      knownFileName,
    ),
    "utf8",
  );
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isTableLine(line: string): boolean {
  return line.startsWith("|") && line.endsWith("|") && line.includes("|");
}

function splitTableRow(line: string): string[] {
  return line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

function isTableSeparatorRow(row: string[]): boolean {
  return row.length > 0 && row.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderBlock(block: MarkdownBlock, index: number) {
  if (block.type === "heading") {
    if (block.level === 1) {
      return (
        <h1
          key={`${block.type}-${index}`}
          className="font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground"
        >
          {renderInline(block.text)}
        </h1>
      );
    }

    if (block.level === 2) {
      return (
        <h2
          key={`${block.type}-${index}`}
          className="pt-6 font-serif text-xl font-semibold leading-snug tracking-tight text-foreground"
        >
          {renderInline(block.text)}
        </h2>
      );
    }

    return (
      <h3
        key={`${block.type}-${index}`}
        className="pt-2 text-[15px] font-semibold text-foreground"
      >
        {renderInline(block.text)}
      </h3>
    );
  }

  if (block.type === "list") {
    const listClassName =
      "ml-5 space-y-1.5 text-[15px] leading-relaxed text-muted-foreground";

    if (block.ordered) {
      return (
        <ol
          key={`${block.type}-${index}`}
          className={`${listClassName} list-decimal`}
          start={block.start}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`${index}-${itemIndex}`}>{renderInline(item)}</li>
          ))}
        </ol>
      );
    }

    return (
      <ul
        key={`${block.type}-${index}`}
        className={`${listClassName} list-disc`}
      >
        {block.items.map((item, itemIndex) => (
          <li key={`${index}-${itemIndex}`}>{renderInline(item)}</li>
        ))}
      </ul>
    );
  }

  if (block.type === "table") {
    return (
      <div
        key={`${block.type}-${index}`}
        className="overflow-x-auto rounded-md border border-border"
      >
        <table className="min-w-full border-collapse text-left text-[13px]">
          {block.header.length > 0 ? (
            <thead className="bg-muted text-foreground">
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th
                    key={`${index}-header-${cellIndex}`}
                    className="border-b border-border px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.11em]"
                    scope="col"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody className="divide-y divide-border">
            {block.rows.map((row, rowIndex) => (
              <tr key={`${index}-row-${rowIndex}`} className="align-top">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${index}-row-${rowIndex}-${cellIndex}`}
                    className="px-3 py-2 leading-relaxed text-muted-foreground"
                  >
                    {renderInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <p
      key={`${block.type}-${index}`}
      className="text-[15px] leading-relaxed text-muted-foreground"
    >
      {renderInline(block.text)}
    </p>
  );
}

function renderInline(text: string) {
  const segments = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g);

  return segments.map((segment, index) => {
    const linkMatch = segment.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`${segment}-${index}`}
          href={linkMatch[2]}
          className="text-primary underline underline-offset-4 transition-colors hover:text-foreground"
        >
          {linkMatch[1]}
        </a>
      );
    }

    const strongMatch = segment.match(/^\*\*([^*]+)\*\*$/);
    if (strongMatch) {
      return (
        <strong key={`${segment}-${index}`} className="font-semibold text-foreground">
          {strongMatch[1]}
        </strong>
      );
    }

    const codeMatch = segment.match(/^`([^`]+)`$/);
    if (codeMatch) {
      return (
        <code
          key={`${segment}-${index}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {codeMatch[1]}
        </code>
      );
    }

    return segment;
  });
}
