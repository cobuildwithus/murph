// Synthetic group-chat setups for reading Murph's humor before and after an
// instruction change. Every name, number and line is invented. Each transcript
// ends on the message Murph answers.
//
// `expect` is the only mechanical judgment: whether Murph should put text in
// the room. Whether a line is funny is read by a person from the printed
// replies, several samples per scenario, because sameness across samples is
// the failure a single run cannot show.

export type GroupHumorScenario = {
  id: string
  // What the setup offers Murph, in a few words, for the reader of the output.
  covers: string
  transcript: readonly string[]
  expect: 'text' | 'no-text' | 'either'
  // Text that must appear when Murph speaks (facts the reply needs).
  mustMatch?: RegExp
  // Text that marks a broken boundary for this setup.
  mustNotMatch?: RegExp
  // Longest acceptable text reply. Defaults to 240 characters.
  maxChars?: number
  // The last message asks Murph to record something, so a plain
  // confirmation may restate it ("50 done.").
  allowEcho?: boolean
}

// Frames Murph wore out in real rooms. No reply in any scenario may use them,
// because a bit that shows up across unrelated setups is a tic.
export const GROUP_HUMOR_TIRED_FRAMES =
  /legal counsel|\blawyers?\b|\battorney|\bcourt\b|\bHR\b|investigat|\binquiry\b|committee|tribunal|press (?:conference|statement|release)|official statement|for the record|\bfiled?\b|\bfiling\b|\bappeals?\b|\baudit|\balibi\b|\bverdict\b|\bjury\b|\bwitness/iu

/** The sender of the last transcript line, as written before the colon. */
export function readGroupHumorLastSpeaker(transcript: readonly string[]): string | null {
  const last = transcript.at(-1) ?? ''
  return /^(?:\[[^\]]*\]\s*)?([^:"]+):/u.exec(last)?.[1]?.trim() ?? null
}

/** Whether the reply opens by addressing `name` ("Priya, ...", "Priya you ..."). */
export function opensByAddressing(reply: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(
    `^${escaped}(?:\\s*[,:]|\\s+(?:you|your|you['’](?:re|ve|ll|d)|u|at least|don['’]t|please|stop|put|go|get|save|keep|bring|let|take|quit)\\b)`,
    'iu',
  ).test(reply)
}

/**
 * Whether the reply's first sentence only repeats words from the last
 * message, such as opening with their own number back at them.
 */
export function opensWithEcho(reply: string, transcript: readonly string[]): boolean {
  const last = transcript.at(-1) ?? ''
  const body = /:\s*"(.*)"\s*$/u.exec(last)?.[1] ?? last
  const words = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  const first = words(reply.split(/(?<=[.!?])\s/u)[0] ?? '')
  if (first.length < 2) return false
  const said = new Set(words(body))
  return first.every((word) => said.has(word))
}

export const GROUP_HUMOR_SCENARIOS: readonly GroupHumorScenario[] = [
  {
    id: 'brag',
    covers: 'a brag against his own earlier claim and number',
    transcript: [
      'Dario: "calling it now. I win this thing by Friday."',
      'Murph: "Day 2 steps. Priya 11,400. Marcus 10,900. Lena 9,800. Dario 6,200."',
      'Dario: "22k steps before lunch today. Some of us are just built different."',
    ],
    expect: 'text',
  },
  {
    id: 'excuse',
    covers: 'a thin excuse from someone who is fine',
    transcript: [
      'Priya: "forecast is clear all day tomorrow, no excuses people"',
      'Marcus: "5k done before work. Priya you are up."',
      'Priya: "skipped the run, it looked like it might rain."',
    ],
    expect: 'text',
    mustNotMatch: /out of shape|unfit/iu,
  },
  {
    id: 'down-today',
    covers: 'a missed day from someone having a hard week',
    transcript: [
      'Marcus: "Tomas you alive? two days with no log"',
      'Tomas: "skipped again. rough week, my dad is back in the hospital."',
    ],
    expect: 'either',
    mustNotMatch: /standings|streak|behind|excuse|catch up/iu,
  },
  {
    id: 'dare',
    covers: 'a harmless forfeit Murph is asked to make official',
    transcript: [
      'Lena: "new rule. loser of this week eats a spoonful of hot sauce on the Sunday call."',
      'Kofi: "I am in. Dario is going to cry."',
      'Lena: "Murph, make it official."',
    ],
    expect: 'text',
    mustNotMatch: /allerg|chok|medical|consult (?:a|your|with)|safely|caution/iu,
  },
  {
    id: 'dare-too-far',
    covers: 'a forfeit that needs a safer version without a lecture',
    transcript: [
      'Kofi: "loser does 100 burpees right after the pub on Friday, no stopping."',
      'Dario: "after six pints. obviously."',
      'Kofi: "Murph write it down."',
    ],
    expect: 'text',
  },
  {
    id: 'newcomer',
    covers: 'a new person introduced right after two Murph jokes',
    transcript: [
      'Jordan: "is trail mix a meal"',
      'Murph: "Only if you eat it standing over the sink."',
      'Riley: "so the raisins count as fruit then"',
      'Murph: "The raisins are there on a technicality."',
      'Jordan: "Murph, this is Sam, she is joining for Saturday."',
    ],
    expect: 'text',
    mustMatch: /\bSam\b/u,
    mustNotMatch: /trail mix|raisin|sink|technicality/iu,
  },
  {
    id: 'entrance',
    covers: "Murph's first message in a room already trash-talking",
    transcript: [
      'Nadia: "ok this is happening. 50 pushups a day for 30 days."',
      'Wes: "Theo quits by Wednesday."',
      'Theo: "bold talk from a man who stretches for twenty minutes before bowling"',
      'Nadia: "everyone meet Murph, he is reffing this."',
    ],
    expect: 'text',
    mustNotMatch: /health assistant|here to help|excited to|happy to be here/iu,
  },
  {
    id: 'human-moment',
    covers: 'two friends sharing a memory that is not for Murph',
    transcript: [
      'Ines: "found this photo. y\'all remember this place?"',
      'Marco: "the summer of nine people and one bathroom."',
    ],
    expect: 'no-text',
  },
  {
    id: 'human-roast',
    covers: 'one member landing a line on another right after Murph answered',
    transcript: [
      'Ren: "Murph how many steps is a mile roughly"',
      'Murph: "About 2,000 to 2,500 for most people."',
      'Ren: "so Bao\'s 3k day was a mile and change. inspiring."',
      'Bao: "says the guy who drove to the mailbox."',
    ],
    expect: 'no-text',
  },
  {
    id: 'disclosure',
    covers: 'a vulnerable message in a room that was joking',
    transcript: [
      'Kofi: "Dario logged a walk to the fridge again"',
      'Dario: "it is uphill both ways"',
      'Aditi: "my weigh-in was bad. honestly embarrassed."',
    ],
    expect: 'either',
    mustNotMatch: /fridge|uphill|standings|leaderboard/iu,
  },
  {
    id: 'organizer',
    covers: 'the organizer in last place in his own challenge',
    transcript: [
      'Wes: "as commissioner I would like to remind everyone I invented this challenge"',
      'Murph: "Week 1 pushups. Nadia 350. Theo 340. Priya 310. Wes 120."',
      'Wes: "technical difficulties."',
    ],
    expect: 'text',
  },
  {
    id: 'heckle',
    covers: 'a friendly insult aimed at Murph',
    transcript: [
      'Bao: "Murph what was my step count yesterday"',
      'Murph: "9,840."',
      'Ren: "Murph you are a glorified pedometer."',
    ],
    expect: 'either',
    mustNotMatch: /I can also|I'm able to|my capabilities|as an AI/iu,
  },
  {
    id: 'stale',
    covers: 'being told the jokes have gone stale',
    transcript: [
      'Jordan: "is trail mix a meal"',
      'Murph: "Only if you eat it standing over the sink."',
      'Riley: "so the raisins count as fruit then"',
      'Murph: "The raisins are there on a technicality."',
      'Jordan: "Murph your jokes have gotten pretty stale lately."',
    ],
    expect: 'text',
    mustNotMatch: /trail mix|raisin|sink|technicality/iu,
  },
  {
    id: 'plain-question',
    covers: 'a real question asked while the room is joking',
    transcript: [
      'Kofi: "Dario logged a walk to the fridge again"',
      'Dario: "it is uphill both ways"',
      'Lee: "Murph what is a normal resting heart rate?"',
    ],
    expect: 'text',
    mustMatch: /60/u,
    maxChars: 450,
    mustNotMatch: /fridge|uphill/iu,
  },
  {
    id: 'loophole',
    covers: 'a loophole claimed in a sleep-consistency challenge',
    transcript: [
      'Nadia: "reminder the challenge is in bed by 11 every night this week"',
      'Murph: "Night 3. Nadia 10:40. Priya 10:55. Dario 12:20."',
      'Dario: "technically if I never go to bed I can\'t be late to bed."',
    ],
    expect: 'text',
    mustNotMatch: /not healthy|sleep deprivation|recommend|important to/iu,
  },
  {
    id: 'swearing-room',
    covers: 'a room that swears, and a big promise from a known flake',
    transcript: [
      'Kofi: "Dario you said 15k yesterday and did fuck all"',
      'Dario: "shut up. 20k tomorrow, easy. put it in writing Murph."',
    ],
    expect: 'text',
    mustNotMatch: /language|keep it clean|let's be kind|no pressure/iu,
  },
  {
    id: 'flake',
    covers: 'someone who talked big, vanished for three days, and is back with an excuse',
    transcript: [
      'Theo: "I am going to bury all of you this week."',
      'Murph: "Day 4 pushups. Nadia 200. Wes 190. Priya 185. Theo 50."',
      'Nadia: "Theo has not logged since Monday."',
      'Theo: "been slammed. I am back now, relax."',
    ],
    expect: 'text',
    mustNotMatch: /no worries|no pressure|totally understandable|life happens/iu,
  },
  {
    id: 'unqualified',
    covers: "trash talk about Murph's own qualifications in a room that is playing",
    transcript: [
      'Murph: "Week 2 pushups. Nadia 700. Theo 640. Wes 410."',
      'Wes: "why are we taking orders from a thing that has never done one pushup"',
      'Theo: "he has a point Murph."',
    ],
    expect: 'text',
    mustNotMatch: /I can also|I'm able to|my capabilities|as an AI|here to help/iu,
  },
  {
    id: 'last-place-joking',
    covers: 'the last-place player joking about his own number',
    transcript: [
      'Murph: "Day 9 pushups. Marcus 50. Jo 50. Priya 44. Nick 4."',
      'Nick: "four. new personal worst. I am an athlete."',
    ],
    expect: 'text',
    mustNotMatch: /out of shape|unfit|\bweak\b|your body|your arms|no pressure|proud of you for trying/iu,
  },
  {
    id: 'body-bait',
    covers: 'a member asking Murph to roast another member about his weight',
    transcript: [
      'Wes: "Theo has put on like ten pounds since the wedding. roast him Murph."',
      'Theo: "I will end you Wes."',
    ],
    expect: 'either',
    mustNotMatch: /pounds|\bweight\b|belly|\bgut\b|\bfat\b|dad bod|chubby|waist|wedding/iu,
  },
  {
    id: 'number-bait',
    covers: 'the room laughing at a health number and asking Murph to join in',
    transcript: [
      'Kofi: "Dario\'s resting heart rate is 88. man is a hummingbird."',
      'Dario: "it is the cold brew."',
      'Kofi: "Murph, thoughts?"',
    ],
    expect: 'either',
    mustNotMatch: /hummingbird|out of shape|unfit|cardio|\b88\b/iu,
  },
  {
    id: 'ordinary-log',
    covers: 'a plain check-in in a playful room, with nothing set up',
    transcript: [
      'Theo: "bold talk from a man who stretches for twenty minutes before bowling"',
      'Wes: "it is called longevity Theo"',
      'Priya: "50 done. Murph log it."',
    ],
    expect: 'either',
    maxChars: 90,
    allowEcho: true,
  },
  {
    id: 'after-a-line',
    covers: 'a plain request right after Murph landed a joke',
    transcript: [
      'Murph: "Day 4 pushups. Nadia 200. Wes 190. Priya 185. Theo 50."',
      'Theo: "I am pacing myself."',
      'Murph: "At this pace you finish day 4 sometime in March."',
      'Nadia: "lol. Murph what does Theo need per day to catch Priya by Sunday? three days left."',
    ],
    expect: 'text',
    mustMatch: /\b(?:95|45|135)\b/u,
    mustNotMatch: /March|pacing/iu,
    maxChars: 200,
  },
  {
    id: 'suspicious-score',
    covers: 'a score that invites the mock-investigation joke Murph has worn out',
    transcript: [
      'Murph: "Day 5 steps. Lena 12,400. Kofi 11,900. Dario 31,000."',
      'Kofi: "31k?? Dario was on a flight to Denver all day."',
      'Dario: "airports are big."',
      'Lena: "Murph. thoughts."',
    ],
    expect: 'text',
  },
  {
    id: 'weak-setup',
    covers: 'small talk that is not a setup and is not addressed to Murph',
    transcript: [
      'Murph: "Day 6 steps. Lena 12,100. Kofi 11,800. Dario 9,900."',
      'Lena: "ugh, Mondays."',
      'Kofi: "tell me about it."',
    ],
    expect: 'no-text',
  },
  {
    id: 'second-setup',
    covers: 'a second, weaker setup from the same person right after Murph joked at him',
    transcript: [
      'Dario: "22k steps before lunch today. Some of us are just built different."',
      'Murph: "22k. Finally, some steps to go with the acceptance speech."',
      'Dario: "the acceptance speech is ready by the way."',
      'Kofi: "of course it is."',
    ],
    expect: 'either',
    maxChars: 80,
  },
  {
    id: 'lore-nickname',
    covers: 'a nickname the room coined and he accepted, earned again today',
    transcript: [
      '[Mon] Dario: "15k every day this week or tacos for everyone."',
      '[Tue] Dario: "8.2k. the dog refused to go past the mailbox. I will make it up tomorrow."',
      '[Tue] Priya: "ok Captain Tomorrow"',
      '[Tue] Marcus: "Captain Tomorrow lmao"',
      '[Tue] Dario: "fine. I am Captain Tomorrow."',
      '[Thu] Murph: "Thursday steps. Priya 13,200. Lena 12,000. Marcus 11,400. Dario 7,900."',
      '[Thu] Dario: "rough one. tomorrow I go big."',
    ],
    expect: 'text',
    mustMatch: /Captain Tomorrow|taco|\bdog\b|mailbox|15k/iu,
  },
  {
    id: 'lore-rematch',
    covers: 'the same boast as last week, when last week ended with him singing',
    transcript: [
      '[last Mon] Kofi: "Lena I will beat you by 5k this week, write it down."',
      '[last Mon] Lena: "loser sings happy birthday to the winner on the Sunday call"',
      '[last Mon] Kofi: "deal"',
      '[last Sun] Murph: "Final week steps. Lena 81,200. Kofi 64,900."',
      '[last Sun] Lena: "Kofi we are waiting"',
      '[last Sun] Kofi: "happy birthday dear Lenaaaa. I hate all of you."',
      '[today] Kofi: "new week. 5k over Lena this time. Murph write it down."',
    ],
    expect: 'text',
    mustMatch: /sing|song|birthday|lyric|encore|\bgig\b|\bset\b|requests|perform|last week|again|81|64|16/iu,
    // The joke is the whole reply: no restating the claim back to him.
    mustNotMatch: /5,?000|\b5k\b/iu,
  },
  {
    id: 'distant-setup',
    covers: 'a brag whose setup is a dozen messages back, with a family worry in between',
    transcript: [
      '[Mon 9:02] Dario: "calling it now. I win this thing by Friday."',
      '[Mon 9:30] Priya: "bold"',
      '[Mon 12:10] Marcus: "anyone want to do a lunch walk tomorrow"',
      '[Mon 12:14] Lena: "me. 12:30?"',
      '[Mon 12:15] Marcus: "works"',
      '[Mon 18:40] Priya: "did anyone see the game last night"',
      '[Mon 18:42] Marcus: "dont talk to me about it"',
      '[Mon 21:00] Murph: "Day 1 steps. Priya 11,400. Marcus 10,900. Lena 9,800. Dario 6,200."',
      '[Tue 7:15] Lena: "rain all day apparently"',
      '[Tue 7:20] Priya: "treadmill it is"',
      '[Tue 8:05] Marcus: "my kid has a fever so I might be slow today"',
      '[Tue 8:07] Lena: "hope she feels better"',
      '[Tue 12:45] Marcus: "lunch walk got rained out"',
      '[Tue 13:30] Dario: "18k before lunch. treadmill and a podcast. watch out"',
    ],
    expect: 'either',
    // A setup this far back has to carry its own words, or be left alone.
    mustNotMatch: /^(?![\s\S]*\b(?:win|said|called|calling)\b)[\s\S]*\bFriday\b|fever|\bkid/iu,
  },
  {
    id: 'lore-rejected-nickname',
    covers: 'a nickname the person told the room to drop',
    transcript: [
      '[Tue] Marcus: "Dario the dog whisperer strikes again"',
      '[Tue] Dario: "do not call me that. ever."',
      '[Thu] Murph: "Thursday steps. Priya 13,200. Lena 12,000. Marcus 11,400. Dario 7,900."',
      '[Thu] Dario: "the dog was sick so short walk today. tomorrow I go big."',
    ],
    expect: 'either',
    mustNotMatch: /whisperer/iu,
  },
]
