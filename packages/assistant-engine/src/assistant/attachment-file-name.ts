const ASSISTANT_INPUT_FILE_NAME_MAX_LENGTH = 191
const ASSISTANT_INPUT_SAFE_FILE_NAME_PATTERN = /^[^\u0000-\u001f\u007f/\\:?#[\]]{1,191}$/u

export function normalizeAssistantInputFileName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (
    trimmed.length === 0 ||
    trimmed.length > ASSISTANT_INPUT_FILE_NAME_MAX_LENGTH ||
    trimmed === '.' ||
    trimmed === '..' ||
    !ASSISTANT_INPUT_SAFE_FILE_NAME_PATTERN.test(trimmed)
  ) {
    return null
  }

  return trimmed
}
