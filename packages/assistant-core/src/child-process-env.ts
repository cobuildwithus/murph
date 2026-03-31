export function sanitizeChildProcessEnv(
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  const nextEnv = { ...(env ?? process.env) }
  delete nextEnv.NODE_V8_COVERAGE
  return nextEnv
}
