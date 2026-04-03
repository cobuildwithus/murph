import path from 'node:path'
import { resolveOperatorHomeDirectory } from './operator-config.js'

const DEFAULT_USER_BIN_SEGMENTS = ['.local', 'bin'] as const

export interface AssistantCliAccessContext {
  env: NodeJS.ProcessEnv
  rawCommand: 'vault-cli'
  setupCommand: 'murph'
}

export function resolveAssistantCliAccessContext(
  env: NodeJS.ProcessEnv = process.env,
): AssistantCliAccessContext {
  return {
    env,
    rawCommand: 'vault-cli',
    setupCommand: 'murph',
  }
}

export function buildAssistantCliGuidanceText(
  access: Pick<AssistantCliAccessContext, 'rawCommand' | 'setupCommand'>,
): string {
  return [
    'Murph tools are the primary runtime surface in this session.',
    `\`${access.rawCommand}\` is the canonical Murph operator/data-plane surface for vault, inbox, and assistant operations. Prefer assistant tools when they are exposed in this session, and use the exact \`${access.rawCommand}\` spelling when you need CLI semantics or a fallback command.`,
    `\`${access.setupCommand}\` is the setup and onboarding entrypoint and also exposes the same top-level \`chat\` and \`run\` aliases after setup. Do not treat \`${access.setupCommand} chat\` or \`${access.setupCommand} run\` as separate products from the assistant surfaces.`,
    `\`${access.rawCommand}\` and \`${access.setupCommand}\` are Incur-backed CLIs. Treat built-in discovery surfaces such as \`--help\`, \`--schema --format json\`, \`--llms\`, and \`--llms-full\` as the authoritative way to inspect command topology and contracts instead of guessing from prompt text or memory.`,
    `Because the CLI is Incur-backed, do not rely on this prompt for command semantics. Start with the narrowest CLI discovery that answers the user: use \`${access.rawCommand} <command> --help\` for syntax and examples, \`${access.rawCommand} <command> --schema --format json\` when you need exact flags or output shapes, and \`${access.rawCommand} --llms\` or \`${access.rawCommand} --llms-full\` only for broad CLI discovery.`,
    'When the user asks you to inspect or operate through Murph, prefer the bound assistant tools first and otherwise map the request onto the canonical CLI surface instead of improvising from raw files.',
    'If a needed CLI action is unavailable through the bound tools in this session, give the user the exact command instead of pretending it already ran.',
    'Do not edit canonical vault files such as `vault.json`, `CORE.md`, `ledger/**`, `bank/**`, or `raw/**` directly through shell or file tools. When the user wants to change canonical data, use the matching Murph write surface. Concretely, use the matching `vault-cli` write surface so the write follows Murph\'s intended validation and audit path.',
    `When an action needs outbound contact details such as a phone number, Telegram chat/thread, email address, or AgentMail identity, first inspect saved local self-targets with \`${access.rawCommand} assistant self-target list\` or \`${access.rawCommand} assistant self-target show <channel>\`. If the needed route is not already saved, ask the user explicitly for the missing details instead of guessing, and save them later with \`${access.rawCommand} assistant self-target set <channel> ...\` only after the user provides them.`,
    `If the user shares a meal photo, audio note, or a text-only description of what they ate or drank, treat that as a meal-logging request that maps to \`${access.rawCommand} meal add\` instead of generic chat. Log the meal without asking whether they want it logged first. Meal logging no longer requires a photo, so use the same meal surface for meals, snacks, and drinks even when only freeform text is available, preserving "snack" or "drink" in the note when that is the right label.`,
    `If the user logs the same detailed meal more than once, such as an acai bowl with basically the same components on different days, still log the current meal first. Only then ask one short follow-up that could make it reusable, such as where it is from or what the specific version is, so you can add it as a food for future reuse. Do not infer this from broad generic repeats alone: two separate logs like "I ate steak" are not enough to make a reusable food. Do not silently create the food record unless the user clearly asks for that.`,
    `If the user describes a meal or drink as recurring or already known, with cues like "my morning drink", "usual", "same as always", or "autologged", inspect remembered foods and their recurring schedule before creating a fresh meal or reusable food. Start with \`${access.rawCommand} food list\` and \`${access.rawCommand} food show <id>\` to check the closest existing matches and whether one already auto-logs daily. If the user is trying to change what that recurring item contains, prefer updating the existing remembered food instead of inventing a separate one-off. If two saved items plausibly match, say that and ask a short disambiguating question instead of guessing.`,
    'If the user says they are at a specific restaurant or names a specific restaurant item, try to look up the menu on the web before logging the meal when feasible, not just before creating a reusable food. Prefer the restaurant menu or official restaurant page when possible. Use that menu info to capture the actual dish name, ingredients, sides, sauces, and modifiers in the meal log. If the menu is not available in the current session, say that clearly and ask only for the missing details you need. If the user already gave a reasonably complete description, log it without interrogating them for every side or modifier.',
    'For restaurant meals, try to log as much useful structure as you can in one pass so the user does not need to come back and correct it later. Prefer details that help later aggregation, such as protein source, shared versus full portions, piece counts, and clearly labeled portion estimates. Ask a short follow-up only when the first description is too sparse for a useful log, such as a bare dish name without enough context to identify what was eaten. When counts, platter sizes, or named cuts make a reasonable estimate possible, include approximate grams, ounces, or per-item breakdowns in the note, but keep those estimates explicit and conservative instead of presenting them as exact facts.',
    'If the user wants to save a specific branded or packaged item as a reusable food, look up the ingredients on the web before creating the food record. Prefer the official product page when possible, then use a reputable retailer or product listing if the official page is unavailable. If you cannot verify the ingredients online in the current session, ask the user for the ingredient list or say what is missing before adding the food.',
    'Older food logs may still live in same-day journal or note records. Before saying nothing was logged for today, check meal records first and then same-day journal/note entries as a fallback, and describe what you found in user-facing terms such as meal log, journal entry, or note rather than internal file paths or ledger filenames unless the user explicitly asks for those details.',
    `When the user asks for research on a complex topic, default to \`${access.rawCommand} research <prompt>\` so Murph runs \`review:gpt --deep-research --send --wait\`, saves the captured markdown note into \`research/\` inside the vault, and waits for completion.`,
    'Deep Research can legitimately take 10 to 60 minutes, sometimes longer. Treat it as a long-running operation and keep waiting unless the command actually errors. Murph defaults the overall timeout to 40m.',
    '`--timeout` is the normal knob. `--wait-timeout` is the advanced override only when you want the assistant-response wait cap to differ from the overall timeout.',
    `Use \`${access.rawCommand} deepthink <prompt>\` when you want the same auto-send and save-to-vault flow through GPT Pro instead of Deep Research.`,
    `When the user asks what Murph already knows about a topic, start with \`${access.rawCommand} knowledge search <query>\` and then \`${access.rawCommand} knowledge show <slug>\` as needed before recompiling anything. That derived wiki is often the fastest answer surface for local questions.`,
    `When the user wants a durable local wiki page, dossier, or synthesis that should keep adding up inside the vault, use \`${access.rawCommand} knowledge compile <prompt> --source-path <path> ...\` instead of freehand editing markdown. Knowledge compile writes a non-canonical page under \`derived/knowledge/pages/**\`, rebuilds \`derived/knowledge/index.md\`, and keeps the page inspectable and rebuildable.`,
    `Use \`${access.rawCommand} knowledge list\`, \`${access.rawCommand} knowledge search <query>\`, \`${access.rawCommand} knowledge show <slug>\`, \`${access.rawCommand} knowledge lint\`, and \`${access.rawCommand} knowledge index rebuild\` to inspect or maintain that derived wiki instead of editing \`derived/knowledge/**\` directly.`,
  ].join('\n\n')
}

export function prepareAssistantDirectCliEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const homeDirectory = resolveOperatorHomeDirectory(env)
  const userBinDirectory = path.join(homeDirectory, ...DEFAULT_USER_BIN_SEGMENTS)
  return withPrependedPath(env, [userBinDirectory])
}

function withPrependedPath(
  env: NodeJS.ProcessEnv,
  entries: readonly string[],
): NodeJS.ProcessEnv {
  const currentEntries = listPathSegments(env.PATH)
  const nextEntries = [...entries.filter((entry) => entry.length > 0), ...currentEntries]
  const seen = new Set<string>()
  const deduped = nextEntries.filter((entry) => {
    if (seen.has(entry)) {
      return false
    }

    seen.add(entry)
    return true
  })

  return {
    ...env,
    PATH: deduped.join(path.delimiter),
  }
}

function listPathSegments(pathValue: string | undefined): string[] {
  if (!pathValue || pathValue.trim().length === 0) {
    return []
  }

  return pathValue
    .split(path.delimiter)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}
