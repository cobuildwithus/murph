import { describe, expect, it } from "vitest";

import {
  parseFrontmatterDocument,
  parseFrontmatterScalar,
  type FrontmatterParseProblem,
  type FrontmatterValue,
} from "../src/frontmatter.ts";

class TaggedFrontmatterError extends Error {
  constructor(readonly problem: FrontmatterParseProblem) {
    super(`frontmatter:${problem.code}`);
    this.name = "TaggedFrontmatterError";
  }
}

describe("parseFrontmatterScalar", () => {
  it("parses the supported scalar shorthands and JSON-quoted strings", () => {
    expect(parseFrontmatterScalar("null")).toBeNull();
    expect(parseFrontmatterScalar("true")).toBe(true);
    expect(parseFrontmatterScalar("false")).toBe(false);
    expect(parseFrontmatterScalar("[]")).toEqual([]);
    expect(parseFrontmatterScalar("{}")).toEqual({});
    expect(parseFrontmatterScalar("42")).toBe(42);
    expect(parseFrontmatterScalar("-3.5")).toBe(-3.5);
    expect(parseFrontmatterScalar("\"line\\nbreak\"")).toBe("line\nbreak");
  });

  it("leaves unsupported numeric and boolean-looking values as strings", () => {
    expect(parseFrontmatterScalar("TRUE")).toBe("TRUE");
    expect(parseFrontmatterScalar("1e3")).toBe("1e3");
    expect(parseFrontmatterScalar("01")).toBe(1);
    expect(parseFrontmatterScalar("plain text")).toBe("plain text");
  });
});

describe("parseFrontmatterDocument", () => {
  it("parses nested objects and arrays while normalizing CRLF input", () => {
    expect(
      parseFrontmatterDocument(
        [
          "---",
          "title: \"Hello\\nWorld\"",
          "count: 2",
          "published: false",
          "tags:",
          "  - alpha",
          "  - 3",
          "details:",
          "  nested: true",
          "---",
          "",
          "Body line",
        ].join("\r\n"),
      ),
    ).toEqual({
      attributes: {
        title: "Hello\nWorld",
        count: 2,
        published: false,
        tags: ["alpha", 3],
        details: {
          nested: true,
        },
      },
      body: "\nBody line",
      rawFrontmatter: [
        "title: \"Hello\\nWorld\"",
        "count: 2",
        "published: false",
        "tags:",
        "  - alpha",
        "  - 3",
        "details:",
        "  nested: true",
      ].join("\n"),
    });
  });

  it("uses body normalization for both plain documents and tolerant fallbacks", () => {
    expect(
      parseFrontmatterDocument("  plain body  \n", {
        bodyNormalization: "trim",
      }),
    ).toEqual({
      attributes: {},
      body: "plain body",
      rawFrontmatter: null,
    });

    expect(
      parseFrontmatterDocument(
        ["---", "title broken", "---", "", "  kept body  "].join("\n"),
        {
          mode: "tolerant",
          bodyNormalization: "trim",
        },
      ),
    ).toEqual({
      attributes: {},
      body: "---\ntitle broken\n---\n\n  kept body",
      rawFrontmatter: null,
    });
  });

  it("supports skipping ignorable frontmatter lines", () => {
    expect(
      parseFrontmatterDocument(
        ["---", "# generated comment", "", "# another comment", "---", "", "Body"].join("\n"),
        {
          bodyNormalization: "trim",
          isIgnorableLine: (line) => line.startsWith("#"),
        },
      ),
    ).toEqual({
      attributes: {},
      body: "Body",
      rawFrontmatter: "# generated comment\n\n# another comment",
    });
  });

  it("allows same-indent arrays only when the option is enabled", () => {
    const documentText = ["---", "items:", "- first", "- second", "---"].join("\n");

    expect(
      parseFrontmatterDocument(documentText, {
        allowSameIndentArrayItems: true,
      }),
    ).toEqual({
      attributes: {
        items: ["first", "second"],
      },
      body: "",
      rawFrontmatter: "items:\n- first\n- second",
    });

    expect(() =>
      parseFrontmatterDocument(documentText, {
        createError: (problem) => new TaggedFrontmatterError(problem),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TaggedFrontmatterError",
        problem: expect.objectContaining({
          code: "unexpected_trailing_content",
          index: 1,
          line: "- first",
        }),
      }),
    );
  });

  it("delegates scalar parsing through the provided parseScalar option", () => {
    const parseScalar = (value: string): FrontmatterValue =>
      value.startsWith("date(")
        ? { tagged: value.slice(5, -1) }
        : parseFrontmatterScalar(value);

    expect(
      parseFrontmatterDocument(["---", "when: date(2026-04-08)", "count: 2", "---"].join("\n"), {
        parseScalar,
      }),
    ).toEqual({
      attributes: {
        when: {
          tagged: "2026-04-08",
        },
        count: 2,
      },
      body: "",
      rawFrontmatter: "when: date(2026-04-08)\ncount: 2",
    });
  });

  it("throws strict tagged errors for malformed indentation and missing delimiters", () => {
    expect(() =>
      parseFrontmatterDocument(["---", "parent:", " child: 1", "---"].join("\n"), {
        createError: (problem) => new TaggedFrontmatterError(problem),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TaggedFrontmatterError",
        problem: expect.objectContaining({
          code: "unexpected_nested_object_indentation",
          index: 1,
          line: " child: 1",
        }),
      }),
    );

    expect(() =>
      parseFrontmatterDocument(["---", "items:", "  - first", "    - second", "---"].join("\n"), {
        createError: (problem) => new TaggedFrontmatterError(problem),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TaggedFrontmatterError",
        problem: expect.objectContaining({
          code: "unexpected_array_indentation",
          index: 2,
          line: "    - second",
        }),
      }),
    );

    expect(() =>
      parseFrontmatterDocument(["---", "title: Example"].join("\n"), {
        createError: (problem) => new TaggedFrontmatterError(problem),
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "TaggedFrontmatterError",
        problem: expect.objectContaining({
          code: "missing_closing_delimiter",
        }),
      }),
    );
  });

  it("falls back cleanly in tolerant mode for malformed frontmatter", () => {
    expect(
      parseFrontmatterDocument(["---", "parent:", " child: 1", "---", "", "Body"].join("\n"), {
        mode: "tolerant",
        bodyNormalization: "trim",
      }),
    ).toEqual({
      attributes: {},
      body: "---\nparent:\n child: 1\n---\n\nBody",
      rawFrontmatter: null,
    });

    expect(
      parseFrontmatterDocument(["---", "title: Example"].join("\n"), {
        mode: "tolerant",
        bodyNormalization: "trim",
      }),
    ).toEqual({
      attributes: {},
      body: "---\ntitle: Example",
      rawFrontmatter: null,
    });
  });
});
