import path from 'node:path'
import type {
  SetupStepKind,
  SetupStepResult,
  SetupStepStatus,
  WhisperModel,
} from '../setup-cli-contracts.js'

export const DEFAULT_TOOLCHAIN_DIRECTORY = path.join('.healthybob', 'toolchain')
export const DEFAULT_USER_BIN_DIRECTORY = path.join('.local', 'bin')
export const PADDLEX_VENV_NAME = 'paddlex-ocr'
export const PADDLEX_REQUIREMENT = 'paddlex[ocr]'
export const BREW_INSTALL_COMMAND =
  'NONINTERACTIVE=1 CI=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

export type FormulaCommandKey =
  | 'ffmpegCommand'
  | 'pdftotextCommand'
  | 'whisperCommand'

export interface FormulaSpec {
  commandCandidates: string[]
  formula: string
  id: string
  installDetail: string
  missingPlanDetail: string
  title: string
}

export interface ToolFormulaSpec extends FormulaSpec {
  key: FormulaCommandKey
}

export const modelFileNames: Record<WhisperModel, string> = {
  tiny: 'ggml-tiny.bin',
  'tiny.en': 'ggml-tiny.en.bin',
  base: 'ggml-base.bin',
  'base.en': 'ggml-base.en.bin',
  small: 'ggml-small.bin',
  'small.en': 'ggml-small.en.bin',
  medium: 'ggml-medium.bin',
  'medium.en': 'ggml-medium.en.bin',
  'large-v3-turbo': 'ggml-large-v3-turbo.bin',
}

export function whisperModelDownloadUrl(model: WhisperModel): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${modelFileNames[model]}`
}

export function buildBaseFormulaSpecs(): ToolFormulaSpec[] {
  return [
    {
      commandCandidates: ['ffmpeg'],
      formula: 'ffmpeg',
      id: 'ffmpeg',
      installDetail: 'Installed ffmpeg through Homebrew.',
      key: 'ffmpegCommand',
      missingPlanDetail:
        'Would install ffmpeg through Homebrew for audio/video normalization.',
      title: 'ffmpeg',
    },
    {
      commandCandidates: ['pdftotext'],
      formula: 'poppler',
      id: 'pdftotext',
      installDetail: 'Installed poppler so pdftotext is available for PDF parsing.',
      key: 'pdftotextCommand',
      missingPlanDetail:
        'Would install poppler through Homebrew so pdftotext is available for PDF parsing.',
      title: 'pdftotext',
    },
    {
      commandCandidates: ['whisper-cli', 'whisper-cpp'],
      formula: 'whisper-cpp',
      id: 'whisper-cpp',
      installDetail: 'Installed whisper.cpp through Homebrew.',
      key: 'whisperCommand',
      missingPlanDetail:
        'Would install whisper.cpp through Homebrew for local transcription.',
      title: 'whisper.cpp',
    },
  ]
}

export function buildPythonFormulaSpec(): FormulaSpec {
  return {
    commandCandidates: ['python3.12', 'python3', 'python'],
    formula: 'python@3.12',
    id: 'python',
    installDetail: 'Installed Python 3.12 through Homebrew for OCR tooling.',
    missingPlanDetail:
      'Would install Python 3.12 through Homebrew for OCR tooling.',
    title: 'Python 3.12',
  }
}

export function createStep(input: {
  id: string
  title: string
  kind: SetupStepKind
  status: SetupStepStatus
  detail: string
}): SetupStepResult {
  return {
    detail: input.detail,
    id: input.id,
    kind: input.kind,
    status: input.status,
    title: input.title,
  }
}
