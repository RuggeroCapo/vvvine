#!/usr/bin/env node
/**
 * Debug autopick scoring for a product title.
 *
 * Usage:
 *   node scripts/autopick-debug-score.mjs "Product title here"
 *   node scripts/autopick-debug-score.mjs "Product title" --queue encore --value 35
 *   node scripts/autopick-debug-score.mjs --title-file /path/to/title.txt --verbose
 *   node scripts/autopick-debug-score.mjs "Title" --llm-score 8 --llm-reason "matches audio interest"
 *   node scripts/autopick-debug-score.mjs "Title" --json
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../lib/autopick-scoring-core.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = join(__dirname, '..', 'rules.json');

function printHelp() {
  console.log(`autopick-debug-score — explain autopick confidence for a Vine title

Usage:
  node scripts/autopick-debug-score.mjs <title> [options]
  node scripts/autopick-debug-score.mjs --title-file <path> [options]

Options:
  --queue <name>       Queue key (encore, potluck, last_chance, search). Default: unknown
  --value <number>     ETV / tax value in local currency (e.g. 35 for €35)
  --rules <path>       Path to rules.json (default: ./rules.json)
  --threshold <pct>    Pick threshold percent (default: 75)
  --llm-score <0-10>   Simulate LLM affinity when no rule matches
  --llm-reason <text>  Reason string for simulated LLM score
  --verbose            Log every rule that did NOT match
  --json               Output structured JSON instead of human logs
  --title-file <path>  Read title from file (first line)
  -h, --help           Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    title: null,
    titleFile: null,
    queue: 'unknown',
    value: null,
    rulesPath: RULES_PATH,
    threshold: core.DEFAULT_SCORING_CONFIG.thresholdPercent,
    llmScore: null,
    llmReason: '',
    verbose: false,
    json: false
  };

  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '--queue':
        opts.queue = argv[++i];
        break;
      case '--value':
        opts.value = parseFloat(argv[++i]);
        break;
      case '--rules':
        opts.rulesPath = argv[++i];
        break;
      case '--threshold':
        opts.threshold = parseFloat(argv[++i]);
        break;
      case '--llm-score':
        opts.llmScore = parseFloat(argv[++i]);
        break;
      case '--llm-reason':
        opts.llmReason = argv[++i];
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--json':
        opts.json = true;
        break;
      case '--title-file':
        opts.titleFile = argv[++i];
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }

  if (positional.length > 0) {
    opts.title = positional.join(' ');
  }

  return opts;
}

function loadRules(rulesPath) {
  const raw = readFileSync(rulesPath, 'utf8');
  const payload = JSON.parse(raw);
  return payload.rules || [];
}

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  if (opts.titleFile) {
    opts.title = readFileSync(opts.titleFile, 'utf8').split('\n')[0].trim();
  }

  if (!opts.title) {
    console.error('Error: provide a title argument or --title-file');
    printHelp();
    process.exit(1);
  }

  let rules;
  try {
    rules = loadRules(opts.rulesPath);
  } catch (error) {
    console.error(`Failed to load rules from ${opts.rulesPath}:`, error.message);
    process.exit(1);
  }

  const llmAffinity = opts.llmScore != null
    ? { score: opts.llmScore, reason: opts.llmReason }
    : null;

  const { result, logs } = core.explainScore({
    title: opts.title,
    queue: opts.queue,
    value: opts.value,
    rules,
    verbose: opts.verbose,
    llmAffinity,
    config: { thresholdPercent: opts.threshold }
  });

  if (opts.json) {
    console.log(JSON.stringify({ result, logs }, null, 2));
    return;
  }

  console.log(logs.join('\n'));
}

main();
