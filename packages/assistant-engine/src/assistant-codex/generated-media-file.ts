import type { ResolvedGenerateImageReference } from './image-reference-resolver.js'

/** Supplied by the owning flow, never by model arguments or an editable manifest. */
export interface GeneratedMediaFileRuntime {
  /** Host-only credential; never include it in the Codex shell environment. */
  elevenLabsApiKey?: string
  fetchImpl: typeof fetch
  resolveReferences(refs: readonly string[]): Promise<ResolvedGenerateImageReference[]>
  save(bytes: Uint8Array, mediaType: 'image/jpeg' | 'audio/mpeg'): Promise<string>
}

export interface GeneratedMediaFileArgs {
  output?: 'chat' | 'file'
}
