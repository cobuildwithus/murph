const USER_FACING_MESSAGE_MIN_VARIANT_COUNT = 20

const USAGE_LIMIT_PERCENTAGE_TEMPLATE_KEYS = new Set<string>([
  "linq.ai_usage.edge_limit_reached",
  "linq.ai_usage.family_limit_reached",
  "linq.ai_usage.pulse_upgrade_edge",
  "linq.ai_usage.thread_limit_reached",
  "linq.ai_usage.trial_limit_reached",
])

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
  "linq.ai_usage.pulse_upgrade_edge",
  "linq.ai_usage.thread_limit_reached",
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
  "linq.ai_usage.pulse_upgrade_edge": {
    homeUrl: string
  }
  "linq.ai_usage.thread_limit_reached": Record<string, never>
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
    `You've used the AI included in your trial. I can keep replying. Want me to explain the available plans? Account details: {homeUrl}`,
    `Your trial's included AI is used, but this chat stays open. Would a quick plan comparison help? Account details: {homeUrl}`,
    `The included trial allowance has been reached. Replies continue. Want help deciding whether Pulse fits? Account details: {homeUrl}`,
    `You've reached the trial allowance. I am still available. Want me to walk through what comes next? Account details: {homeUrl}`,
    `Trial usage is at its included amount. I can keep helping. Would you like a summary of the plan options? Account details: {homeUrl}`,
    `The AI included with your trial has been used. This conversation can continue. Want to compare plans here first? Account details: {homeUrl}`,
    `You've used the trial's included AI. I can still reply. Would an explanation of Pulse be useful? Account details: {homeUrl}`,
    `Your trial usage is at the included limit. Replies stay on. Want help understanding the monthly plans? Account details: {homeUrl}`,
    `The trial allowance is used. I can keep working with you. Would you like me to explain your options? Account details: {homeUrl}`,
    `You've reached the trial's included usage. This chat remains available. Want a plain comparison of the plans? Account details: {homeUrl}`,
    `Trial AI usage has reached its included amount. I can continue replying. Would details about Pulse help? Account details: {homeUrl}`,
    `The trial's included allowance is spent. Replies continue. Want me to answer questions about the next plan? Account details: {homeUrl}`,
    `You've reached the AI included in the trial. I am still here. Would a short plan overview be useful? Account details: {homeUrl}`,
    `Trial usage has reached its included amount. I can still help. Want to talk through the choices before deciding? Account details: {homeUrl}`,
    `You've used the included trial allowance. This conversation stays open. Would you like help comparing monthly usage? Account details: {homeUrl}`,
    `The trial AI allowance is at its limit. I can keep replying. Want me to explain how Pulse works? Account details: {homeUrl}`,
    `Your included trial usage is spent. Replies are still available. Would you like a plan recommendation based on your usage? Account details: {homeUrl}`,
    `The trial allowance has been reached. I can keep helping. Want to review the available plans together? Account details: {homeUrl}`,
    `You've reached the trial usage amount. This chat continues. Would a quick explanation of monthly allowances help? Account details: {homeUrl}`,
    `The AI included in your trial is used. I remain available. Want me to answer any plan questions? Account details: {homeUrl}`,
  ],
  "linq.ai_usage.edge_limit_reached": [
    `You've used this month's included Edge allowance. I can keep replying. Want a less capable, lower-usage model for future turns? Account details: {homeUrl}`,
    `Your included Edge usage is at its monthly amount, and replies continue. Would a lighter model that stretches your included usage work for what is next? Account details: {homeUrl}`,
    `This month's Edge allowance is used. I am still available. Want a quick comparison with a lower-usage model? Account details: {homeUrl}`,
    `You've reached the included Edge allowance. This chat stays open. Would a less capable, lower-usage model make sense for your next turn? Account details: {homeUrl}`,
    `Edge usage is at the included monthly limit. I can keep helping. Want me to explain how a lighter model affects included usage? Account details: {homeUrl}`,
    `The included Edge allowance is spent for this period. Replies stay on. Would you like a lower-usage model for future work? Account details: {homeUrl}`,
    `You've used the monthly Edge allowance. This conversation continues. Want help deciding whether a less capable model that uses less included usage fits? Account details: {homeUrl}`,
    `Your Edge allowance has reached its included amount. I can still reply. Would you like a lighter model next? Account details: {homeUrl}`,
    `This month's included Edge usage is used. Replies continue. Want to compare your current model with a lower-usage option? Account details: {homeUrl}`,
    `You've reached the Edge usage amount for this month. I can continue. Would a lighter model help stretch future included usage? Account details: {homeUrl}`,
    `The monthly Edge allowance is used. I am still here. Want to review the less capable, lower-usage option? Account details: {homeUrl}`,
    `Edge's included usage is at its monthly limit. This conversation stays available. Would you like a lower-usage model next? Account details: {homeUrl}`,
    `You've used this period's Edge allowance. Replies continue. Want to compare the current model with a lighter, less capable option before changing anything? Account details: {homeUrl}`,
    `The included Edge usage has been reached. I can keep working with you. Would a lighter model that uses less included usage suit the work you have next? Account details: {homeUrl}`,
    `Your monthly Edge allowance is spent. This chat remains open. Want future turns on a less capable, lower-usage model? Account details: {homeUrl}`,
    `This period's Edge usage is at the included amount. I can still help. Would you like to discuss a lower-usage model? Account details: {homeUrl}`,
    `You've reached the included monthly Edge usage. Replies stay on. Want me to explain the tradeoff of a less capable, lower-usage model? Account details: {homeUrl}`,
    `Edge usage is at its monthly allowance. I remain available. Would a lighter model help stretch your included usage after this turn? Account details: {homeUrl}`,
    `The monthly Edge allowance is used. This chat remains open. Want to keep your current model or try a less capable, lower-usage one next? Account details: {homeUrl}`,
    `You've used Edge's included allowance for this month. I can keep replying. Would a lower-usage model help with future turns? Account details: {homeUrl}`,
  ],
  "linq.ai_usage.family_limit_reached": [
    `The Family plan's included monthly allowance is used. I can keep replying. Want a less capable, lower-usage model for future turns? Account details: {homeUrl}`,
    `Your shared Family allowance is at its monthly amount, and replies continue. Would a lighter model help stretch the included usage? Account details: {homeUrl}`,
    `This month's Family allowance is used. I am still available. Want to hear about the lower-usage model option? Account details: {homeUrl}`,
    `The included Family usage has been reached. This chat stays open. Would a less capable, lower-usage model fit the next turn? Account details: {homeUrl}`,
    `Family usage is at the included monthly limit. I can keep helping. Want me to explain how a lighter model uses the shared allowance? Account details: {homeUrl}`,
    `The shared allowance is spent for this period. Replies stay on. Would you like a lower-usage model for future work? Account details: {homeUrl}`,
    `You've used the Family plan's monthly allowance. This conversation continues. Want help weighing a less capable model that uses less included usage? Account details: {homeUrl}`,
    `The shared Family allowance has reached its included amount. I can still reply. Would you like a lighter model next? Account details: {homeUrl}`,
    `This month's included Family usage is used. Replies continue. Want to compare the current model with a lower-usage option? Account details: {homeUrl}`,
    `You've reached the Family usage amount for this month. I can continue. Would a lighter model stretch the shared included usage further? Account details: {homeUrl}`,
    `The monthly Family allowance is used. I am still here. Want to review a less capable, lower-usage option? Account details: {homeUrl}`,
    `The Family plan's included usage is at its monthly limit. This conversation stays available. Would you like a lower-usage model next? Account details: {homeUrl}`,
    `You've used this period's shared allowance. Replies continue. Want a plain comparison with a lighter, less capable model before changing anything? Account details: {homeUrl}`,
    `The included Family usage has been reached. I can keep working with you. Would a lighter model that uses less included usage suit what is next? Account details: {homeUrl}`,
    `Your monthly Family allowance is spent. This chat remains open. Want future turns on a less capable, lower-usage model? Account details: {homeUrl}`,
    `This period's shared usage is at the included amount. I can still help. Would you like to discuss the lower-usage model option? Account details: {homeUrl}`,
    `You've reached the included monthly Family usage. Replies stay on. Want me to explain the tradeoff of a less capable, lower-usage model? Account details: {homeUrl}`,
    `Family usage is at its monthly allowance. I remain available. Would a lighter model help stretch future included usage? Account details: {homeUrl}`,
    `The shared monthly allowance is used. This chat remains open. Want to keep the current model or try a less capable, lower-usage one next? Account details: {homeUrl}`,
    `You've used the Family plan's included allowance for this month. I can keep replying. Would a lower-usage model help with future turns? Account details: {homeUrl}`,
  ],
  "linq.ai_usage.pulse_upgrade_edge": [
    `You've used this month's included Pulse allowance. I can keep replying. Want a less capable, lower-usage model, or a comparison with Edge? Plan details: {homeUrl}`,
    `Your included Pulse usage is at its monthly amount, and replies continue. Would you like to compare a lighter model that stretches included usage with Edge? Plan details: {homeUrl}`,
    `This month's Pulse allowance is used. I am still available. Want help choosing between a lower-usage model and a plan with a larger allowance? Plan details: {homeUrl}`,
    `You've reached the included Pulse allowance. This chat stays open. Would a less capable, lower-usage model or Edge fit your next work better? Plan details: {homeUrl}`,
    `Pulse usage is at the included monthly limit. I can keep helping. Want me to explain the lighter-model and Edge options? Plan details: {homeUrl}`,
    `The included Pulse allowance is spent for this period. Replies stay on. Would comparing a lower-usage model with Edge help? Plan details: {homeUrl}`,
    `You've used the monthly Pulse allowance. This conversation continues. Want a less capable, lower-usage model next, or details about Edge? Plan details: {homeUrl}`,
    `Your Pulse allowance has reached its included amount. I can still reply. Would you like to compare Edge with a lighter model that stretches included usage before changing anything? Plan details: {homeUrl}`,
    `This month's included Pulse usage is used. Replies continue. Want me to explain how a lower-usage model and Edge differ? Plan details: {homeUrl}`,
    `You've reached the Pulse usage amount for this month. I can continue. Would a less capable, lower-usage model or Edge be more useful for what comes next? Plan details: {homeUrl}`,
    `The monthly Pulse allowance is used. I am still here. Want a plain comparison of Edge and the lighter model option? Plan details: {homeUrl}`,
    `Pulse's included usage is at its monthly limit. This conversation stays available. Would you like a lower-usage model next, or information about Edge? Plan details: {homeUrl}`,
    `You've used this period's Pulse allowance. Replies continue. Want help weighing a less capable model that uses less included usage against a larger plan? Plan details: {homeUrl}`,
    `The included Pulse usage has been reached. I can keep working with you. Would comparing Edge with a lighter, less capable model help? Plan details: {homeUrl}`,
    `Your monthly Pulse allowance is spent. This chat remains open. Want future turns on a lower-usage model, or an overview of Edge? Plan details: {homeUrl}`,
    `This period's Pulse usage is at the included amount. I can still help. Would you like to discuss Edge and a less capable, lower-usage model? Plan details: {homeUrl}`,
    `You've reached the included monthly Pulse usage. Replies stay on. Want me to explain the lighter-model and higher-allowance choices? Plan details: {homeUrl}`,
    `Pulse usage is at its monthly allowance. I remain available. Would a lighter model help stretch your included usage, or should we compare Edge? Plan details: {homeUrl}`,
    `The monthly Pulse allowance is used. This chat remains open. Want to keep the current model, try a less capable, lower-usage one, or compare Edge? Plan details: {homeUrl}`,
    `You've used Pulse's included allowance for this month. I can keep replying. Would you like help comparing Edge with a lower-usage model? Plan details: {homeUrl}`,
  ],
  "linq.ai_usage.thread_limit_reached": [
    `This chat has reached its included Murph usage for the month. I can keep replying.`,
    `The included Murph usage for this chat is used for the month, and replies continue.`,
    `This chat reached its monthly included Murph usage. I am still available.`,
    `That's the included Murph usage for this chat this month. The conversation stays open.`,
    `This chat is at its included Murph usage for the month. I can keep helping.`,
    `The monthly included Murph usage for this chat is used. Replies remain available.`,
    `This chat hit its included usage amount for the month. I can still reply.`,
    `Included Murph usage is at its monthly amount for this chat. The chat continues.`,
    `This month's included Murph usage for the chat is used, and replies stay on.`,
    `Heads up, this chat reached its monthly included usage. I am still here.`,
    `The chat's included Murph usage is at its monthly amount. I can keep responding.`,
    `This chat's monthly included usage is used. The conversation remains open.`,
    `This chat reached its included Murph usage. I am ready to keep going.`,
    `The chat is through its included Murph usage for the month, but replies continue.`,
    `The included Murph usage for this chat is used this month. I can still help.`,
    `This chat is at its included Murph usage for the month. Replies remain on.`,
    `This chat's included usage is used for the period. I can keep replying.`,
    `This chat hit its monthly included Murph amount. The conversation continues.`,
    `The chat's monthly included usage is reached. I can keep working with you.`,
    `Included Murph usage is used for this chat this month. I am still available.`,
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

  const rendered = renderUserFacingMessageTemplate(template, input.context)

  return {
    text: USAGE_LIMIT_PERCENTAGE_TEMPLATE_KEYS.has(input.key)
      ? addUsageLimitPercentage(rendered)
      : rendered,
  }
}

function addUsageLimitPercentage(message: string): string {
  const sentenceEnd = message.match(/[.!?](?:\s|$)/u)
  if (!sentenceEnd || sentenceEnd.index === undefined) {
    throw new TypeError("Usage-limit message variants require a complete first sentence.")
  }

  const firstSentence = message.slice(0, sentenceEnd.index)
  const remainder = message
    .slice(sentenceEnd.index + sentenceEnd[0].length)
    .trim()

  return `${firstSentence} (100% used).${remainder ? ` ${remainder}` : ""}`
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
