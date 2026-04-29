import fs from "node:fs/promises";
import path from "node:path";

import Link from "next/link";

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
  markdownFileName: string;
  pdfHref: string;
}

type MarkdownBlock = HeadingBlock | ListBlock | ParagraphBlock | TableBlock;

export async function LegalPolicyPage({
  markdownFileName,
  pdfHref,
}: LegalPolicyPageProps) {
  const markdown = await readLegalMarkdown(markdownFileName);
  const blocks = parseLegalPolicyMarkdown(markdown);

  return (
    <main className="min-h-screen bg-[#f5f0e8] px-6 py-10 text-[#2d3436] antialiased sm:px-10 lg:px-16">
      <article className="mx-auto max-w-3xl rounded-lg border border-[#c4a882]/25 bg-[#fffcf6]/90 px-6 py-8 sm:px-10 sm:py-12">
        <div className="mb-8 flex flex-col gap-3 border-b border-[#c4a882]/25 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="text-[0.75rem] font-semibold uppercase text-[#736a58] transition-colors hover:text-[#2d3436]"
          >
            Murph
          </Link>
          <a
            href={pdfHref}
            className="text-[0.75rem] font-semibold uppercase text-[#5a6e32] transition-colors hover:text-[#2d3436]"
          >
            Download PDF
          </a>
        </div>
        <div className="space-y-5">{blocks.map(renderBlock)}</div>
      </article>
    </main>
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

async function readLegalMarkdown(fileName: string): Promise<string> {
  const candidates = [
    path.resolve(process.cwd(), "apps/web/legal", fileName),
    path.resolve(process.cwd(), "legal", fileName),
  ];
  let lastError: unknown;

  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error(`Unable to read legal policy markdown: ${fileName}`);
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
          className="font-serif text-4xl leading-tight text-[#2d3436] sm:text-5xl"
        >
          {renderInline(block.text)}
        </h1>
      );
    }

    if (block.level === 2) {
      return (
        <h2
          key={`${block.type}-${index}`}
          className="pt-5 font-serif text-2xl leading-tight text-[#2d3436]"
        >
          {renderInline(block.text)}
        </h2>
      );
    }

    return (
      <h3
        key={`${block.type}-${index}`}
        className="pt-2 text-base font-semibold text-[#2d3436]"
      >
        {renderInline(block.text)}
      </h3>
    );
  }

  if (block.type === "list") {
    const listClassName =
      "ml-5 space-y-2 text-[0.9375rem] leading-7 text-[#4d4533]";

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
        className="overflow-x-auto border border-[#c4a882]/25"
      >
        <table className="min-w-full border-collapse text-left text-[0.8125rem]">
          {block.header.length > 0 ? (
            <thead className="bg-[#c4a882]/10 text-[#2d3436]">
              <tr>
                {block.header.map((cell, cellIndex) => (
                  <th
                    key={`${index}-header-${cellIndex}`}
                    className="border-b border-[#c4a882]/25 px-3 py-2 font-semibold"
                    scope="col"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody className="divide-y divide-[#c4a882]/20">
            {block.rows.map((row, rowIndex) => (
              <tr key={`${index}-row-${rowIndex}`} className="align-top">
                {row.map((cell, cellIndex) => (
                  <td
                    key={`${index}-row-${rowIndex}-${cellIndex}`}
                    className="px-3 py-2 leading-relaxed text-[#4d4533]"
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
      className="text-[0.9375rem] leading-7 text-[#4d4533]"
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
          className="font-semibold text-[#5a6e32] underline-offset-4 transition-colors hover:text-[#2d3436] hover:underline"
        >
          {linkMatch[1]}
        </a>
      );
    }

    const strongMatch = segment.match(/^\*\*([^*]+)\*\*$/);
    if (strongMatch) {
      return (
        <strong key={`${segment}-${index}`} className="font-semibold text-[#2d3436]">
          {strongMatch[1]}
        </strong>
      );
    }

    const codeMatch = segment.match(/^`([^`]+)`$/);
    if (codeMatch) {
      return (
        <code
          key={`${segment}-${index}`}
          className="rounded bg-[#c4a882]/15 px-1 py-0.5 font-mono text-[0.85em]"
        >
          {codeMatch[1]}
        </code>
      );
    }

    return segment;
  });
}
