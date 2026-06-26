export const USER_FACING_MESSAGE_MIN_VARIANT_COUNT = 20

export const USER_FACING_MESSAGE_TEMPLATE_KEYS = [
  "assistant.signup_welcome",
  "linq.invite_signup",
  "linq.daily_quota",
  "linq.home_redirect",
  "linq.ai_usage.trial_conversion_pending",
  "linq.ai_usage.trial_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
] as const

export type UserFacingMessageTemplateKey =
  (typeof USER_FACING_MESSAGE_TEMPLATE_KEYS)[number]

export interface UserFacingMessageContextByKey {
  "assistant.signup_welcome": Record<string, never>
  "linq.invite_signup": {
    joinUrl: string
  }
  "linq.daily_quota": {
    dailyTextLimit: number
  }
  "linq.home_redirect": {
    homeRecipientPhone: string
  }
  "linq.ai_usage.trial_conversion_pending": {
    homeUrl: string
  }
  "linq.ai_usage.trial_limit_reached": {
    homeUrl: string
  }
  "linq.ai_usage.edge_limit_reached": {
    homeUrl: string
  }
  "linq.ai_usage.pulse_upgrade_edge": {
    homeUrl: string
  }
}

export interface RenderUserFacingMessageInput<K extends UserFacingMessageTemplateKey> {
  context: UserFacingMessageContextByKey[K]
  key: K
  seed: string
}

export interface RenderUserFacingMessageVariantInput<K extends UserFacingMessageTemplateKey> {
  context: UserFacingMessageContextByKey[K]
  key: K
  variantIndex: number
}

export interface RenderedUserFacingMessage {
  key: UserFacingMessageTemplateKey
  text: string
  variantId: string
}

const USER_FACING_MESSAGE_TEMPLATES = {
  "assistant.signup_welcome": [
    `Hey, I'm Murph - your personal health assistant.

Text me anything health-related: meals, supplements, workouts, symptoms, questions, or experiments.

What do you want to start with?`,
    `Welcome to Murph. I help you make sense of meals, workouts, symptoms, supplements, and health experiments over time.

What's the first thing you want to track?`,
    `Hey, I'm Murph. Send me anything health-related and I'll help you notice what is actually working for your body.

Want to start with food, training, sleep, or something else?`,
    `I'm Murph - a health assistant you can text.

Meals, workouts, symptoms, supplements, questions, experiments: send any of it here.

What would be useful to look at first?`,
    `Welcome in - I'm Murph.

You can text me health questions, meals, workouts, supplements, symptoms, or experiments, and I'll help you connect the dots.

What are you trying to improve right now?`,
    `Hey, Murph here. I can help you track health inputs and spot patterns across food, training, sleep, symptoms, and experiments.

What should we start with?`,
    `Glad you're here - I'm Murph, your personal health assistant.

Text me what you're eating, trying, feeling, or wondering about, and I'll help you learn from it.

What are you curious about first?`,
    `Hey, I'm Murph. Think of this as a simple place to text health notes, questions, and experiments.

Want to start with meals, workouts, symptoms, supplements, or sleep?`,
    `Welcome to Murph.

I can help you run small health experiments and understand what changes are actually helping.

What experiment or habit do you want to start with?`,
    `Hey, I'm Murph - text me anything health-related and I'll help you make sense of it over time.

What's one thing about your health you want clearer answers on?`,
    `Murph here. I can help with meals, workouts, symptoms, supplements, questions, and small experiments.

What do you want to log or ask about first?`,
    `Welcome - I'm Murph.

Use this chat for health notes, questions, and experiments. Over time, I'll help you see what's moving the needle.

Where should we begin?`,
    `Hey, I'm Murph. I help you turn health logs and questions into useful patterns.

Want to start by tracking something or asking a question?`,
    `You're set up with Murph.

Text me meals, symptoms, workouts, supplements, or questions, and I'll help you understand what is working.

What's the first thing on your mind?`,
    `Hey - Murph here.

I'm built for health questions, daily logs, and experiments like sauna, cold plunge, supplements, training, or sleep changes.

What would you like help with first?`,
    `Welcome to Murph. You can text me like a health notebook that talks back.

Meals, symptoms, workouts, supplements, and questions are all fair game.

What should I help you with today?`,
    `I'm Murph, your health assistant.

Send me what you tried, ate, felt, or wondered about, and I'll help you find patterns over time.

What are you working on right now?`,
    `Hey, Murph here. I can help you track health inputs and learn from experiments instead of guessing.

What do you want to test or understand first?`,
    `Welcome. I'm Murph - a health assistant built around your real notes, questions, and experiments.

What would make this useful for you today?`,
    `Hey, I'm Murph.

Text me health-related questions, meals, workouts, symptoms, supplements, or experiment notes. I'll help you connect them over time.

What do you want to start with?`,
  ],
  "linq.invite_signup": [
    `Welcome to Murph - I can help you track health questions, habits, and experiments.

Verify your phone to finish signup:
{joinUrl}

What do you want help tracking first?`,
    `Hey, Murph here. To finish setting up this chat, verify your phone here:
{joinUrl}

After that, what health goal should we start with?`,
    `You're almost set up with Murph.

Verify your phone here:
{joinUrl}

Want to start with meals, workouts, sleep, symptoms, or supplements?`,
    `Welcome in - one quick step before I can help from this number.

Verify your phone:
{joinUrl}

What are you hoping Murph helps you understand?`,
    `Hey, I'm Murph. Finish signup by verifying your phone here:
{joinUrl}

Once you're in, what should we look at first?`,
    `Murph here. Verify your phone to connect this chat:
{joinUrl}

What health question do you want help answering first?`,
    `Almost done - verify your phone so Murph can reply here:
{joinUrl}

What would you like to track or ask about first?`,
    `Welcome to Murph.

Please verify your phone to finish signup:
{joinUrl}

Want to start with food, training, sleep, or something else?`,
    `Hey - to finish getting Murph set up, verify this phone:
{joinUrl}

What are you trying to improve right now?`,
    `One more step to use Murph from this chat.

Verify your phone here:
{joinUrl}

What should we start with after that?`,
    `Glad you're here. Verify your phone to finish Murph signup:
{joinUrl}

What health habit or question should we tackle first?`,
    `Murph is ready once your phone is verified.

Finish signup:
{joinUrl}

Do you want to begin with tracking or a question?`,
    `Hey, Murph here. Connect this number by verifying your phone:
{joinUrl}

What's the first thing you want help making sense of?`,
    `Welcome - please verify your phone so I can keep helping from this chat:
{joinUrl}

What's your first health focus?`,
    `You're one step away from texting Murph.

Verify your phone:
{joinUrl}

What do you want to log or learn about first?`,
    `Let's get Murph connected to this number.

Verify your phone here:
{joinUrl}

What should we pay attention to first?`,
    `Hey, this is Murph. Finish signup by verifying your phone:
{joinUrl}

What health experiment or habit should we start with?`,
    `To finish setting up Murph, verify your phone here:
{joinUrl}

What would make this chat useful for you today?`,
    `Welcome to Murph. Please verify your phone so this chat is connected:
{joinUrl}

What do you want help with first?`,
    `Murph here - verify your phone to finish setup:
{joinUrl}

After that, what should we start tracking?`,
  ],
  "linq.daily_quota": [
    `You've hit Murph's daily text limit of {dailyTextLimit} messages. Try me again tomorrow.`,
    `That's Murph's {dailyTextLimit}-message daily text limit for today. We can pick this back up tomorrow.`,
    `You've reached today's Murph text limit: {dailyTextLimit} messages. Send the next note tomorrow.`,
    `Murph is at the daily text cap of {dailyTextLimit} messages. Try again tomorrow.`,
    `You used today's {dailyTextLimit} Murph text messages. I'll be ready again tomorrow.`,
    `Daily Murph text limit reached - {dailyTextLimit} messages for today. We can continue tomorrow.`,
    `You've reached the {dailyTextLimit}-message daily limit for Murph texts. Try again tomorrow.`,
    `That's today's Murph text allowance: {dailyTextLimit} messages. Message me tomorrow to continue.`,
    `Murph has hit today's text limit of {dailyTextLimit}. Let's continue tomorrow.`,
    `You're at Murph's daily text limit of {dailyTextLimit} messages. Try the next message tomorrow.`,
    `Today's Murph text limit is used up: {dailyTextLimit} messages. I'll be back tomorrow.`,
    `You've sent today's {dailyTextLimit} Murph texts. We can keep going tomorrow.`,
    `Murph's daily text cap is {dailyTextLimit} messages, and you've reached it. Try again tomorrow.`,
    `That's the daily Murph text cap for now: {dailyTextLimit} messages. Continue tomorrow.`,
    `You've reached Murph's daily message limit of {dailyTextLimit}. Check back tomorrow.`,
    `Murph can take {dailyTextLimit} texts per day, and today's limit is reached. Try again tomorrow.`,
    `Daily limit reached: {dailyTextLimit} Murph texts. Send the next update tomorrow.`,
    `You're at today's Murph text max of {dailyTextLimit}. I'll be ready for more tomorrow.`,
    `Murph's daily text allowance is used up for today: {dailyTextLimit} messages. Try tomorrow.`,
    `That's all {dailyTextLimit} Murph texts for today. We can continue tomorrow.`,
  ],
  "linq.home_redirect": [
    `You're already set up with Murph.

Save this number and text me here instead:
{homeRecipientPhone}`,
    `You're set up with Murph on another number.

Please save and use this one:
{homeRecipientPhone}`,
    `Murph is already connected for you.

Text the saved home number instead:
{homeRecipientPhone}`,
    `This looks like the wrong Murph thread.

Use your Murph home number here:
{homeRecipientPhone}`,
    `You're already connected to Murph.

Send your next message to this number:
{homeRecipientPhone}`,
    `Murph is ready for you on your home line.

Please text me here:
{homeRecipientPhone}`,
    `You're set up - just use your Murph home number.

Save this and message me there:
{homeRecipientPhone}`,
    `This thread is not your main Murph line.

Text your Murph number instead:
{homeRecipientPhone}`,
    `You're already active with Murph.

Use this number for replies:
{homeRecipientPhone}`,
    `Please switch to your Murph home line so replies stay in one place:
{homeRecipientPhone}`,
    `You're connected to Murph already.

Your main text number is:
{homeRecipientPhone}`,
    `Let's keep your Murph chat on the right number.

Text me here:
{homeRecipientPhone}`,
    `This is not the best Murph number for your account.

Use:
{homeRecipientPhone}`,
    `You're already set up, but this is not your home thread.

Save and text:
{homeRecipientPhone}`,
    `Murph replies should go through your home number.

Please use:
{homeRecipientPhone}`,
    `You're set up with Murph. To keep the thread clean, text this number instead:
{homeRecipientPhone}`,
    `Use your Murph home line for the next message:
{homeRecipientPhone}`,
    `This is not your main Murph thread. Your active number is:
{homeRecipientPhone}`,
    `You're already connected. Please continue with Murph here:
{homeRecipientPhone}`,
    `Let's move this to your Murph home number:
{homeRecipientPhone}`,
  ],
  "linq.ai_usage.trial_conversion_pending": [
    `Your trial has ended. Start Pulse to keep Murph replying:
{homeUrl}`,
    `Murph needs Pulse active to keep replying now that your trial is over:
{homeUrl}`,
    `Your Murph trial is done. Start Pulse here to continue:
{homeUrl}`,
    `Trial ended - activate Pulse if you want Murph to keep responding:
{homeUrl}`,
    `Your trial has wrapped up. Start Pulse to continue using Murph:
{homeUrl}`,
    `Murph replies are paused because your trial ended. You can start Pulse here:
{homeUrl}`,
    `Your trial period is over. Start Pulse to turn Murph replies back on:
{homeUrl}`,
    `To keep Murph replying after the trial, start Pulse here:
{homeUrl}`,
    `Murph is paused after your trial. Start Pulse when you're ready:
{homeUrl}`,
    `Your trial ended, so Murph can't keep replying until Pulse is active:
{homeUrl}`,
    `Start Pulse to continue your Murph chat after the trial:
{homeUrl}`,
    `Murph's trial access has ended. You can continue with Pulse here:
{homeUrl}`,
    `Trial complete - start Pulse to keep this Murph thread going:
{homeUrl}`,
    `Murph is waiting on Pulse activation before more replies:
{homeUrl}`,
    `Your trial is over. If you want to keep going with Murph, start Pulse:
{homeUrl}`,
    `Pulse is needed for Murph to keep replying after the trial:
{homeUrl}`,
    `Murph replies are off after the trial. Start Pulse here:
{homeUrl}`,
    `Your trial finished. Start Pulse to keep using Murph by text:
{homeUrl}`,
    `To continue with Murph, activate Pulse now that the trial is done:
{homeUrl}`,
    `Murph can keep helping once Pulse is active:
{homeUrl}`,
  ],
  "linq.ai_usage.trial_limit_reached": [
    `You've reached the hosted AI usage included in your trial. Please finish checkout:
{homeUrl}`,
    `Your trial's included AI usage is used up. Finish checkout to keep Murph replying:
{homeUrl}`,
    `Murph hit the AI usage included with your trial. You can finish checkout here:
{homeUrl}`,
    `Trial usage limit reached. Complete checkout to continue with Murph:
{homeUrl}`,
    `You've used the AI allowance included in your trial. Finish checkout here:
{homeUrl}`,
    `Murph is paused because the trial AI usage is used up. Finish checkout:
{homeUrl}`,
    `Your trial AI allowance is complete. Checkout will let Murph keep replying:
{homeUrl}`,
    `You've reached the trial usage limit. Finish checkout when you're ready:
{homeUrl}`,
    `Murph used the AI included in your trial. Continue by finishing checkout:
{homeUrl}`,
    `The trial AI limit is reached. Finish checkout to keep this chat active:
{homeUrl}`,
    `Your included trial usage is done for now. Complete checkout here:
{homeUrl}`,
    `Murph can't keep replying because the trial usage limit was reached:
{homeUrl}`,
    `Trial usage is maxed out. Finish checkout to restart Murph replies:
{homeUrl}`,
    `You've used your trial's included Murph AI. Continue here:
{homeUrl}`,
    `Your trial allowance has been used. Finish checkout if you want to keep going:
{homeUrl}`,
    `Murph reached the trial's hosted AI limit. Checkout is here:
{homeUrl}`,
    `The included trial AI usage has run out. Finish setup here:
{homeUrl}`,
    `Your trial usage cap is reached. Finish checkout to continue:
{homeUrl}`,
    `Murph replies are paused at the trial usage limit. Continue here:
{homeUrl}`,
    `You've reached the AI included in your trial. Checkout can turn replies back on:
{homeUrl}`,
  ],
  "linq.ai_usage.edge_limit_reached": [
    `Hey, you've reached your usage limit for the month. Murph will resume when your included allowance resets:
{homeUrl}`,
    `Your monthly Murph usage limit is reached. Replies resume when the included allowance resets:
{homeUrl}`,
    `Murph is at this month's usage limit. It will pick back up when your allowance resets:
{homeUrl}`,
    `You've used this month's included Murph allowance. Replies resume after reset:
{homeUrl}`,
    `Monthly usage limit reached. Murph will resume when the allowance resets:
{homeUrl}`,
    `Murph replies are paused at your monthly limit and will resume after reset:
{homeUrl}`,
    `You're at the included usage limit for this month. Murph will continue after reset:
{homeUrl}`,
    `This month's Murph allowance is used up. Replies resume when it resets:
{homeUrl}`,
    `Murph hit the monthly included usage limit. Check your account here:
{homeUrl}`,
    `Your included monthly usage is used for now. Murph will resume at reset:
{homeUrl}`,
    `Murph is paused because the monthly usage limit was reached:
{homeUrl}`,
    `You've reached this month's included Murph usage. Replies will come back after reset:
{homeUrl}`,
    `Monthly allowance reached. Murph will be ready again after the reset:
{homeUrl}`,
    `Murph can't continue this month until the included allowance resets:
{homeUrl}`,
    `This month's usage cap is reached. Murph resumes when the cap resets:
{homeUrl}`,
    `Your monthly included allowance is complete. Murph will resume at the next reset:
{homeUrl}`,
    `Murph has reached your monthly usage allowance. More details:
{homeUrl}`,
    `You've hit the monthly Murph usage cap. Replies resume after reset:
{homeUrl}`,
    `Murph's included monthly usage is used up for now:
{homeUrl}`,
    `The monthly Murph limit is reached. It will reset before replies continue:
{homeUrl}`,
  ],
  "linq.ai_usage.pulse_upgrade_edge": [
    `Hey, you've reached your usage limit for the month. Upgrade to Edge:
{homeUrl}`,
    `You've hit this month's Murph usage limit. Upgrade to Edge to keep going:
{homeUrl}`,
    `Murph reached your monthly usage limit. Edge gives you more room:
{homeUrl}`,
    `You're at the monthly limit for Murph. Upgrade to Edge here:
{homeUrl}`,
    `Monthly usage limit reached. You can move to Edge to continue:
{homeUrl}`,
    `Murph is paused at your usage limit. Upgrade to Edge if you want more:
{homeUrl}`,
    `You've used this month's Murph allowance. Edge can unlock more usage:
{homeUrl}`,
    `Your Murph usage limit is reached for the month. Upgrade path:
{homeUrl}`,
    `Murph hit the monthly cap. Edge is available here:
{homeUrl}`,
    `You're out of included Murph usage for the month. Upgrade to Edge:
{homeUrl}`,
    `Monthly Murph limit reached. Want more usage? Edge is here:
{homeUrl}`,
    `Murph can't keep replying at the current monthly limit. Upgrade to Edge:
{homeUrl}`,
    `You've reached the monthly cap. Edge can keep Murph running:
{homeUrl}`,
    `Murph replies are paused at the monthly limit. Upgrade here:
{homeUrl}`,
    `The monthly usage allowance is used up. Edge lets you continue:
{homeUrl}`,
    `Your current Murph plan hit its usage limit. Upgrade to Edge:
{homeUrl}`,
    `Murph reached the usage cap for this month. Edge is the next step:
{homeUrl}`,
    `You've hit your Murph usage limit. To keep going this month, upgrade to Edge:
{homeUrl}`,
    `Murph is at your monthly usage cap. You can upgrade to Edge here:
{homeUrl}`,
    `Usage limit reached. Upgrade to Edge if you want Murph to keep replying:
{homeUrl}`,
  ],
} satisfies Record<UserFacingMessageTemplateKey, readonly string[]>

export function renderUserFacingMessage<K extends UserFacingMessageTemplateKey>(
  input: RenderUserFacingMessageInput<K>,
): RenderedUserFacingMessage {
  const templates = USER_FACING_MESSAGE_TEMPLATES[input.key]
  const variantIndex = selectUserFacingMessageVariantIndex({
    seed: input.seed,
    variantCount: templates.length,
  })

  return renderUserFacingMessageVariant({
    context: input.context,
    key: input.key,
    variantIndex,
  })
}

export function renderUserFacingMessageVariant<K extends UserFacingMessageTemplateKey>(
  input: RenderUserFacingMessageVariantInput<K>,
): RenderedUserFacingMessage {
  const templates = USER_FACING_MESSAGE_TEMPLATES[input.key]
  if (input.variantIndex < 0 || input.variantIndex >= templates.length) {
    throw new RangeError(`User-facing message variant index is out of range for ${input.key}.`)
  }

  const template = templates[input.variantIndex]
  if (!template) {
    throw new RangeError(`User-facing message variant is missing for ${input.key}.`)
  }

  return {
    key: input.key,
    text: renderUserFacingMessageTemplate(template, input.context),
    variantId: formatUserFacingMessageVariantId(input.key, input.variantIndex),
  }
}

export function readUserFacingMessageVariantCount(
  key: UserFacingMessageTemplateKey,
): number {
  return USER_FACING_MESSAGE_TEMPLATES[key].length
}

function selectUserFacingMessageVariantIndex(input: {
  seed: string
  variantCount: number
}): number {
  if (input.variantCount <= 0) {
    throw new TypeError("User-facing message templates require at least one variant.")
  }

  return hashUserFacingMessageSeed(input.seed) % input.variantCount
}

function hashUserFacingMessageSeed(seed: string): number {
  const normalized = seed.trim().length > 0 ? seed : "default"
  let hash = 2166136261

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  return hash >>> 0
}

function formatUserFacingMessageVariantId(
  key: UserFacingMessageTemplateKey,
  variantIndex: number,
): string {
  return `${key}.v${String(variantIndex + 1).padStart(2, "0")}`
}

function renderUserFacingMessageTemplate<K extends UserFacingMessageTemplateKey>(
  template: string,
  context: UserFacingMessageContextByKey[K],
): string {
  return template
    .replace(/\{([a-z][a-zA-Z0-9]*)\}/gu, (_, key: string) => {
      const value: unknown = Reflect.get(context, key)

      if (typeof value !== "number" && typeof value !== "string") {
        throw new TypeError(`User-facing message template value is missing for ${key}.`)
      }

      return String(value)
    })
    .trim()
}
