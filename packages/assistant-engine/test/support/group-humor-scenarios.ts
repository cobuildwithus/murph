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
    mustNotMatch: /\blazy\b|out of shape|unfit/iu,
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
]
