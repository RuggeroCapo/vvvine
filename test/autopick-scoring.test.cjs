const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../lib/autopick-scoring-core.js');

const rulesPayload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'rules.json'), 'utf8'));

function scoreWith(rules, sharedExclude, { title, queue = 'encore', value = null, llmAffinity = null }) {
  const config = core.mergeConfig({});
  config._compiledRules = core.compileRules(rules, { sharedExclude });
  return core.computeScore({ title, queue, value, config, llmAffinity });
}

function scan(rules, title) {
  return core.scanRuleMatches(title, core.compileRules(rules, { sharedExclude: [] })).matches;
}

const DJI = [{ type: 'brand', pattern: 'DJI', score: 10, label: 'drones' }];
const BAMBU = [{ type: 'brand', pattern: 'Bambu', aliases: ['Bambu Lab'], score: 9, label: '3D printing' }];
const REAL = [rulesPayload.rules, rulesPayload.sharedExclude];

// Dynamic normalization
test('DJI Mini 4 Pro Drone in encore without value reaches 94% confidence and would pick', () => {
  const result = scoreWith(DJI, [], { title: 'DJI Mini 4 Pro Drone con telecamera', queue: 'encore' });
  assert.equal(result.confidence, 94);
  assert.equal(result.wouldPick, true);
  assert.equal(result.valueKnown, false);
});

test('DJI Mini 4 Pro Drone in potluck without value reaches 98% confidence', () => {
  const result = scoreWith(DJI, [], { title: 'DJI Mini 4 Pro Drone con telecamera', queue: 'potluck' });
  assert.equal(result.confidence, 98);
});

test('low affinity rule remains below affinity floor without value', () => {
  const result = scoreWith([{ type: 'brand', pattern: 'Acme', score: 5 }], [], { title: 'Acme widget', queue: 'encore' });
  assert.equal(result.belowAffinityFloor, true);
  assert.equal(result.wouldPick, false);
  assert.equal(result.confidence, 54);
});

test('computeConfidence keeps known values unchanged and treats real 0 as known', () => {
  assert.equal(core.computeConfidence(10, 10, 7, core.mergeConfig({})), 96);
  assert.equal(core.computeConfidence(10, 0, 7, core.mergeConfig({})), 71);
});

test('canBeDecisive returns true when value is unknown for decisive potential', () => {
  assert.equal(core.canBeDecisive({ valueScore: 0, queueScore: 7, valueKnown: false, config: core.mergeConfig({}) }), true);
});

// Brand compatibility context
test('authentic brand title matches', () => {
  assert.equal(scan(DJI, 'DJI Mini 4 Pro Drone').length, 1);
});

test('brand title with secondary compatibility mention still matches due to authentic first occurrence', () => {
  assert.equal(scan(DJI, 'DJI Care Refresh per DJI Mini 4').length, 1);
});

test('accessory with "per [brand]" is rejected', () => {
  assert.equal(scan(DJI, 'Custodia protettiva per DJI Osmo').length, 0);
});

test('accessory with "per [brand]" (dust bag) is rejected', () => {
  assert.equal(scan(DJI, 'Sacchetto protettivo antipolvere per DJI Osmo').length, 0);
});

test('replacement parts with "per [brand]" are rejected', () => {
  assert.equal(scan(DJI, 'HUAREW 8Pcs Eliche per DJI Air 3/Air 3S').length, 0);
});

test('accessory with "Compatible with [brand]" is rejected', () => {
  assert.equal(scan(DJI, 'Compatible with DJI Osmo Action 4 Battery').length, 0);
});

test('filters with "compatibili con i droni [brand]" are rejected', () => {
  assert.equal(scan(DJI, 'Filtri ND compatibili con i droni DJI Mini 4').length, 0);
});

test('authentic product with non-compatibility filler matches', () => {
  assert.equal(scan(DJI, 'Drone per principianti DJI Mini 4').length, 1);
});

test('authentic Bambu Lab title matches', () => {
  assert.equal(scan(BAMBU, 'Bambu Lab X1-Carbon 3D Printer').length, 1);
});

test('accessory with "compatibile con Bambu Lab" is rejected', () => {
  assert.equal(scan(BAMBU, 'Meltura Bobina vuota compatibile con Bambu Lab').length, 0);
});

test('keyword rules are not subject to the compatibility filter', () => {
  assert.equal(scan([{ type: 'keyword', pattern: 'drone', score: 9 }], 'Eliche per drone DJI').length, 1);
});

// Genuine bundle, real rules with sharedExclude
test('genuine bundle with accessories included does not veto and would pick', () => {
  const result = scoreWith(...REAL, { title: 'DJI Mini 4 Pro Drone con telecamera 4K, radiocomando e accessori inclusi', queue: 'encore', value: 750 });
  assert.ok(!result.veto);
  assert.equal(result.affinitySource, 'rule');
  assert.equal(result.affinityScore, 10);
  assert.equal(result.confidence, 88);
  assert.equal(result.wouldPick, true);
});

test('accessory kit vetoes', () => {
  const result = scoreWith(...REAL, { title: 'Kit accessori per DJI Mini 4 Pro', queue: 'encore', value: 40 });
  assert.equal(result.veto, true);
});

test('dust bag for DJI is skipped with unknown affinity under real rules', () => {
  const result = scoreWith(...REAL, { title: 'Sacchetto protettivo antipolvere per DJI Osmo', queue: 'encore', value: 150 });
  assert.equal(result.affinitySource, 'unknown');
  assert.equal(result.confidence, 36);
  assert.equal(result.wouldPick, false);
});

test('propellers for DJI are skipped with unknown affinity under real rules', () => {
  const result = scoreWith(...REAL, { title: 'HUAREW 8Pcs Eliche per DJI Air 3/Air 3S', queue: 'encore', value: 25 });
  assert.equal(result.affinitySource, 'unknown');
  assert.equal(result.confidence, 17);
  assert.equal(result.wouldPick, false);
});

// Diacritics and entities
test('phrase rule with accent matches title with accent', () => {
  assert.equal(scan([{ type: 'phrase', pattern: 'contenitore per caffè', score: 8 }], 'Contenitore per Caffè ermetico').length, 1);
});

test('phrase rule with accent matches title in uppercase without accent', () => {
  assert.equal(scan([{ type: 'phrase', pattern: 'contenitore per caffè', score: 8 }], 'CONTENITORE PER CAFFE ermetico').length, 1);
});

test('keyword caffe matches macchina per caffè', () => {
  assert.equal(scan([{ type: 'keyword', pattern: 'caffe', score: 5 }], 'Macchina per caffè').length, 1);
});

test('normalizeTitle decodes html entities properly', () => {
  assert.equal(core.normalizeTitle('Apple &quot;MagSafe&quot; &amp; iPad &#39;Pro&#39;'), 'apple "magsafe" & ipad \'pro\'');
});

test('normalizeTitle strips trademark symbols and brand matches', () => {
  assert.equal(core.normalizeTitle('TP-Link™ Archer AX3000'), 'tp-link archer ax3000');
  assert.equal(scan([{ type: 'brand', pattern: 'TP-Link', score: 9 }], 'TP-Link™ Archer AX3000').length, 1);
});

test('contraction guard still works after quote normalization', () => {
  assert.equal(scan([{ type: 'brand', pattern: 'Dell', score: 8 }], "Bottiglia dell’olio").length, 0);
});

test('contenitore per caffè matches in real rules', () => {
  const result = scoreWith(...REAL, { title: 'Contenitore per caffè ermetico', queue: 'encore', value: 30 });
  assert.equal(result.affinitySource, 'rule');
  assert.equal(result.rule.pattern, 'contenitore per caffè');
});
