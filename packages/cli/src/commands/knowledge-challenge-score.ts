import { z } from 'incur'

import {
  groupChallengeScoreInputSchema,
  groupChallengeScoreResultSchema,
  scoreGroupChallenge,
} from '@murphai/assistant-engine'
import {
  emptyArgsSchema,
} from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
} from '@murphai/vault-usecases'
import { publicValidationIssue } from './public-validation-issue.js'

export const knowledgeChallengeScoreCommandDescription =
  'Apply one frozen additive challenge scorecard to model-normalized participant quantities. This command performs validation and deterministic arithmetic only; it does not read health data, infer metric rules, or write challenge state.'

const knowledgeChallengeScoreOptionsSchema = z.object({
  input: inputFileOptionSchema,
})

type KnowledgeChallengeScoreOptions = z.infer<
  typeof knowledgeChallengeScoreOptionsSchema
>

export function createKnowledgeChallengeScoreCommandDefinition() {
  return {
    args: emptyArgsSchema,
    description: knowledgeChallengeScoreCommandDescription,
    hint:
      'Pass --input @file.json or pipe the exact scorecard, format, and explicit participant-component observations to --input -. Persist the returned result on the existing challenge knowledge page in the same turn.',
    options: knowledgeChallengeScoreOptionsSchema,
    output: groupChallengeScoreResultSchema,
    async run({ options }: { options: KnowledgeChallengeScoreOptions }) {
      const input = await loadJsonInputObject(
        options.input,
        'group challenge scorecard input',
      )

      const parsed = groupChallengeScoreInputSchema.safeParse(input)
      if (!parsed.success) {
        throw new VaultCliError(
          'invalid_payload',
          'Group challenge scorecard input does not match the bounded additive scoring contract.',
          {
            retryable: false,
            stage: 'validation',
            hint: 'Check the format, participants, and scorecard fields, then retry with one complete bounded score input.',
            issues: parsed.error.issues.map((issue) => publicValidationIssue(
              issue,
              publicScoreInputIssuePath(issue.path),
            )),
          },
        )
      }

      try {
        return scoreGroupChallenge(parsed.data)
      } catch (error) {
        if (!(error instanceof TypeError)) {
          throw error
        }
        throw new VaultCliError(
          'invalid_payload',
          'Group challenge scorecard input is internally inconsistent.',
          {
            retryable: false,
            stage: 'validation',
            hint: 'Use unique participant and component ids, with exactly one observation for every scorecard component.',
          },
        )
      }
    },
  }
}

function publicScoreInputIssuePath(
  path: readonly PropertyKey[],
): readonly (string | number)[] {
  const root = path[0]
  return root === 'format' || root === 'participants' || root === 'scorecard'
    ? [root]
    : []
}
