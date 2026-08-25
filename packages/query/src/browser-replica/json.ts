export interface CooperativeJsonStringifyOptions {
  signal?: AbortSignal;
  sortKeys?: boolean;
}

interface JsonExitAction {
  kind: "exit";
  value: object;
}

interface JsonTextAction {
  kind: "text";
  value: string;
}

interface JsonValueAction {
  kind: "value";
  location: "array" | "root";
  value: unknown;
}

type JsonStringifyAction = JsonExitAction | JsonTextAction | JsonValueAction;

const JSON_CHUNK_TARGET_CHARS = 16 * 1_024;

export async function stringifyJsonCooperatively(
  value: unknown,
  options: CooperativeJsonStringifyOptions = {},
): Promise<string> {
  const activeObjects = new Set<object>();
  const chunks: string[] = [];
  const stack: JsonStringifyAction[] = [{
    kind: "value",
    location: "root",
    value,
  }];
  let visited = 0;

  while (stack.length > 0) {
    options.signal?.throwIfAborted();
    visited += 1;
    if (options.signal && visited % 512 === 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      options.signal.throwIfAborted();
    }

    const action = stack.pop();
    if (!action) {
      continue;
    }
    if (action.kind === "text") {
      appendJsonChunk(chunks, action.value);
      continue;
    }
    if (action.kind === "exit") {
      activeObjects.delete(action.value);
      continue;
    }

    const current = action.value;
    if (current === null || typeof current !== "object") {
      const encoded = JSON.stringify(current);
      if (encoded === undefined) {
        if (action.location === "array") {
          appendJsonChunk(chunks, "null");
          continue;
        }
        throw new TypeError("Browser Vault replica values must be JSON serializable.");
      }
      appendJsonChunk(chunks, encoded);
      continue;
    }

    if (activeObjects.has(current)) {
      throw new TypeError("Browser Vault replica values must not contain cycles.");
    }
    activeObjects.add(current);
    stack.push({ kind: "exit", value: current });

    if (Array.isArray(current)) {
      stack.push({ kind: "text", value: "]" });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        stack.push({
          kind: "value",
          location: "array",
          value: current[index],
        });
        if (index > 0) {
          stack.push({ kind: "text", value: "," });
        }
      }
      stack.push({ kind: "text", value: "[" });
      continue;
    }

    const entries = Object.entries(current)
      .filter((entry) => !isOmittedJsonObjectValue(entry[1]));
    if (options.sortKeys === true) {
      entries.sort(([left], [right]) => left.localeCompare(right));
    }
    stack.push({ kind: "text", value: "}" });
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!entry) {
        continue;
      }
      stack.push({
        kind: "value",
        location: "root",
        value: entry[1],
      });
      stack.push({ kind: "text", value: ":" });
      stack.push({ kind: "text", value: JSON.stringify(entry[0]) });
      if (index > 0) {
        stack.push({ kind: "text", value: "," });
      }
    }
    stack.push({ kind: "text", value: "{" });
  }

  options.signal?.throwIfAborted();
  return chunks.join("");
}

function appendJsonChunk(chunks: string[], value: string): void {
  const previousIndex = chunks.length - 1;
  const previous = chunks[previousIndex];
  if (
    previous !== undefined
    && previous.length + value.length <= JSON_CHUNK_TARGET_CHARS
  ) {
    chunks[previousIndex] = previous + value;
    return;
  }
  chunks.push(value);
}

function isOmittedJsonObjectValue(value: unknown): boolean {
  return value === undefined || typeof value === "function" || typeof value === "symbol";
}
