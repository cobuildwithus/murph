import {
  groupChallengeScoreResultSchema,
  scoreGroupChallengeJson,
} from '@murphai/assistant-engine'
import {
  emptyArgsSchema,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
} from '@murphai/vault-usecases'

export const knowledgeChallengeScoreCommandDescription =
  'Apply one frozen additive challenge scorecard to model-normalized participant quantities. This command performs validation and deterministic arithmetic only; it does not read health data, infer metric rules, or write challenge state.'

export function createKnowledgeChallengeScoreCommandDefinition() {
  return {
    args: emptyArgsSchema,
    description: knowledgeChallengeScoreCommandDescription,
    hint:
      'Pass --input @file.json or pipe the exact scorecard, format, and explicit participant-component observations to --input -. Persist the returned result on the existing challenge knowledge page in the same turn.',
    options: {
      input: inputFileOptionSchema,
    },
    output: groupChallengeScoreResultSchema,
    async run({ options }: { options: { input: string } }) {
      const input = await loadJsonInputObject(
        options.input,
        'group challenge scorecard input',
      )
      try {
        return scoreGroupChallengeJson(input)
      } catch {
        throw new VaultCliError(
          'invalid_payload',
          'Group challenge scorecard input does not match the bounded additive scoring contract.',
        )
      }
    },
  }
}
