const USER_FACING_MESSAGE_MIN_VARIANT_COUNT = 20

const USER_FACING_MESSAGE_TEMPLATE_KEYS = [
  "assistant.signup_welcome",
  "assistant.family_welcome",
  "linq.invite_signup",
  "linq.daily_quota",
  "linq.home_redirect",
  "linq.ai_usage.trial_conversion_pending",
  "linq.ai_usage.trial_limit_reached",
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.family_limit_reached",
  "linq.ai_usage.thread_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
] as const

export type UserFacingMessageTemplateKey =
  (typeof USER_FACING_MESSAGE_TEMPLATE_KEYS)[number]

export interface UserFacingMessageContextByKey {
  "assistant.signup_welcome": Record<string, never>
  "assistant.family_welcome": Record<string, never>
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
  "linq.ai_usage.family_limit_reached": {
    homeUrl: string
  }
  "linq.ai_usage.thread_limit_reached": Record<string, never>
  "linq.ai_usage.pulse_upgrade_edge": {
    homeUrl: string
  }
}

export interface RenderUserFacingMessageInput<K extends UserFacingMessageTemplateKey> {
  context: UserFacingMessageContextByKey[K]
  key: K
  seed: string
}

export interface RenderedUserFacingMessage {
  text: string
}

const USER_FACING_MESSAGE_TEMPLATES = {
  "assistant.signup_welcome": [
    `Hey, I'm Murph, your private personal health assistant.

Bring me anything about your health: something you want to change, a question or decision, data you want understood, or a task you want help with. I'll remember the useful context so my help gets more personal.

Ready to get started?`,
    `Hi, I'm Murph, your private personal health assistant.

You can talk to me about any health goal, question, decision, data, or task. The more I learn about your health, the more useful my help becomes.

Ready to start?`,
    `Murph here, your private personal health assistant.

Start anywhere with your health: a change you want, something confusing, data to make sense of, or a task that needs doing. I'll remember what is useful so later help fits you better.

Ready to get started?`,
    `Hey, I'm Murph, your private personal health assistant.

Bring me a health question, goal, decision, record, or task and we'll take it from there. I'll remember useful context so you don't have to start over each time.

Ready to start?`,
    `Hi, Murph here, your private personal health assistant.

You can bring me whatever is happening with your health, from a question or goal to confusing data or a task you want handled. I'll keep the context that makes later help better.

Ready to get started?`,
    `Hey, I'm Murph, your private personal health assistant.

I'm here for health questions, decisions, data, goals, and the work of following through. I remember relevant context so my help becomes more personal over time.

Ready to start?`,
    `Murph here, your private personal health assistant.

Ask me about your health, show me data you want understood, tell me something you want to change, or give me a task to help handle. I'll remember useful context so next time starts with a better picture.

Ready to get started?`,
    `Hi, I'm Murph, a private personal health assistant for whatever comes up.

That can be a health question, decision, goal, data point, or task. I remember the context that helps me give better answers over time.

Ready to start?`,
    `Hey, I'm Murph, your private personal health assistant.

You don't need a perfect goal to start. Bring me a health question, something you want to change, data you want understood, or a task that keeps slipping. I'll learn what matters as we go so my help becomes more personal.

Ready to get started?`,
    `Hi, Murph here, your private personal health assistant.

I can help you think through health questions and decisions, understand your data, work toward a change, or handle the next task. I remember the context that matters so you don't have to repeat it.

Ready to start?`,
    `Hey, I'm Murph, your private personal health assistant.

Start with anything health-related: a question, a decision, a goal, a record, or something you want help getting done. I'll remember useful context so later help fits you better.

Ready to get started?`,
    `Murph here, your private personal health assistant.

You can ask me to explain something, help with a health decision, make sense of data, work on a goal, or handle a task. I keep the context that makes future help more useful.

Ready to start?`,
    `Hi, I'm Murph, your private personal health assistant.

Whatever your health needs today, whether it is an answer, a plan, help understanding data, or something practical, we can start there. I'll remember the relevant context so later help starts from a better picture.

Ready to get started?`,
    `Hey, Murph here, your private personal health assistant.

Bring me a health change you want, a question you can't settle, data that needs context, or a task you want handled. The more useful context I learn, the more personal my help becomes.

Ready to start?`,
    `Hello, I'm Murph, your private personal health assistant.

I can help across health goals, questions, decisions, records, and follow-through. I'll remember useful context so you don't have to rebuild the whole picture each time.

Ready to get started?`,
    `Hey, I'm Murph, your private personal health assistant.

You can start with a health goal, a confusing number, a decision, a practical task, or simply not knowing where to focus. I remember relevant context so later help gets better.

Ready to start?`,
    `Hi, I'm Murph, your private personal health assistant.

Ask a health question, share data, tell me what you want to change, or let me help with something that needs doing. I'll remember the useful parts so next time starts with a better picture.

Ready to get started?`,
    `Murph here, your private personal health assistant.

I'm here to help you understand, decide, act, and follow through across your health. I remember relevant context so my help improves over time.

Ready to start?`,
    `Hey, I'm Murph, your private personal health assistant.

Bring me whatever is going on with your health: a goal, question, choice, data point, or task. I'll keep the useful context so you don't have to start from zero next time.

Ready to get started?`,
    `Hi, I'm Murph, your private personal health assistant.

You can come to me with something you want to change, understand, decide, or get done. I remember the context that helps me support you better over time.

Ready to start?`,
  ],
  "assistant.family_welcome": [
    `You're in. A family member covers your Murph access, but everything you share with me stays private to you. They can't see any of it.

Ready to get started?`,
    `Welcome in. Your access is covered by family, and everything you share with me stays between us. The person paying can't see it.

Ready?`,
    `You're all set. Family covers the bill, but your conversations with me are yours alone. Whoever pays can't read them.

Want to dive in?`,
    `Hey, you're in. Someone in your family pays for your access, but nothing you share with me is visible to them. It's all private to you.

Ready to go?`,
    `You made it. Your plan is covered by a family member, but everything here stays private. They can't see what we talk about.

Sound good?`,
    `Welcome. A family member picked up the bill, but what happens here stays between you and me. They can't see any of it.

Ready to start?`,
    `You're in. Family pays for your access, but your conversations and data stay private to you. They can't see what you share with me.

Want to get started?`,
    `All set. Your Murph access is covered by family, but they can't see anything you share with me. That's yours alone.

Ready?`,
    `You're in. Quick note on privacy: a family member covers your plan, but everything you and I talk about stays private to you.

Sound good?`,
    `Welcome aboard. Your access comes through a family plan, but your conversations with me stay private. The person paying can't see them.

Ready to dive in?`,
    `You're set up. A family member covers your plan, but everything you tell me stays with me. They can't see any of it.

Want to start?`,
    `Good news, you're in. Family picks up the bill, but nothing you share with me is visible to them.

Ready?`,
    `You're in. One thing worth knowing: whoever pays for your access can't see what you share with me. That stays private to you.

Sound good?`,
    `Welcome in. Your access is paid for by family, but they can't see what you share with me. Everything here is private to you.

Ready to get going?`,
    `Invite accepted, you're in. A family member handles the bill, but your conversations with me are private. They can't see them.

Want to dive in?`,
    `You're all set up. Family pays for your Murph access, but nothing here is visible to them. What you share with me stays between us.

Ready to start?`,
    `Welcome. Your plan is covered by a family member, but your side of Murph is yours alone. They can't see what you share with me.

Ready?`,
    `You're in. Your access is covered through family, but everything you share with me is private. The person paying can't see any of it.

Want to get going?`,
    `All set, you're in. A family member pays for your access, but they can't see your conversations with me. That's all private to you.

Ready to go?`,
    `Hey, welcome in. Family covers your Murph access, but what you share with me stays private to you. They can't see it.

Sound good?`,
  ],
  "linq.invite_signup": [
    `Hey, I'm Murph. Tap to verify your number so I can reply here:
{joinUrl}`,
    `Welcome to Murph. Tap the link to confirm this is your phone:
{joinUrl}`,
    `Hi, Murph here. Tap to verify your number and we can get started:
{joinUrl}`,
    `Murph here. Tap below to verify so I can reply on this line:
{joinUrl}`,
    `Murph here. One tap to confirm your number and we're set:
{joinUrl}`,
    `Welcome in to Murph. Tap to verify your phone:
{joinUrl}`,
    `Hi, I'm Murph. Tap the link to verify your number:
{joinUrl}`,
    `Tap to confirm this is your Murph number so I can text back:
{joinUrl}`,
    `Quick Murph verify before we get started. Tap the link:
{joinUrl}`,
    `Murph here, glad you're texting. Tap to verify and save my number:
{joinUrl}`,
    `Welcome to Murph. Tap below to confirm this number is yours:
{joinUrl}`,
    `This is Murph. Tap to verify so I can reply on this line:
{joinUrl}`,
    `Hi from Murph. Tap the link to finish verifying:
{joinUrl}`,
    `Murph here. Tap the link to verify and I'll reply from this number:
{joinUrl}`,
    `Tap below to verify and Murph is all set:
{joinUrl}`,
    `Quick Murph check. Tap to verify this is your number:
{joinUrl}`,
    `Tap to confirm and Murph is ready to text back:
{joinUrl}`,
    `Hello, I'm Murph. Tap the link to verify your number:
{joinUrl}`,
    `Murph here. One tap to verify and we're in:
{joinUrl}`,
    `One tap and Murph can text back from this number. Verify here:
{joinUrl}`,
  ],
  "linq.daily_quota": [
    `That's the {dailyTextLimit}/day cap on this thread. Email or Telegram still work today, otherwise back tomorrow.`,
    `I cap texts at {dailyTextLimit} a day to keep things readable. Email or Telegram me if you want to keep going today.`,
    `Done with texts for today. {dailyTextLimit}/day limit. You can email or Telegram me anytime.`,
    `We hit today's {dailyTextLimit} text cap. Email me or Telegram me if there's more, otherwise tomorrow.`,
    `Quick pause on texts. That's {dailyTextLimit} for the day. Email or Telegram still open.`,
    `Texts hit {dailyTextLimit}/day. Email or Telegram works. Otherwise tomorrow.`,
    `Hold that thought. I'm at today's {dailyTextLimit} text max here. Email or Telegram me if you want to keep going.`,
    `{dailyTextLimit}/day is where I stop on texts. Email or Telegram if you need more today.`,
    `Wrapped texts for today: {dailyTextLimit} messages. Email me, hit Telegram, or come back in the morning.`,
    `Offline on this thread at {dailyTextLimit} texts. Email or Telegram still work today, otherwise pick this up tomorrow.`,
    `Pausing texts here. Daily cap is {dailyTextLimit}. Email or Telegram if you want to keep talking, or see you tomorrow.`,
    `Reached today's {dailyTextLimit} texts. Email or Telegram to continue today, otherwise tomorrow.`,
    `Texts are done at {dailyTextLimit} today. Email or Telegram me if there's more, or talk in the morning.`,
    `Heads up. You're at today's {dailyTextLimit} text ceiling. Email or Telegram works if you want more today.`,
    `Save texts for tomorrow, or hit me on email or Telegram. I cap texts at {dailyTextLimit}/day.`,
    `{dailyTextLimit} texts for the day. Email or Telegram me anytime, otherwise back tomorrow.`,
    `Out on texts for today. {dailyTextLimit} is the daily limit. Email or Telegram still works.`,
    `Caught up to today's {dailyTextLimit} text cap. Email or Telegram still open, or continue tomorrow.`,
    `Daily text limit at {dailyTextLimit} reached. Email or Telegram if you want to keep going today.`,
    `Texts are off until tomorrow. I cap at {dailyTextLimit}/day so this thread doesn't become a notification machine. Email or Telegram still work today.`,
  ],
  "linq.home_redirect": [
    `Your main Murph thread is on a different number. Text me here so things stay in one place:
{homeRecipientPhone}`,
    `You're already set up with Murph. Save this and message me there instead:
{homeRecipientPhone}`,
    `Heads up, you've got another Murph line that I reply on. Use:
{homeRecipientPhone}`,
    `Quick redirect. I reply from your main Murph number:
{homeRecipientPhone}`,
    `Your active Murph line lives here. Easier if we keep things on:
{homeRecipientPhone}`,
    `Looks like you're texting the wrong thread. Your active line is:
{homeRecipientPhone}`,
    `I'm on another number for you. Move the conversation over to:
{homeRecipientPhone}`,
    `You're connected, just not on the right line. Continue here:
{homeRecipientPhone}`,
    `Save my number and we'll continue there:
{homeRecipientPhone}`,
    `Two threads going. The one I actually reply on is:
{homeRecipientPhone}`,
    `I'm running from a different number for you. Switch to:
{homeRecipientPhone}`,
    `Hey, this isn't your home Murph thread. Text me at:
{homeRecipientPhone}`,
    `Move over to your Murph line and I'll meet you there:
{homeRecipientPhone}`,
    `Already running on another line for you. Save:
{homeRecipientPhone}`,
    `Wrong thread, easy fix. Your Murph line is:
{homeRecipientPhone}`,
    `That's the line I reply on for you. Continue our Murph chat at:
{homeRecipientPhone}`,
    `Tap to save and we can pick this up at:
{homeRecipientPhone}`,
    `I keep replies on one Murph line per person. Yours is here:
{homeRecipientPhone}`,
    `Got you, just on a different number than this one. Your line:
{homeRecipientPhone}`,
    `Let's move this over. My number for you:
{homeRecipientPhone}`,
  ],
  "linq.ai_usage.trial_conversion_pending": [
    `Trial's done. Head to the site to keep this going:
{homeUrl}`,
    `Your trial ended. There's more setup here to continue:
{homeUrl}`,
    `Want to keep going? Tap to finish account setup:
{homeUrl}`,
    `After the trial, more to do on the site:
{homeUrl}`,
    `Trial ended. Head to the site whenever you're ready:
{homeUrl}`,
    `Heads up, your trial finished. Setup to take care of to keep me on:
{homeUrl}`,
    `Trial done. Setup waits on the site:
{homeUrl}`,
    `Setup to finish after the trial to keep things going:
{homeUrl}`,
    `If the trial was useful, there's setup to finish here:
{homeUrl}`,
    `Out of trial. Want to continue? Take care of it over here:
{homeUrl}`,
    `Things pick back up after finishing setup on the site:
{homeUrl}`,
    `Your trial's over. Tap to take care of the rest when you're ready:
{homeUrl}`,
    `Pick back up after finishing setup: {homeUrl}`,
    `End of trial. Setup to finish to keep going:
{homeUrl}`,
    `Continue on the site when you're ready: {homeUrl}`,
    `Looks like the trial's done. Setup to take care of on the site:
{homeUrl}`,
    `Now that the trial's done, the rest is on the site:
{homeUrl}`,
    `Your trial closed out. Setup is waiting on the site:
{homeUrl}`,
    `That was the trial. The rest is here: {homeUrl}`,
    `Trial's done. If you want me to keep replying, setup is on the site:
{homeUrl}`,
  ],
  "linq.ai_usage.trial_limit_reached": [
    `Used up the AI included in your trial. There's setup to finish on the site to keep going:
{homeUrl}`,
    `AI from the trial is spent. Take care of setup to pick it back up:
{homeUrl}`,
    `You hit the AI cap that came with the trial. Finish setup on the site:
{homeUrl}`,
    `The trial allowance is done. Take care of setup here:
{homeUrl}`,
    `Capped on the trial AI. There's setup to take care of on the site:
{homeUrl}`,
    `Out of trial AI. Tap to finish setup when you're ready:
{homeUrl}`,
    `Hit the included trial usage. Setup to take care of to keep this going:
{homeUrl}`,
    `Your trial allowance is used. Head to the site to keep replies on:
{homeUrl}`,
    `Cap on the trial AI is reached. Continue once setup is done:
{homeUrl}`,
    `Finished the trial AI. Head to the site to keep things going:
{homeUrl}`,
    `Trial AI is done. The site has the rest:
{homeUrl}`,
    `That's the trial usage cap. Setup to finish to continue:
{homeUrl}`,
    `Heads up, trial AI is used. Take care of setup here: {homeUrl}`,
    `Ran out of trial AI. The site has more setup waiting:
{homeUrl}`,
    `You're out of trial AI. Tap to finish setup and keep this thread going:
{homeUrl}`,
    `Maxed the trial usage. Setup to take care of if you want to continue:
{homeUrl}`,
    `Allowance from the trial is up. Setup left to do on the site:
{homeUrl}`,
    `Reached the AI cap on the trial. Finish setup here: {homeUrl}`,
    `Spent the trial usage. Pick this up after finishing setup:
{homeUrl}`,
    `Through the trial AI. Setup left to finish to keep replying:
{homeUrl}`,
  ],
  "linq.ai_usage.edge_limit_reached": [
    `Hit this month's allowance. I'll resume when it resets:
{homeUrl}`,
    `Out for the month. Replies pick up when the allowance resets:
{homeUrl}`,
    `Monthly cap reached. I'll be back at next reset:
{homeUrl}`,
    `That's the monthly Edge allowance done. Back when it resets:
{homeUrl}`,
    `The allowance is used for the month. Resumes at reset:
{homeUrl}`,
    `Reached this month's cap. See you after the next reset:
{homeUrl}`,
    `Allowance is spent for the month. I come back at reset:
{homeUrl}`,
    `You're out of usage for this month. Resets bring me back:
{homeUrl}`,
    `Used up your Edge allowance for the month. Back at the next reset:
{homeUrl}`,
    `Heads up, this month's cap is hit. I'll resume after reset:
{homeUrl}`,
    `Done for the month. Reset is when I'm back:
{homeUrl}`,
    `Maxed the monthly cap. I pick back up after reset:
{homeUrl}`,
    `Wrapped this month's allowance. Back at reset:
{homeUrl}`,
    `Cap reached for the month. Replies return at reset:
{homeUrl}`,
    `Through this month's allowance. I'll be ready at reset:
{homeUrl}`,
    `This month's usage is done. Account details: {homeUrl}`,
    `Topped out on Edge this month. Reset turns replies back on: {homeUrl}`,
    `Limit hit for the month. Account info if you need it: {homeUrl}`,
    `Spent this month's allowance. I'm back at reset:
{homeUrl}`,
    `End of this month for me. Reset is when I return:
{homeUrl}`,
  ],
  "linq.ai_usage.family_limit_reached": [
    `I've reached the included usage on your Family access this month. I'll resume when it resets:
{homeUrl}`,
    `Your included Family usage is spent for the month. Replies pick back up at reset:
{homeUrl}`,
    `Monthly usage on your Family access is reached. I come back when it resets:
{homeUrl}`,
    `That's the included usage on your Family access for this period. Back at reset:
{homeUrl}`,
    `Out of your included Family usage for the month. I'll resume after the reset:
{homeUrl}`,
    `Reached your Family usage limit. Replies return when the allowance refreshes:
{homeUrl}`,
    `Your included Family usage is used this month. I'll be back after reset:
{homeUrl}`,
    `Your Family usage is maxed for now. Reset brings replies back:
{homeUrl}`,
    `This month's included Family usage is done. Account details are here:
{homeUrl}`,
    `Heads up, your Family access hit its monthly usage limit. I resume at reset:
{homeUrl}`,
    `Your included Family usage is tapped out for the month. I'll pick up after reset:
{homeUrl}`,
    `Your Family usage is spent this period. Replies restart when it resets:
{homeUrl}`,
    `Your Family usage limit is reached. I'll be ready again at the next reset:
{homeUrl}`,
    `Your Family access is through this month's included usage. Back when it refreshes:
{homeUrl}`,
    `Used up your included Family usage for this period. I return after reset:
{homeUrl}`,
    `No more included Family usage this month. The reset turns replies back on:
{homeUrl}`,
    `This period's included Family usage is used. I'll resume when it renews:
{homeUrl}`,
    `Your Family usage limit is reached for the month. Check account details here:
{homeUrl}`,
    `Your monthly Family usage limit is hit. I'll pick this up after reset:
{homeUrl}`,
    `Your included Family usage is done for this month. Reset is when I come back:
{homeUrl}`,
  ],
  "linq.ai_usage.thread_limit_reached": [
    `This chat has used its included Murph usage for the month. I'll reply again after it resets.`,
    `The included Murph usage for this chat is used for the month. Replies pick back up at reset.`,
    `This chat reached its monthly Murph usage limit. I'll be back after the reset.`,
    `That's the included Murph usage for this chat this month. Replies resume when it resets.`,
    `This chat is out of included Murph usage for the month. I'll reply again after reset.`,
    `The monthly Murph usage for this chat is used. I come back when it refreshes.`,
    `This chat hit its included usage limit for the month. Replies return at reset.`,
    `Included Murph usage is maxed for this chat this month. Reset brings replies back.`,
    `This month's included Murph usage for the chat is done. Replies resume after reset.`,
    `Heads up, this chat reached its monthly included usage. I resume at reset.`,
    `The chat's included Murph usage is tapped out for the month. I'll pick up after reset.`,
    `This chat's monthly usage is spent. Replies restart when it resets.`,
    `This chat reached its Murph usage limit. I'll be ready again at the next reset.`,
    `The chat is through its included Murph usage for the month. Back when it refreshes.`,
    `Used up the included Murph usage for this chat this month. I return after reset.`,
    `No more included Murph usage in this chat this month. The reset turns replies back on.`,
    `This chat's included usage is used for the period. I'll resume when it renews.`,
    `This chat hit its monthly Murph limit. Replies return after reset.`,
    `The chat's monthly included usage is reached. I'll pick this up after reset.`,
    `Included Murph usage is done for this chat this month. Reset is when I come back.`,
  ],
  "linq.ai_usage.pulse_upgrade_edge": [
    `Hit this month's cap. Upgrade for more room if you want it: {homeUrl}`,
    `Monthly allowance is used. The upgrade (Edge) unlocks more, or wait for reset:
{homeUrl}`,
    `Out for the month on Pulse. Edge (the upgrade) is one option, otherwise back at reset:
{homeUrl}`,
    `Cap reached. Move up a tier (Edge) for more headroom this month:
{homeUrl}`,
    `That's this month's allowance. The next tier is here if you want more now:
{homeUrl}`,
    `Done with the month. Upgrading to Edge picks up where this left off:
{homeUrl}`,
    `Used up usage for the month. Edge has more if you need it:
{homeUrl}`,
    `Reached the monthly cap. Upgrade to Edge for more, or wait for reset:
{homeUrl}`,
    `Heads up, you're at the monthly cap. Edge (more usage) is the upgrade path: {homeUrl}`,
    `Maxed this month. The next tier keeps things going through reset:
{homeUrl}`,
    `You're at the monthly cap. The Edge tier gives you more this period:
{homeUrl}`,
    `Allowance is spent this month. Upgrade if you want more now:
{homeUrl}`,
    `Wrapped this month's usage. The next tier has more capacity if you need it:
{homeUrl}`,
    `More usage on the next tier (Edge). Cap hit this month:
{homeUrl}`,
    `Topped out for the month. Edge (the upgrade) if you want to keep going:
{homeUrl}`,
    `This month's allowance is done. Edge for more, otherwise reset brings replies back:
{homeUrl}`,
    `Spent your monthly allowance. The upgrade (Edge) if more is useful right now: {homeUrl}`,
    `End of the month for me. The next tier gives you more headroom:
{homeUrl}`,
    `Through this month's usage. Upgrading if you want to keep going:
{homeUrl}`,
    `Wait for reset or upgrade. Monthly cap is hit:
{homeUrl}`,
  ],
} satisfies Record<UserFacingMessageTemplateKey, readonly string[]>

assertUserFacingMessageTemplateCoverage()

export function renderUserFacingMessage<K extends UserFacingMessageTemplateKey>(
  input: RenderUserFacingMessageInput<K>,
): RenderedUserFacingMessage {
  const templates = USER_FACING_MESSAGE_TEMPLATES[input.key]
  const variantIndex = selectUserFacingMessageVariantIndex({
    seed: input.seed,
    variantCount: templates.length,
  })

  return renderUserFacingMessageAtIndex({
    context: input.context,
    key: input.key,
    variantIndex,
  })
}

function renderUserFacingMessageAtIndex<K extends UserFacingMessageTemplateKey>(
  input: {
    context: UserFacingMessageContextByKey[K]
    key: K
    variantIndex: number
  },
): RenderedUserFacingMessage {
  const templates = USER_FACING_MESSAGE_TEMPLATES[input.key]
  if (input.variantIndex < 0 || input.variantIndex >= templates.length) {
    throw new RangeError(`User-facing message variant index is out of range for ${input.key}.`)
  }

  const template = templates[input.variantIndex]
  if (!template) {
    throw new RangeError(`User-facing message variant is missing for ${input.key}.`)
  }

  return { text: renderUserFacingMessageTemplate(template, input.context) }
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

function assertUserFacingMessageTemplateCoverage(): void {
  for (const key of USER_FACING_MESSAGE_TEMPLATE_KEYS) {
    const variantCount = USER_FACING_MESSAGE_TEMPLATES[key].length
    if (variantCount < USER_FACING_MESSAGE_MIN_VARIANT_COUNT) {
      throw new TypeError(
        `User-facing message template ${key} requires at least ${USER_FACING_MESSAGE_MIN_VARIANT_COUNT} variants.`,
      )
    }
  }
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
