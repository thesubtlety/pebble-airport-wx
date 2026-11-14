'use strict';
const test = require('node:test');
const assert = require('node:assert');
const wind = require('../src/pkjs/lib/wind');

test('angle difference normalises into (-180, 180]', () => {
  assert.strictEqual(wind.angleDiff(265, 230), 35);
  assert.strictEqual(wind.angleDiff(200, 230), -30);
  assert.strictEqual(wind.angleDiff(10, 350), 20, 'must wrap through north');
  assert.strictEqual(wind.angleDiff(350, 10), -20);
  assert.strictEqual(wind.angleDiff(50, 230), 180, 'a dead tailwind is +180, not -180');
});

test('components: the worked example from the spec', () => {
  const c = wind.components(265, 12, 230);
  assert.strictEqual(c.headwind, 10);
  assert.strictEqual(c.crosswind, 7);
  assert.strictEqual(c.side, 'R');
});

test('components: a crosswind from the left is labelled L', () => {
  assert.strictEqual(wind.components(200, 12, 230).side, 'L');
});

test('components: a tailwind is a negative headwind, not an absolute value', () => {
  const c = wind.components(50, 12, 230);
  assert.strictEqual(c.headwind, -12);
  assert.strictEqual(c.crosswind, 0);
});

test('components: a direct crosswind puts the whole speed across', () => {
  const c = wind.components(320, 15, 230);
  assert.strictEqual(c.headwind, 0);
  assert.strictEqual(c.crosswind, 15);
  assert.strictEqual(c.side, 'R');
});

test('components: crosswind is reported as a magnitude plus a side', () => {
  assert.strictEqual(wind.components(140, 15, 230).crosswind, 15);
  assert.strictEqual(wind.components(140, 15, 230).side, 'L');
});

test('components are unavailable when the wind direction is not a number', () => {
  assert.strictEqual(wind.components(null, 12, 230), null);
  assert.strictEqual(wind.components(265, null, 230), null);
  assert.strictEqual(wind.components(265, 12, null), null,
    'no runway heading means no component figure -- never assume zero variation');
});

const KRDU = [
  { le: '05L', he: '23R', hdg: 45, len: 10000 },
  { le: '05R', he: '23L', hdg: 45, len: 7500 },
  { le: '14', he: '32', hdg: 135, len: 3570 }
];

test('runway selection takes the longest runway and its into-wind end', () => {
  const r = wind.selectRunway(KRDU, 230, 12, { calmKt: 5 });
  assert.strictEqual(r.ident, '23R');
  assert.strictEqual(r.headingTrue, 225);
  assert.strictEqual(r.lengthFt, 10000);
});

test('runway selection flips to the reciprocal when the wind does', () => {
  const r = wind.selectRunway(KRDU, 50, 12, { calmKt: 5 });
  assert.strictEqual(r.ident, '05L');
  assert.strictEqual(r.headingTrue, 45);
});

test('a dead crosswind still picks the end with non-negative headwind', () => {
  const r = wind.selectRunway(KRDU, 135, 12, { calmKt: 5 });
  assert.ok(Math.abs(wind.angleDiff(135, r.headingTrue)) <= 90);
});

test('below the calm threshold, the configured calm-wind runway wins', () => {
  const r = wind.selectRunway(KRDU, 230, 3, { calmKt: 5, calmRunway: '05L' });
  assert.strictEqual(r.ident, '05L', 'wind favours 23R but 3 kt is calm');
});

test('with no calm-wind runway configured, calm falls back to the lower-numbered end', () => {
  const r = wind.selectRunway(KRDU, 230, 3, { calmKt: 5 });
  assert.strictEqual(r.ident, '05L');
});

test('variable wind is treated as calm for runway selection', () => {
  const r = wind.selectRunway(KRDU, null, 8, { calmKt: 5 });
  assert.strictEqual(r.ident, '05L');
});

test('a manual runway overrides the heuristic entirely', () => {
  const r = wind.selectRunway(KRDU, 230, 12, { calmKt: 5, manual: '14' });
  assert.strictEqual(r.ident, '14');
  assert.strictEqual(r.headingTrue, 135);
  assert.strictEqual(r.lengthFt, 3570);
});

test('a manual runway that does not exist here falls back to the heuristic', () => {
  const r = wind.selectRunway(KRDU, 230, 12, { calmKt: 5, manual: '09' });
  assert.strictEqual(r.ident, '23R');
});

test('no runway data means no runway, not a guessed one', () => {
  assert.strictEqual(wind.selectRunway([], 230, 12, { calmKt: 5 }), null);
  assert.strictEqual(wind.selectRunway(null, 230, 12, { calmKt: 5 }), null);
});

test('reciprocal headings wrap rather than exceeding 360', () => {
  const r = wind.selectRunway([{ le: '31', he: '13', hdg: 310, len: 5000 }], 130, 12, { calmKt: 5 });
  assert.strictEqual(r.ident, '13');
  assert.strictEqual(r.headingTrue, 130);
});
