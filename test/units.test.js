'use strict';
const test = require('node:test');
const assert = require('node:assert');
const u = require('../src/pkjs/lib/units');

test('parseVisibility copes with the "10+" string the JSON API actually sends', () => {
  assert.strictEqual(u.parseVisibility('10+'), 10);
  assert.strictEqual(u.parseVisibility('6+'), 6);
  assert.strictEqual(u.parseVisibility(5), 5);
  assert.strictEqual(u.parseVisibility('1.75'), 1.75);
  assert.strictEqual(u.parseVisibility('1 1/2'), 1.5);
  assert.strictEqual(u.parseVisibility('1/2'), 0.5);
  assert.strictEqual(u.parseVisibility(null), null);
  assert.strictEqual(u.parseVisibility(''), null);
  assert.strictEqual(u.parseVisibility('rubbish'), null);
});

test('altimeter: JSON altim is hectopascals and must be converted for inHg', () => {
  // KRDU reported altim 1021.1 in JSON and A3015 in the raw METAR.
  assert.strictEqual(u.formatAltimeter(1021.1, 'inhg'), '30.15');
  assert.strictEqual(u.formatAltimeter(1013.0, 'inhg'), '29.91');
  assert.strictEqual(u.formatAltimeter(1021.1, 'hpa'), '1021');
  assert.strictEqual(u.formatAltimeter(null, 'inhg'), '--');
});

test('temperature rounds rather than truncates, and never loses a minus sign', () => {
  assert.strictEqual(u.formatTemp(30, 20.6, 'f'), '86/69F');
  assert.strictEqual(u.formatTemp(19.4, 12.2, 'c'), '19/12C');
  assert.strictEqual(u.formatTemp(-0.4, -5.5, 'c'), '0/-6C');
  assert.strictEqual(u.formatTemp(13.9, 7.8, 'c'), '14/8C');
  assert.strictEqual(u.formatTemp(null, 12, 'c'), '--');
});

test('temperature strings stay inside the 10-byte AppMessage budget', () => {
  assert.ok(u.formatTemp(-40, -40, 'f').length <= 9, u.formatTemp(-40, -40, 'f'));
  assert.ok(u.formatTemp(-40, -40, 'c').length <= 9);
});

test('visibility renders as a pilot writes it', () => {
  assert.strictEqual(u.formatVisibility(10, 'sm'), '10SM');
  assert.strictEqual(u.formatVisibility(3, 'sm'), '3SM');
  assert.strictEqual(u.formatVisibility(2.5, 'sm'), '2 1/2SM');
  assert.strictEqual(u.formatVisibility(1.5, 'sm'), '1 1/2SM');
  assert.strictEqual(u.formatVisibility(0.75, 'sm'), '3/4SM');
  assert.strictEqual(u.formatVisibility(0.5, 'sm'), '1/2SM');
  assert.strictEqual(u.formatVisibility(0.25, 'sm'), '1/4SM');
  assert.strictEqual(u.formatVisibility(0, 'sm'), '0SM');
  assert.strictEqual(u.formatVisibility(null, 'sm'), '--');
});

test('visibility strings stay inside the 8-byte AppMessage budget', () => {
  for (const v of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2.5, 3, 7, 10, 15]) {
    for (const unit of ['sm', 'km']) {
      assert.ok(u.formatVisibility(v, unit).length <= 7,
        unit + ' ' + v + ' -> ' + u.formatVisibility(v, unit));
    }
  }
});

test('metric visibility', () => {
  assert.strictEqual(u.formatVisibility(10, 'km'), '16KM');
  assert.strictEqual(u.formatVisibility(1.5, 'km'), '2.4KM');
});

test('ceiling: no BKN/OVC layer is UNL, not zero', () => {
  assert.strictEqual(u.formatCeiling(null, false, 'ft'), 'UNL');
  assert.strictEqual(u.formatCeiling(2400, false, 'ft'), '2400');
  assert.strictEqual(u.formatCeiling(400, false, 'ft'), '400');
  assert.strictEqual(u.formatCeiling(25000, false, 'ft'), '25000');
  assert.strictEqual(u.formatCeiling(undefined, false, 'ft'), '--');
});

test('ceiling keeps vertical visibility distinguishable from a cloud base', () => {
  assert.strictEqual(u.formatCeiling(300, true, 'ft'), 'VV300');
  assert.strictEqual(u.formatCeiling(300, true, 'm'), 'VV90M');
});

test('metric ceiling', () => {
  assert.strictEqual(u.formatCeiling(2400, false, 'm'), '730M');
  assert.strictEqual(u.formatCeiling(null, false, 'm'), 'UNL');
});

test('visibility below 2 SM is shown in the steps it is reported in, not rounded to quarters', () => {
  // 1/8 used to read "1/4" and 1 3/8 used to read "1 1/2": better than reported.
  assert.strictEqual(u.formatVisibility(1 / 16, 'sm'), '1/16SM');
  assert.strictEqual(u.formatVisibility(1 / 8, 'sm'), '1/8SM');
  assert.strictEqual(u.formatVisibility(3 / 16, 'sm'), '3/16SM');
  assert.strictEqual(u.formatVisibility(5 / 16, 'sm'), '5/16SM');
  assert.strictEqual(u.formatVisibility(3 / 8, 'sm'), '3/8SM');
  assert.strictEqual(u.formatVisibility(5 / 8, 'sm'), '5/8SM');
  assert.strictEqual(u.formatVisibility(1.375, 'sm'), '1 3/8SM');
  assert.strictEqual(u.formatVisibility(1.875, 'sm'), '1 7/8SM');
  assert.strictEqual(u.formatVisibility(2.75, 'sm'), '2 3/4SM');
});

test('a visibility between reporting steps rounds down, never up', () => {
  assert.strictEqual(u.formatVisibility(2.9, 'sm'), '2 3/4SM', 'not "3SM", which would read as MVFR');
  assert.strictEqual(u.formatVisibility(0.99, 'sm'), '7/8SM');
});

test('every US reportable visibility fits the 8-byte AppMessage field', () => {
  const reportable = [0, 1 / 16, 1 / 8, 3 / 16, 1 / 4, 5 / 16, 3 / 8, 1 / 2, 5 / 8, 3 / 4, 7 / 8,
    1, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875, 2, 2.25, 2.5, 2.75, 3, 4, 5, 6, 7, 10];
  for (const v of reportable) {
    assert.ok(u.formatVisibility(v, 'sm').length <= 7, v + ' -> ' + u.formatVisibility(v, 'sm'));
  }
});

test('parseVisibility reads the less-than and greater-than forms as their bound', () => {
  assert.strictEqual(u.parseVisibility('M1/4'), 0.25);
  assert.strictEqual(u.parseVisibility('P6'), 6);
  assert.strictEqual(u.parseVisibility('1/2SM'), 0.5);
});
