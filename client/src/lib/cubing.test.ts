/**
 * Plain-node assertions for the cubing math. Run: `node src/lib/cubing.test.ts`
 * (Node strips the TS types.) No test framework — keep it dependency-free.
 */
import assert from "node:assert/strict";
import {
  attemptCs,
  attemptEffectiveMs,
  formatAttempt,
  formatCentiseconds,
  formatMs,
  msToCentiseconds,
  ordinal,
  placeAverage,
  stageBreakdown,
  wcaAo5Cs,
  wcaAo5Ms,
  type Attempt,
  type Solve,
} from "./cubing.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

// --- WCA Ao5: drop one best + one worst, mean the middle three ---
check("Ao5 drops single best and single worst", () => {
  // sorted: 40,45,50,55,60 -> middle 45,50,55 -> 50
  assert.equal(wcaAo5Ms([5000, 4000, 6000, 4500, 5500]), 5000);
});
check("Ao5 is not a plain mean", () => {
  const times = [1000, 2000, 3000, 4000, 100000];
  const plainMean = times.reduce((a, b) => a + b) / 5; // 22000
  assert.notEqual(wcaAo5Ms(times), plainMean);
  assert.equal(wcaAo5Ms(times), 3000); // mean of 2000,3000,4000
});
check("Ao5 removes only ONE best/worst when tied", () => {
  // sorted: 3000,4000,4000,4000,5000 -> middle 4000,4000,4000 -> 4000
  assert.equal(wcaAo5Ms([4000, 4000, 4000, 5000, 3000]), 4000);
});
check("Ao5 rejects wrong count", () => {
  assert.throws(() => wcaAo5Ms([1, 2, 3, 4]));
});

// --- +2 penalty model ---
check("+2 adds exactly 2s to that attempt", () => {
  const a: Attempt = { rawMs: 12340, plus2: true };
  assert.equal(attemptEffectiveMs(a), 14340);
  assert.equal(attemptCs(a), 1434);
  assert.equal(attemptEffectiveMs({ rawMs: 12340, plus2: false }), 12340);
});
check("+2 display shows final time with trailing plus (14.34+)", () => {
  assert.equal(formatAttempt({ rawMs: 12340, plus2: true }), "14.34+");
  assert.equal(formatAttempt({ rawMs: 12340, plus2: false }), "12.34");
});
check("+2 applies BEFORE best/worst selection and averaging", () => {
  // raw: 10,11,12,13,14s; +2 on the 10s solve makes it 12s — no longer best.
  const attempts: Attempt[] = [
    { rawMs: 10000, plus2: true }, // 12.00 effective
    { rawMs: 11000, plus2: false },
    { rawMs: 12000, plus2: false },
    { rawMs: 13000, plus2: false },
    { rawMs: 14000, plus2: false },
  ];
  const cs = attempts.map(attemptCs); // [1200,1100,1200,1300,1400]
  // drop best 1100 and worst 1400 -> mean(1200,1200,1300) = 1233.33 -> 1233
  assert.equal(wcaAo5Cs(cs), 1233);
});
check("+2 that lands on the worst attempt is dropped like any worst", () => {
  const attempts: Attempt[] = [
    { rawMs: 20000, plus2: true }, // 22.00 -> worst, dropped
    { rawMs: 11000, plus2: false },
    { rawMs: 12000, plus2: false },
    { rawMs: 13000, plus2: false },
    { rawMs: 10000, plus2: false }, // best, dropped
  ];
  assert.equal(wcaAo5Cs(attempts.map(attemptCs)), 1200);
});

// --- cs-domain Ao5 consistency (average agrees with displayed attempts) ---
check("Ao5 is computed from cs-quantized attempts, like official results", () => {
  // ms values whose displayed cs are 10.01, 10.00, 10.00 (+ dropped 9 & 11):
  const attempts: Attempt[] = [
    { rawMs: 10014, plus2: false }, // shows 10.01
    { rawMs: 10004, plus2: false }, // shows 10.00
    { rawMs: 10004, plus2: false }, // shows 10.00
    { rawMs: 9000, plus2: false },
    { rawMs: 11000, plus2: false },
  ];
  // WCA-faithful: (1001+1000+1000)/3 = 1000.33 -> 1000 -> "10.00"
  assert.equal(wcaAo5Cs(attempts.map(attemptCs)), 1000);
  assert.equal(formatCentiseconds(1000), "10.00");
});

// --- rounding to centiseconds (WCA unit) ---
check("ms -> centiseconds rounds to nearest", () => {
  assert.equal(msToCentiseconds(12432), 1243);
  assert.equal(msToCentiseconds(12435), 1244); // .5 rounds up
});

// --- formatting ---
check("formats sub-minute and minute-plus times", () => {
  assert.equal(formatCentiseconds(1243), "12.43");
  assert.equal(formatCentiseconds(586), "5.86");
  assert.equal(formatCentiseconds(10779), "1:47.79");
  assert.equal(formatCentiseconds(6000), "1:00.00");
});
check("formatMs matches the cs formatter after quantization", () => {
  assert.equal(formatMs(12432), "12.43");
  assert.equal(formatMs(0), "0.00");
  assert.equal(formatMs(65432), "1:05.43");
});
check("ordinals", () => {
  assert.equal(ordinal(1), "1st");
  assert.equal(ordinal(2), "2nd");
  assert.equal(ordinal(3), "3rd");
  assert.equal(ordinal(8), "8th");
  assert.equal(ordinal(11), "11th");
  assert.equal(ordinal(21), "21st");
  assert.equal(ordinal(42), "42nd");
});

// --- placement (WCA ordering; DNFs counted in total, sort last) ---
check("placement counts strictly-faster valid averages, +1", () => {
  const asc = [1000, 1200, 1243, 1300];
  // 2 strictly faster than 1243 -> 3rd; total includes a DNF competitor
  assert.deepEqual(placeAverage(1243, asc, 5), { placement: 3, total: 5 });
});
check("fastest-of-field places 1st; total is everyone", () => {
  assert.deepEqual(placeAverage(500, [586, 600], 42), { placement: 1, total: 42 });
});
check("all-DNF field: no valid averages, user places 1st of total", () => {
  assert.deepEqual(placeAverage(1243, [], 7), { placement: 1, total: 7 });
});

// --- stage breakdown: sum each stage, largest share ---
check("stage breakdown finds the slowest stage and its share", () => {
  const mk = (c: number, f: number, o: number, p: number): Solve => ({
    stages: { cross: c, f2l: f, oll: o, pll: p },
    totalMs: c + f + o + p,
  });
  const solves = [mk(1000, 2000, 500, 500), mk(1000, 2000, 500, 500)];
  const b = stageBreakdown(solves);
  assert.equal(b.slowest, "f2l");
  assert.equal(b.totals.f2l, 4000);
  assert.equal(b.grandTotalMs, 8000);
  assert.equal(Math.round(b.slowestShare * 100), 50);
});

console.log(`\n${passed} checks passed.`);
