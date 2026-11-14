'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cat = require('../src/pkjs/lib/category');

const { VFR, MVFR, IFR, LIFR, UNKNOWN } = cat;

test('category enum matches the AppMessage wire values', () => {
  assert.deepStrictEqual([VFR, MVFR, IFR, LIFR, UNKNOWN], [0, 1, 2, 3, 4]);
});

test('ceiling category boundaries', () => {
  assert.strictEqual(cat.ceilingCategory(null), VFR, 'no ceiling layer is unlimited, i.e. VFR');
  assert.strictEqual(cat.ceilingCategory(25000), VFR);
  assert.strictEqual(cat.ceilingCategory(3100), VFR);
  assert.strictEqual(cat.ceilingCategory(3000), MVFR, '3000 is the top of MVFR, not the bottom of VFR');
  assert.strictEqual(cat.ceilingCategory(1000), MVFR);
  assert.strictEqual(cat.ceilingCategory(999), IFR);
  assert.strictEqual(cat.ceilingCategory(500), IFR);
  assert.strictEqual(cat.ceilingCategory(499), LIFR);
  assert.strictEqual(cat.ceilingCategory(0), LIFR);
});

test('visibility category boundaries', () => {
  assert.strictEqual(cat.visCategory(10), VFR);
  assert.strictEqual(cat.visCategory(5.5), VFR);
  assert.strictEqual(cat.visCategory(5), MVFR, '5 SM is the top of MVFR');
  assert.strictEqual(cat.visCategory(3), MVFR);
  assert.strictEqual(cat.visCategory(2.5), IFR);
  assert.strictEqual(cat.visCategory(1), IFR);
  assert.strictEqual(cat.visCategory(0.75), LIFR);
  assert.strictEqual(cat.visCategory(0), LIFR);
});

test('unknown inputs give UNKNOWN, never a reassuring VFR', () => {
  assert.strictEqual(cat.visCategory(null), UNKNOWN);
  assert.strictEqual(cat.visCategory(undefined), UNKNOWN);
  assert.strictEqual(cat.visCategory(NaN), UNKNOWN);
  assert.strictEqual(cat.ceilingCategory(undefined), UNKNOWN);
  assert.strictEqual(cat.ceilingCategory(NaN), UNKNOWN);
});

test('overall category is the worse of the two', () => {
  assert.strictEqual(cat.worst(VFR, MVFR), MVFR);
  assert.strictEqual(cat.worst(IFR, MVFR), IFR);
  assert.strictEqual(cat.worst(LIFR, VFR), LIFR);
  assert.strictEqual(cat.worst(VFR, VFR), VFR);
});

test('a missing value never masks a known bad one', () => {
  assert.strictEqual(cat.worst(UNKNOWN, IFR), IFR, 'unknown ceiling must not hide IFR visibility');
  assert.strictEqual(cat.worst(VFR, UNKNOWN), VFR);
  assert.strictEqual(cat.worst(UNKNOWN, UNKNOWN), UNKNOWN);
});

test('name() spells the category out, because colour is never the only carrier', () => {
  assert.strictEqual(cat.name(VFR), 'VFR');
  assert.strictEqual(cat.name(MVFR), 'MVFR');
  assert.strictEqual(cat.name(IFR), 'IFR');
  assert.strictEqual(cat.name(LIFR), 'LIFR');
  assert.strictEqual(cat.name(UNKNOWN), '--');
});
