import type { ParseRequest, ProviderRunResult } from "../contracts/parse.js";
import type { ParserProvider } from "../contracts/provider.js";
import {
  buildMarkdown,
  describeExecutableAvailability,
  readConfiguredEnvValue,
  requireExecutable,
  resolveConfiguredExecutable,
  runCommand,
  splitTextIntoBlocks,
} from "../shared.js";

export interface PdfToTextProviderOptions {
  commandCandidates?: string[];
  extraArgs?: string[];
}

export function createPdfToTextProvider(
  options: PdfToTextProviderOptions = {},
): ParserProvider {
  async function resolveCommand(): Promise<string | null> {
    return resolveConfiguredExecutable({
      explicitCandidates: options.commandCandidates,
      envValue: () => readConfiguredEnvValue(process.env, ["PDFTOTEXT_COMMAND", "HEALTHYBOB_PDFTOTEXT_COMMAND"]),
      fallbackCommands: ["pdftotext"],
    });
  }

  return {
    id: "pdftotext",
    locality: "local",
    openness: "open_source",
    runtime: "cli",
    priority: 850,
    async discover() {
      const command = await resolveCommand();
      return describeExecutableAvailability({
        executablePath: command,
        availableReason: "pdftotext CLI available.",
        missingReason: "pdftotext CLI not found.",
      });
    },
    supports(request: ParseRequest) {
      const kind = request.preparedKind ?? request.artifact.kind;
      if (kind !== "document") {
        return false;
      }

      const fileName = request.artifact.fileName?.toLowerCase() ?? "";
      const mime = request.artifact.mime?.toLowerCase() ?? "";
      return fileName.endsWith(".pdf") || mime === "application/pdf";
    },
    async run(request): Promise<ProviderRunResult> {
      const command = requireExecutable(await resolveCommand(), "pdftotext CLI not found.");

      const result = await runCommand(command, [
        "-layout",
        "-enc",
        "UTF-8",
        ...(options.extraArgs ?? []),
        request.inputPath,
        "-",
      ]);
      const text = result.stdout.trim();
      if (!text) {
        throw new TypeError("pdftotext did not produce extractable text.");
      }

      const blocks = splitTextIntoBlocks(text, { defaultKind: "paragraph" });
      const pageCount = text.split(/\f/u).filter((segment) => segment.trim().length > 0).length || null;

      return {
        text,
        markdown: buildMarkdown(text, blocks),
        blocks,
        metadata: {
          pageCount,
        },
      };
    },
  };
}
