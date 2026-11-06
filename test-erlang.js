/**
 * Verification Suite for Erlang C Engine (erlang.js)
 * Tests textbook values, numerical stability up to 500 agents, and edge cases.
 */

const assert = require('assert');
const {
  calculateWorkloadErlangs,
  calculateProbabilityOfWaiting,
  evaluateContactCenter
} = require('./erlang.js');

console.log('Running Contact Center Simulator Erlang C Verification Suite...\n');

// 1. Classic Textbook Erlang C Benchmark:
// 360 calls/hr, 240s AHT => A = 24 Erlangs, N = 30 agents, Target = 80% in 20s
const bench1 = evaluateContactCenter({
  callsPerHour: 360,
  ahtSeconds: 240,
  agents: 30,
  targetSlPercent: 80,
  targetTimeSeconds: 20
});
assert.strictEqual(bench1.erlangs, 24);
assert.strictEqual(bench1.occupancyPercent, 80);
assert(Math.abs(bench1.serviceLevelPercent - 81.46) < 0.2, `Expected ~81.5% SL, got ${bench1.serviceLevelPercent}`);
assert.strictEqual(bench1.verdict.status, 'green');
console.log('[PASS] Classic 24-Erlang / 30-Agent benchmark matches Erlang C reference.');

// 2. Large Agent Count Numerical Stability Test (N = 200 and N = 500)
const large200 = evaluateContactCenter({
  callsPerHour: 2160,
  ahtSeconds: 300, // 180 Erlangs
  agents: 200,
  targetSlPercent: 80,
  targetTimeSeconds: 20
});
assert(Number.isFinite(large200.serviceLevelPercent), 'SL should not be NaN at N=200');
assert(Number.isFinite(large200.asaSeconds), 'ASA should not be NaN at N=200');
assert.strictEqual(large200.verdict.status, 'green');
console.log(`[PASS] Numerical stability at N=200 agents: SL=${large200.serviceLevelPercent.toFixed(2)}%, ASA=${large200.asaSeconds.toFixed(2)}s`);

const large500 = evaluateContactCenter({
  callsPerHour: 5400,
  ahtSeconds: 300, // 450 Erlangs
  agents: 480,
  targetSlPercent: 80,
  targetTimeSeconds: 20
});
assert(Number.isFinite(large500.serviceLevelPercent), 'SL should not be NaN at N=480');
console.log(`[PASS] Numerical stability at N=480 agents: SL=${large500.serviceLevelPercent.toFixed(2)}%, ASA=${large500.asaSeconds.toFixed(2)}s`);

// 3. Edge Case: Offered Workload Exceeds Available Agents (Unstable Queue)
const overloaded = evaluateContactCenter({
  callsPerHour: 720,
  ahtSeconds: 300, // 60 Erlangs
  agents: 50,
  targetSlPercent: 80,
  targetTimeSeconds: 20
});
assert.strictEqual(overloaded.isStable, false);
assert.strictEqual(overloaded.occupancyPercent, 100);
assert.strictEqual(overloaded.serviceLevelPercent, 0);
assert.strictEqual(overloaded.asaSeconds, Infinity);
assert.strictEqual(overloaded.verdict.status, 'red');
console.log('[PASS] Edge case (Workload >= Agents) gracefully caps Occupancy at 100% and flags Red SLA failure.');

// 4. Edge Case: Zero Inflow
const idle = evaluateContactCenter({
  callsPerHour: 0,
  ahtSeconds: 300,
  agents: 20,
  targetSlPercent: 80,
  targetTimeSeconds: 20
});
assert.strictEqual(idle.erlangs, 0);
assert.strictEqual(idle.occupancyPercent, 0);
assert.strictEqual(idle.serviceLevelPercent, 100);
assert.strictEqual(idle.asaSeconds, 0);
assert.strictEqual(idle.verdict.status, 'green');
console.log('[PASS] Edge case (Zero Inflow) returns 0% occupancy, 100% SL, 0s ASA.');

console.log('\nAll Erlang C unit tests passed!');
