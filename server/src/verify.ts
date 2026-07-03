/**
 * Standalone verification (build-order step 1): fetch a real competition's
 * first-round 3x3 scramble set and ranking, apply the grouping/sorting logic,
 * and print the result so we can confirm correctness before building any UI.
 *
 *   node src/verify.ts [competitionId ...]
 */
import {
  getCompetition,
  getFirstRound333Ranking,
  getFirstRound333Scrambles,
} from "./wca.ts";

function fmt(cs: number): string {
  // centiseconds -> M:SS.xx / SS.xx
  const totalSec = cs / 100;
  if (totalSec >= 60) {
    const m = Math.floor(totalSec / 60);
    const s = (totalSec % 60).toFixed(2).padStart(5, "0");
    return `${m}:${s}`;
  }
  return totalSec.toFixed(2);
}

const ids = process.argv.slice(2);
if (ids.length === 0) {
  ids.push("CubingUSANationals2023", "WC2019", "Anytime2016"); // mixed sanity set
}

for (const id of ids) {
  console.log(`\n=== ${id} ===`);
  try {
    const comp = await getCompetition(id);
    console.log(`${comp.name}  (${comp.start_date} → ${comp.end_date})`);
  } catch (err) {
    console.log(`  competition lookup failed: ${(err as Error).message}`);
    continue;
  }

  const round = await getFirstRound333Scrambles(id);
  if (!round.available) {
    console.log(`  scrambles: ${round.reason}`);
    continue;
  }

  console.log(
    `  first round: "${round.roundTypeId}" (${round.roundName}), group ${round.groupId}, ${round.scrambles!.length} scrambles`,
  );
  round.scrambles!.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));

  const ranking = await getFirstRound333Ranking(id, round.roundTypeId!);
  console.log(
    `  ranking: ${ranking.totalCompetitors} competitors, ${ranking.averagesAsc.length} with a valid average`,
  );
  if (ranking.fastestAverage) {
    const a = ranking.averagesAsc;
    const median = a[Math.floor(a.length / 2)];
    console.log(
      `   fastest ${fmt(a[0])} · median ${fmt(median)} · slowest ${fmt(a[a.length - 1])}`,
    );
    // Sanity-check placement math with a sample average.
    const sample = 1243; // 12.43s
    const better = a.filter((x) => x < sample).length;
    console.log(
      `   e.g. a ${fmt(sample)} average would place ${better + 1} of ${ranking.totalCompetitors}`,
    );
  }
}
