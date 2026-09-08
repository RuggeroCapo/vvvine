#!/usr/bin/env node
/**
 * Backtest autopick scoring against products from socket-monitor.
 *
 * Fetches paginated products from the Vine Stats API (socket-monitor deployment)
 * and scores each title with the same rules engine used by the extension.
 *
 * Usage:
 *   node scripts/autopick-backtest-products.mjs
 *   node scripts/autopick-backtest-products.mjs --since 2026-06-01 --picks-only
 *   node scripts/autopick-backtest-products.mjs --base-url http://localhost:3000 --limit 500
 *   node scripts/autopick-backtest-products.mjs --json > backtest.json
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../lib/autopick-scoring-core.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, '..', 'rules.json');
const DEFAULT_BASE_URL = 'https://ita-vine-stats.duckdns.org';
const PAGE_SIZE = 100;

const QUEUE_TO_AUTOPICK = {
  AI: 'encore',
  AFA: 'last_chance',
  RFY: 'potluck',
  OTHER: 'unknown'
};

function printHelp() {
  console.log(`autopick-backtest-products — score socket-monitor products with autopick rules

Usage:
  node scripts/autopick-backtest-products.mjs [options]

Options:
  --base-url <url>     Vine Stats API base (default: ${DEFAULT_BASE_URL})
  --rules <path>       Path to rules.json (default: ./rules.json)
  --threshold <pct>    Pick threshold percent (default: 75)
  --since <iso-date>   Only products added on/after this date
  --until <iso-date>   Only products added on/before this date
  --queue <code>       Filter feed queue: AI | AFA | RFY | OTHER
  --search <text>      Filter by ASIN/title substring (API-side)
  --max-fetch <n>      Stop after fetching N raw events (default: unlimited)
  --dedupe             Keep latest event per ASIN (default: on)
  --no-dedupe          Score every event row
  --picks-only         Print only would-pick items
  --min-confidence <n> Only show rows with confidence >= n
  --json               Structured JSON output
  -h, --help           Show this help

Environment:
  VINE_STATS_URL       Alternative to --base-url
`);
}

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.VINE_STATS_URL?.trim() || DEFAULT_BASE_URL,
    rulesPath: RULES_PATH,
    threshold: core.DEFAULT_SCORING_CONFIG.thresholdPercent,
    since: null,
    until: null,
    queue: null,
    search: '',
    maxFetch: Infinity,
    dedupe: true,
    picksOnly: false,
    minConfidence: 0,
    json: false
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--base-url':
        opts.baseUrl = argv[++i];
        break;
      case '--rules':
        opts.rulesPath = argv[++i];
        break;
      case '--threshold':
        opts.threshold = parseFloat(argv[++i]);
        break;
      case '--since':
        opts.since = argv[++i];
        break;
      case '--until':
        opts.until = argv[++i];
        break;
      case '--queue':
        opts.queue = argv[++i];
        break;
      case '--search':
        opts.search = argv[++i];
        break;
      case '--max-fetch':
        opts.maxFetch = parseInt(argv[++i], 10);
        break;
      case '--dedupe':
        opts.dedupe = true;
        break;
      case '--no-dedupe':
        opts.dedupe = false;
        break;
      case '--picks-only':
        opts.picksOnly = true;
        break;
      case '--min-confidence':
        opts.minConfidence = parseFloat(argv[++i]);
        break;
      case '--json':
        opts.json = true;
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        process.exit(1);
    }
  }

  return opts;
}

function loadRules(rulesPath) {
  const raw = readFileSync(rulesPath, 'utf8');
  return JSON.parse(raw);
}

function decodeTitle(title) {
  if (!title) {
    return '';
  }
  return title
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
}

function mapQueue(queueCode) {
  return QUEUE_TO_AUTOPICK[queueCode] || 'unknown';
}

function formatMoney(value, currency = 'EUR') {
  if (value == null || Number.isNaN(value)) {
    return '—';
  }
  const symbol = currency === 'EUR' ? '€' : `${currency} `;
  return `${symbol}${Number(value).toFixed(2)}`;
}

async function fetchProductsPage(baseUrl, query) {
  const params = new URLSearchParams({
    offset: String(query.offset),
    limit: String(query.limit),
    sort: 'newest'
  });

  if (query.since) params.set('since', query.since);
  if (query.until) params.set('until', query.until);
  if (query.queue) params.set('queue', query.queue);
  if (query.search) params.set('search', query.search);

  const url = `${baseUrl.replace(/\/$/, '')}/api/products?${params}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  return response.json();
}

async function fetchAllProducts(opts) {
  const products = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total && products.length < opts.maxFetch) {
    const limit = Math.min(PAGE_SIZE, opts.maxFetch - products.length);
    const body = await fetchProductsPage(opts.baseUrl, {
      offset,
      limit,
      since: opts.since,
      until: opts.until,
      queue: opts.queue,
      search: opts.search
    });

    if (!Array.isArray(body.products)) {
      throw new Error('Unexpected API response: missing products array');
    }

    products.push(...body.products);
    total = Number(body.total) || products.length;
    offset += body.products.length;

    if (body.products.length === 0) {
      break;
    }

    if (!opts.json) {
      process.stderr.write(`\rFetched ${products.length}/${total} products...`);
    }
  }

  if (!opts.json) {
    process.stderr.write('\n');
  }

  return { products, total };
}

function dedupeByAsin(products) {
  const byAsin = new Map();

  for (const product of products) {
    const existing = byAsin.get(product.asin);
    if (!existing || Date.parse(product.event_time) > Date.parse(existing.event_time)) {
      byAsin.set(product.asin, product);
    }
  }

  return [...byAsin.values()].sort(
    (a, b) => Date.parse(b.event_time) - Date.parse(a.event_time)
  );
}

function scoreProduct(product, rules, config) {
  const title = decodeTitle(product.title);
  const queue = mapQueue(product.queue);
  const value = product.item_value != null ? Number(product.item_value) : null;

  const result = core.computeScore({
    title,
    queue,
    value,
    config: { ...config, rules, _compiledRules: config._compiledRules }
  });

  return {
    asin: product.asin,
    title,
    queue: product.queue,
    autopickQueue: queue,
    value,
    currency: product.currency,
    event_time: product.event_time,
    detail_url: product.detail_url || `https://www.amazon.it/dp/${product.asin}`,
    ...result
  };
}

function printHumanSummary(summary, rows, opts) {
  console.log(`Autopick backtest — ${summary.scored} products scored`);
  console.log(`Source: ${summary.baseUrl}`);
  console.log(`Threshold: ${summary.threshold}% | Affinity floor: ${summary.affinityFloor}`);
  console.log(`Fetched: ${summary.fetched} events | Unique ASINs: ${summary.uniqueAsins}`);
  if (summary.since || summary.until) {
    console.log(`Date filter: ${summary.since || '…'} → ${summary.until || '…'}`);
  }
  if (summary.queue) {
    console.log(`Queue filter: ${summary.queue}`);
  }
  console.log('');
  console.log(`Would pick: ${summary.wouldPick} (${summary.pickRate}%)`);
  console.log(`Skipped: ${summary.skipped}`);
  console.log(`  veto (consumables/accessories): ${summary.veto}`);
  console.log(`  below affinity floor: ${summary.belowAffinityFloor}`);
  console.log(`  below threshold: ${summary.belowThreshold}`);
  console.log(`  mustPick override: ${summary.mustPick}`);
  console.log('');

  const visible = rows.filter((row) => row.confidence >= opts.minConfidence);
  if (visible.length === 0) {
    console.log('No rows to display.');
    return;
  }

  console.log(opts.picksOnly ? 'Picked products:' : 'Top scores:');
  for (const row of visible) {
    const flags = [
      row.wouldPick ? 'PICK' : 'skip',
      row.affinitySource,
      row.rule?.label || row.affinityReason || '—'
    ].join(' | ');
    console.log(
      `[${row.confidence}%] ${formatMoney(row.value, row.currency)} | ${row.queue} | ${row.asin} | ${flags}`
    );
    console.log(`  ${row.title}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  let rulesPayload;
  try {
    rulesPayload = loadRules(opts.rulesPath);
  } catch (error) {
    console.error(`Failed to load rules from ${opts.rulesPath}:`, error.message);
    process.exit(1);
  }

  const rules = rulesPayload.rules || [];
  const config = core.mergeConfig({
    thresholdPercent: opts.threshold,
    rules,
    sharedExclude: rulesPayload.sharedExclude || [],
    _compiledRules: core.compileRules(rules, { sharedExclude: rulesPayload.sharedExclude || [] })
  });

  let fetched;
  try {
    fetched = await fetchAllProducts(opts);
  } catch (error) {
    console.error('Failed to fetch products:', error.message);
    process.exit(1);
  }

  const sourceProducts = opts.dedupe
    ? dedupeByAsin(fetched.products)
    : fetched.products;

  const scored = sourceProducts.map((product) => scoreProduct(product, rules, config));
  scored.sort((a, b) => b.confidence - a.confidence || Date.parse(b.event_time) - Date.parse(a.event_time));

  const wouldPickRows = scored.filter((row) => row.wouldPick);
  const vetoRows = scored.filter((row) => row.affinitySource === 'veto');
  const belowFloorRows = scored.filter((row) => row.belowAffinityFloor && row.affinitySource !== 'veto');
  const belowThresholdRows = scored.filter(
    (row) => !row.wouldPick && !row.belowAffinityFloor && row.confidence < opts.threshold
  );
  const mustPickRows = scored.filter((row) => row.override);

  const summary = {
    baseUrl: opts.baseUrl,
    threshold: opts.threshold,
    affinityFloor: config.affinityFloor,
    fetched: fetched.products.length,
    totalReported: fetched.total,
    uniqueAsins: sourceProducts.length,
    scored: scored.length,
    wouldPick: wouldPickRows.length,
    skipped: scored.length - wouldPickRows.length,
    pickRate: scored.length ? ((wouldPickRows.length / scored.length) * 100).toFixed(1) : '0.0',
    veto: vetoRows.length,
    belowAffinityFloor: belowFloorRows.length,
    belowThreshold: belowThresholdRows.length,
    mustPick: mustPickRows.length,
    since: opts.since,
    until: opts.until,
    queue: opts.queue,
    dedupe: opts.dedupe
  };

  const displayRows = (opts.picksOnly ? wouldPickRows : scored)
    .filter((row) => row.confidence >= opts.minConfidence)
    .slice(0, opts.picksOnly ? undefined : 50);

  if (opts.json) {
    console.log(JSON.stringify({
      summary,
      picks: wouldPickRows,
      rows: displayRows
    }, null, 2));
    return;
  }

  printHumanSummary(summary, displayRows, opts);

  if (!opts.picksOnly && wouldPickRows.length > 50) {
    console.log('');
    console.log(`Showing top 50 by confidence. ${wouldPickRows.length} total picks — rerun with --picks-only to list all.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
