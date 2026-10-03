#!/usr/bin/env node
// Prints a per-arm scorecard from the experiment ledger.
//
//   node experiment/scorecard.mjs            # all arms
//   node experiment/scorecard.mjs --task T03 # single task
//
// Inputs:
//   experiment/ledger/runs.csv              (written by experiment/timer.sh)
//   experiment/ledger/hidden-results.jsonl  (written by experiment/score-hidden.sh)
//
// Deliberately reports speed AND defects AND rework side by side and never
// computes a single composite number: a single score would hide exactly the
// trade-off this experiment exists to measure.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const runsPath = join(root, 'experiment', 'ledger', 'runs.csv');
const hiddenPath = join(root, 'experiment', 'ledger', 'hidden-results.jsonl');

function parseCsv(text) {
  const [header, ...lines] = text.trim().split('\n');
  if (!header) return [];
  const columns = header.split(',');
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => Object.fromEntries(line.split(',').map((value, index) => [columns[index], value])));
}

function loadHidden() {
  if (!existsSync(hiddenPath)) return new Map();
  const map = new Map();
  for (const line of readFileSync(hiddenPath, 'utf8').trim().split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const key = `${record.task}`;
      const existing = map.get(key) ?? { passed: 0, failed: 0, runs: 0 };
      // Keep the most recent result for each task.
      map.set(key, { passed: record.passed, failed: record.failed, runs: existing.runs + 1 });
    } catch {
      // A malformed ledger line must not break the report.
    }
  }
  return map;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function range(values) {
  if (!values.length) return '-';
  return `${Math.min(...values)}-${Math.max(...values)}`;
}

if (!existsSync(runsPath)) {
  console.error('scorecard: no runs.csv found. Run experiment/timer.sh first.');
  process.exit(1);
}

const taskFilter = process.argv.includes('--task')
  ? process.argv[process.argv.indexOf('--task') + 1]
  : null;

let runs = parseCsv(readFileSync(runsPath, 'utf8'));
if (taskFilter) runs = runs.filter((run) => run.task === taskFilter);

// The practice task is warm-up, never scored.
const scored = runs.filter((run) => run.task !== 'T00');
const hidden = loadHidden();

const arms = ['ai', 'no-ai'];
const summary = {};

for (const arm of arms) {
  const rows = scored.filter((run) => run.arm === arm);
  const minutes = rows.map((row) => Number(row.minutes)).filter((value) => Number.isFinite(value));
  const hiddenFailed = rows.reduce((total, row) => total + (hidden.get(row.task)?.failed ?? 0), 0);
  const hiddenPassed = rows.reduce((total, row) => total + (hidden.get(row.task)?.passed ?? 0), 0);
  const rework = rows
    .map((row) => Number(row.rework_minutes))
    .filter((value) => Number.isFinite(value) && value > 0);

  summary[arm] = {
    runs: rows.length,
    median: median(minutes),
    range: range(minutes),
    timeouts: rows.filter((row) => row.timed_out === 'true').length,
    hiddenFailed,
    hiddenPassed,
    reworkMedian: median(rework),
    reworkRange: range(rework),
  };
}

console.log('TaskFlow AI experiment - scorecard');
console.log('='.repeat(72));
if (taskFilter) console.log(`Task filter: ${taskFilter}`);
console.log(`Scored runs: ${scored.length} (practice task T00 excluded)\n`);

const header = ['metric', 'ai', 'no-ai'];
const widths = [26, 22, 22];
const line = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('');
console.log(line(header));
console.log('-'.repeat(70));

const rows = [
  ['runs', summary.ai.runs, summary['no-ai'].runs],
  ['median minutes', summary.ai.median ?? '-', summary['no-ai'].median ?? '-'],
  ['minutes range', summary.ai.range, summary['no-ai'].range],
  ['runs over 60 min cap', summary.ai.timeouts, summary['no-ai'].timeouts],
  ['hidden tests failed', summary.ai.hiddenFailed, summary['no-ai'].hiddenFailed],
  ['hidden tests passed', summary.ai.hiddenPassed, summary['no-ai'].hiddenPassed],
  ['median rework minutes', summary.ai.reworkMedian ?? '-', summary['no-ai'].reworkMedian ?? '-'],
  ['rework minutes range', summary.ai.reworkRange, summary['no-ai'].reworkRange],
];
for (const row of rows) console.log(line(row));

console.log('\nPer task:');
console.log('-'.repeat(70));
console.log(line(['task', 'arm', 'minutes', 'timeout', 'hidden fail', 'rework min']));
for (const run of scored) {
  console.log(line([
    run.task,
    run.arm,
    run.minutes,
    run.timed_out,
    hidden.get(run.task)?.failed ?? 'n/a',
    run.rework_minutes || '-',
  ]));
}

console.log('\nNo composite score is produced on purpose: speed, defects and rework');
console.log('are reported together so a speed win bought with defects stays visible.');
