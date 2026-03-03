/**
 * Lil Dude Performance Benchmark
 * Measures: SQLite throughput, message processing latency, memory footprint, wave overhead.
 *
 * Usage: npx tsx scripts/benchmark.ts
 */

import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';

const ITERATIONS = 1000;
const TEMP_DIR = join(tmpdir(), `lildude-bench-${nanoid(8)}`);

function formatMs(ns: bigint): string {
  return (Number(ns) / 1_000_000).toFixed(2);
}

function percentile(sorted: bigint[], pct: number): bigint {
  const idx = Math.ceil((pct / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function benchmarkSqlite(): Promise<void> {
  console.log('\n📊 SQLite Performance');
  console.log('─'.repeat(50));

  mkdirSync(TEMP_DIR, { recursive: true });
  const dbPath = join(TEMP_DIR, 'bench.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE bench (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      number REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Benchmark: INSERT
  const insertStmt = db.prepare('INSERT INTO bench (id, data, number) VALUES (?, ?, ?)');
  const insertTimes: bigint[] = [];

  for (let idx = 0; idx < ITERATIONS; idx++) {
    const start = process.hrtime.bigint();
    insertStmt.run(nanoid(), `data-${idx}-${nanoid(32)}`, Math.random() * 1000);
    insertTimes.push(process.hrtime.bigint() - start);
  }

  insertTimes.sort();
  console.log(`  INSERT (${ITERATIONS} rows):`);
  console.log(`    p50: ${formatMs(percentile(insertTimes, 50))}ms`);
  console.log(`    p95: ${formatMs(percentile(insertTimes, 95))}ms`);
  console.log(`    p99: ${formatMs(percentile(insertTimes, 99))}ms`);

  // Benchmark: SELECT by primary key
  const ids = db.prepare('SELECT id FROM bench LIMIT ?').all(ITERATIONS) as Array<{ id: string }>;
  const selectStmt = db.prepare('SELECT * FROM bench WHERE id = ?');
  const selectTimes: bigint[] = [];

  for (const row of ids) {
    const start = process.hrtime.bigint();
    selectStmt.get(row.id);
    selectTimes.push(process.hrtime.bigint() - start);
  }

  selectTimes.sort();
  console.log(`  SELECT by PK (${ITERATIONS} queries):`);
  console.log(`    p50: ${formatMs(percentile(selectTimes, 50))}ms`);
  console.log(`    p95: ${formatMs(percentile(selectTimes, 95))}ms`);
  console.log(`    p99: ${formatMs(percentile(selectTimes, 99))}ms`);

  // Benchmark: Full-text search (LIKE)
  const searchStmt = db.prepare('SELECT * FROM bench WHERE data LIKE ? LIMIT 10');
  const searchTimes: bigint[] = [];

  for (let idx = 0; idx < 100; idx++) {
    const start = process.hrtime.bigint();
    searchStmt.all(`%data-${idx}%`);
    searchTimes.push(process.hrtime.bigint() - start);
  }

  searchTimes.sort();
  console.log(`  LIKE search (100 queries):`);
  console.log(`    p50: ${formatMs(percentile(searchTimes, 50))}ms`);
  console.log(`    p95: ${formatMs(percentile(searchTimes, 95))}ms`);
  console.log(`    p99: ${formatMs(percentile(searchTimes, 99))}ms`);

  // Benchmark: Transaction batch insert
  const batchInsert = db.transaction((count: number) => {
    for (let idx = 0; idx < count; idx++) {
      insertStmt.run(nanoid(), `batch-${idx}`, Math.random());
    }
  });

  const batchStart = process.hrtime.bigint();
  batchInsert(1000);
  const batchTime = process.hrtime.bigint() - batchStart;
  console.log(`  Transaction batch (1000 inserts): ${formatMs(batchTime)}ms`);

  db.close();
  rmSync(TEMP_DIR, { recursive: true, force: true });
}

async function benchmarkMemory(): Promise<void> {
  console.log('\n💾 Memory Footprint');
  console.log('─'.repeat(50));

  const used = process.memoryUsage();
  console.log(`  RSS:       ${(used.rss / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Heap Total:${(used.heapTotal / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  External:  ${(used.external / 1024 / 1024).toFixed(1)} MB`);
}

async function benchmarkWaveOverhead(): Promise<void> {
  console.log('\n🌊 Wave Overhead (dynamic import + plan + execute)');
  console.log('─'.repeat(50));

  const wavesDir = join(process.cwd(), 'waves', 'community');
  const { existsSync, readdirSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');

  if (!existsSync(wavesDir)) {
    console.log('  No community waves found, skipping.');
    return;
  }

  const waveDirs = readdirSync(wavesDir).filter(
    (entry) => existsSync(join(wavesDir, entry, 'index.js')),
  );

  for (const waveDir of waveDirs) {
    const moduleUrl = pathToFileURL(join(wavesDir, waveDir, 'index.js')).href;

    const importStart = process.hrtime.bigint();
    const waveMod = await import(moduleUrl);
    const importTime = process.hrtime.bigint() - importStart;

    const planStart = process.hrtime.bigint();
    const plan = await waveMod.plan('test input for benchmark', {});
    const planTime = process.hrtime.bigint() - planStart;

    const execStart = process.hrtime.bigint();
    await waveMod.execute({ extractedParams: plan.extractedParams || {} });
    const execTime = process.hrtime.bigint() - execStart;

    console.log(`  ${waveDir}:`);
    console.log(`    import: ${formatMs(importTime)}ms | plan: ${formatMs(planTime)}ms | execute: ${formatMs(execTime)}ms`);
  }
}

async function benchmarkJsonParsing(): Promise<void> {
  console.log('\n📝 JSON Parse/Stringify Overhead');
  console.log('─'.repeat(50));

  // Simulate typical registry payload
  const registry = {
    version: '1.0.0',
    waves: Array.from({ length: 100 }, (_, idx) => ({
      name: `wave-${idx}`,
      description: `Description for wave ${idx}`,
      author: 'test',
      source: `github:test/wave-${idx}`,
      triggers: ['trigger1', 'trigger2'],
      version: '1.0.0',
      safetyTier: 'observe',
      verified: true,
      downloads: Math.floor(Math.random() * 10000),
    })),
  };

  const jsonStr = JSON.stringify(registry);
  const parseTimes: bigint[] = [];
  const stringifyTimes: bigint[] = [];

  for (let idx = 0; idx < 1000; idx++) {
    const start = process.hrtime.bigint();
    JSON.parse(jsonStr);
    parseTimes.push(process.hrtime.bigint() - start);
  }

  for (let idx = 0; idx < 1000; idx++) {
    const start = process.hrtime.bigint();
    JSON.stringify(registry);
    stringifyTimes.push(process.hrtime.bigint() - start);
  }

  parseTimes.sort();
  stringifyTimes.sort();

  console.log(`  JSON.parse (100 waves, 1000 iterations):`);
  console.log(`    p50: ${formatMs(percentile(parseTimes, 50))}ms | p99: ${formatMs(percentile(parseTimes, 99))}ms`);
  console.log(`  JSON.stringify:`);
  console.log(`    p50: ${formatMs(percentile(stringifyTimes, 50))}ms | p99: ${formatMs(percentile(stringifyTimes, 99))}ms`);
}

// ── Main ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         Lil Dude Performance Benchmark          ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Date:     ${new Date().toISOString()}`);
  console.log(`  Node.js:  ${process.version}`);
  console.log(`  Platform: ${process.platform} ${process.arch}`);

  await benchmarkSqlite();
  await benchmarkMemory();
  await benchmarkWaveOverhead();
  await benchmarkJsonParsing();

  console.log('\n✅ Benchmark complete.\n');
}

main().catch(console.error);
