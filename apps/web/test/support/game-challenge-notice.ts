// Executable fixture bridge: the live engine journey consumes the Web builder's
// output without adding a package dependency on Web source.
import { buildGameChallengeInstructions } from "../../src/lib/game/challenge";

process.stdout.write(buildGameChallengeInstructions({
  group: process.argv.includes("--group"),
  challengerName: "Maya", accusedName: "Sam", dayNumber: 2, task: "Read a chapter",
  postedAt: new Date("2030-03-05T12:00:00Z"), deadlineAt: new Date("2030-03-06T00:00:00Z"), timeZone: "America/New_York",
}));
