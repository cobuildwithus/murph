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

export interface MacosToolRequirementSpec {
  formula: string
  installDetail: string
  missingPlanDetail: string
  title: string
}

export interface LinuxToolRequirementSpec {
  completedDetail?: string
  installPackages: string[]
  missingNoteDetail?: string
  missingPlanDetail: string
  missingStepDetail: string
  reuseDetail?: (command: string) => string
  title: string
}

export interface ToolRequirementSpec {
  commandCandidates: string[]
  id: string
  key: FormulaCommandKey
  linux: LinuxToolRequirementSpec
  macos: MacosToolRequirementSpec
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

export function resolveWhisperModelPath(
  toolchainRoot: string,
  model: WhisperModel,
): string {
  return path.join(toolchainRoot, 'models', 'whisper', modelFileNames[model])
}

export function buildBaseFormulaSpecs(): ToolRequirementSpec[] {
  return [
    {
      commandCandidates: ['ffmpeg'],
      id: 'ffmpeg',
      key: 'ffmpegCommand',
      linux: {
        installPackages: ['ffmpeg'],
        missingPlanDetail:
          'Would reuse ffmpeg from PATH when available, or install the ffmpeg package via apt-get for audio/video normalization.',
        missingStepDetail:
          'ffmpeg was not found on PATH and Healthy Bob could not install it automatically. Install ffmpeg manually or rerun setup with apt/sudo access.',
        title: 'ffmpeg',
      },
      macos: {
        formula: 'ffmpeg',
        installDetail: 'Installed ffmpeg through Homebrew.',
        missingPlanDetail:
          'Would install ffmpeg through Homebrew for audio/video normalization.',
        title: 'ffmpeg',
      },
    },
    {
      commandCandidates: ['pdftotext'],
      id: 'pdftotext',
      key: 'pdftotextCommand',
      linux: {
        installPackages: ['poppler-utils'],
        missingPlanDetail:
          'Would reuse pdftotext from PATH when available, or install poppler-utils via apt-get for PDF parsing.',
        missingStepDetail:
          'pdftotext was not found on PATH and Healthy Bob could not install it automatically. Install poppler-utils manually or rerun setup with apt/sudo access.',
        title: 'pdftotext',
      },
      macos: {
        formula: 'poppler',
        installDetail: 'Installed poppler so pdftotext is available for PDF parsing.',
        missingPlanDetail:
          'Would install poppler through Homebrew so pdftotext is available for PDF parsing.',
        title: 'pdftotext',
      },
    },
    {
      commandCandidates: ['whisper-cli', 'whisper-cpp'],
      id: 'whisper-cpp',
      key: 'whisperCommand',
      linux: {
        installPackages: ['whisper-cpp'],
        missingPlanDetail:
          'Would reuse whisper.cpp from PATH when available, or install the whisper-cpp package via apt-get for local transcription.',
        missingStepDetail:
          'whisper.cpp was not found on PATH and Healthy Bob could not install it automatically. Install whisper.cpp manually or rerun setup with apt/sudo access.',
        title: 'whisper.cpp',
      },
      macos: {
        formula: 'whisper-cpp',
        installDetail: 'Installed whisper.cpp through Homebrew.',
        missingPlanDetail:
          'Would install whisper.cpp through Homebrew for local transcription.',
        title: 'whisper.cpp',
      },
    },
  ]
}

export function buildPythonFormulaSpec(): Omit<ToolRequirementSpec, 'key'> {
  return {
    commandCandidates: ['python3.12', 'python3', 'python'],
    id: 'python',
    linux: {
      completedDetail:
        'Installed Python 3 with venv support through apt-get for OCR tooling.',
      installPackages: ['python3', 'python3-venv'],
      missingNoteDetail:
        'OCR setup could not resolve Python 3 with venv support automatically. Install python3 and python3-venv manually or rerun setup with apt/sudo access.',
      missingPlanDetail:
        'Would reuse Python 3 with venv support from PATH when available, or install python3 plus python3-venv via apt-get for OCR tooling.',
      missingStepDetail:
        'Python 3 with venv support was not found on PATH and Healthy Bob could not install it automatically.',
      reuseDetail: (command) => `Reusing Python 3 from ${command} for OCR tooling.`,
      title: 'Python 3',
    },
    macos: {
      formula: 'python@3.12',
      installDetail: 'Installed Python 3.12 through Homebrew for OCR tooling.',
      missingPlanDetail:
        'Would install Python 3.12 through Homebrew for OCR tooling.',
      title: 'Python 3.12',
    },
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
