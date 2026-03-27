const fs = require("node:fs");
const path = require("node:path");

const ts = require("typescript");

const EXTENSION_CANDIDATES = {
  ".js": [".ts", ".tsx", ".js"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

module.exports = function rewriteRelativeJsImports(source) {
  if (typeof source !== "string" || source.length === 0) {
    return source;
  }

  const resourcePath = typeof this.resourcePath === "string" ? this.resourcePath : "source.ts";
  const sourceFile = ts.createSourceFile(
    resourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(resourcePath),
  );
  const replacements = [];

  visit(sourceFile);

  if (replacements.length === 0) {
    return source;
  }

  replacements.sort((left, right) => right.start - left.start);

  let rewritten = source;
  for (const replacement of replacements) {
    rewritten =
      rewritten.slice(0, replacement.start) +
      replacement.text +
      rewritten.slice(replacement.end);
  }

  return rewritten;

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      maybeQueueReplacement(node.moduleSpecifier);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1
    ) {
      maybeQueueReplacement(node.arguments[0]);
    }

    ts.forEachChild(node, visit);
  }

  function maybeQueueReplacement(moduleSpecifier) {
    if (!moduleSpecifier || !ts.isStringLiteralLike(moduleSpecifier)) {
      return;
    }

    const rewrittenSpecifier = resolveRelativeSourceImport(resourcePath, moduleSpecifier.text);
    if (!rewrittenSpecifier || rewrittenSpecifier === moduleSpecifier.text) {
      return;
    }

    replacements.push({
      start: moduleSpecifier.getStart(sourceFile) + 1,
      end: moduleSpecifier.getEnd() - 1,
      text: rewrittenSpecifier,
    });
  }
};

function resolveRelativeSourceImport(resourcePath, specifier) {
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) {
    return null;
  }

  const parsed = parseRelativeSourceSpecifier(specifier);
  if (!parsed) {
    return null;
  }

  const resourceDir = path.dirname(resourcePath);
  const absoluteBasePath = path.resolve(resourceDir, parsed.basePath);
  const candidateExtensions = EXTENSION_CANDIDATES[parsed.importExtension];

  for (const candidateExtension of candidateExtensions) {
    const candidatePath = `${absoluteBasePath}${candidateExtension}`;
    if (!fs.existsSync(candidatePath)) {
      continue;
    }

    return `${parsed.basePath}${candidateExtension}`;
  }

  return null;
}

function parseRelativeSourceSpecifier(specifier) {
  for (const importExtension of Object.keys(EXTENSION_CANDIDATES)) {
    if (!specifier.endsWith(importExtension)) {
      continue;
    }

    return {
      basePath: specifier.slice(0, -importExtension.length),
      importExtension,
    };
  }

  return null;
}

function getScriptKind(resourcePath) {
  if (resourcePath.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }

  if (resourcePath.endsWith(".jsx")) {
    return ts.ScriptKind.JSX;
  }

  return ts.ScriptKind.TS;
}
