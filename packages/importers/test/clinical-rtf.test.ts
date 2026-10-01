import { describe, expect, it } from "vitest";
import { readClinicalAttachmentText } from "../src/clinical-records/index.ts";

const read = (source: string) => readClinicalAttachmentText(Buffer.from(source, "latin1"), "application/rtf");

describe("clinical RTF evidence", () => {
  it("preserves escaped punctuation, Unicode and visible field results", () => {
    expect(read(String.raw`{\rtf1\ansi\ansicpg1252 A\'e9 \{finding\} \\ \uc1\u946?\tab value\par next}`))
      .toBe("Aé {finding} \\ β\tvalue\nnext");
  });

  it("ignores destinations, objects and hidden text without executing source commands", () => {
    expect(read(String.raw`{\rtf1{\fonttbl{\f0 Hidden;}}{\*\unknown \v0 hidden}{\object forbidden}{\pict 00ff}visible \v hidden\v0 shown}`))
      .toBe("visible shown");
  });

  it.each([
    "plain content", String.raw`{\rtf1 truncated`, String.raw`{\rtf1 text}}`,
    String.raw`{\rtf1\ansicpg932 unsupported}`, String.raw`{\rtf1\bin100 short}`,
    String.raw`{\rtf1\uc99\u123?}`, String.raw`{\rtf1\u999999?}`,
    String.raw`{\rtf1\upr unsupported}`, String.raw`{\rtf1\strike changed meaning}`, "{\\rtf1" + "{".repeat(129) + "}".repeat(130),
  ])("holds malformed or unsupported source %#", (source) => {
    expect(read(source)).toBeUndefined();
  });
});
