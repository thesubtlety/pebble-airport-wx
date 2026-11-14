'use strict';
const test = require('node:test');
const assert = require('node:assert');
const settings = require('../src/pkjs/lib/settings');

test('defaults match the specification', () => {
  const s = settings.normalise({});
  assert.strictEqual(s.nearestRadiusNm, 50);
  assert.strictEqual(s.nearestRevertMin, 10);
  assert.strictEqual(s.calmKt, 5);
  assert.strictEqual(s.refreshMin, 15);
  assert.strictEqual(s.staleAmberMin, 45);
  assert.strictEqual(s.staleRedMin, 75);
  assert.strictEqual(s.tafPeriods, 4);
  assert.strictEqual(s.runwayAuto, true);
  assert.strictEqual(s.flickNearest, true);
  assert.strictEqual(s.refreshOnOpen, true);
  assert.strictEqual(s.vibeOnCatChange, false);
  assert.strictEqual(s.showRawPage, true);
});

test('Clay hands back strings, and they have to become numbers', () => {
  const s = settings.normalise({ nearestRadiusNm: '75', staleAmberMin: '30', tafPeriods: '6' });
  assert.strictEqual(s.nearestRadiusNm, 75);
  assert.strictEqual(s.staleAmberMin, 30);
  assert.strictEqual(s.tafPeriods, 6);
});

test('out-of-range settings are clamped rather than trusted', () => {
  const s = settings.normalise({ nearestRadiusNm: 9999, tafPeriods: 99, calmKt: -4 });
  assert.strictEqual(s.nearestRadiusNm, 200);
  assert.strictEqual(s.tafPeriods, 6);
  assert.strictEqual(s.calmKt, 0);
});

test('a red staleness threshold below the amber one is nonsense and is corrected', () => {
  const s = settings.normalise({ staleAmberMin: 90, staleRedMin: 30 });
  assert.ok(s.staleRedMin > s.staleAmberMin, s.staleAmberMin + '/' + s.staleRedMin);
});

test('the station list is the home airport followed by the extras', () => {
  const s = settings.normalise({ homeStation: 'krdu', stations: ['ktta', '', 'KJNX', null] });
  assert.deepStrictEqual(s.stations, ['KRDU', 'KTTA', 'KJNX']);
});

test('malformed identifiers are dropped, not sent to the API', () => {
  const s = settings.normalise({ homeStation: 'KRDU', stations: ['nope!', 'K', 'KTTAX', 'KJNX'] });
  assert.deepStrictEqual(s.stations, ['KRDU', 'KJNX']);
});

test('duplicates are collapsed so Up/Down does not cycle through the same field twice', () => {
  const s = settings.normalise({ homeStation: 'KRDU', stations: ['KRDU', 'KTTA'] });
  assert.deepStrictEqual(s.stations, ['KRDU', 'KTTA']);
});

test('no home airport yields an empty list rather than a fabricated one', () => {
  assert.deepStrictEqual(settings.normalise({}).stations, []);
});

test('the API base is configurable, so a proxy is a setting and not a code change', () => {
  assert.strictEqual(settings.normalise({}).apiBase, settings.DEFAULT_API_BASE);
  assert.strictEqual(settings.normalise({ apiBase: 'https://wx.example.com/api/data/ ' }).apiBase,
    'https://wx.example.com/api/data/');
  assert.strictEqual(settings.normalise({ apiBase: 'https://wx.example.com/api/data' }).apiBase,
    'https://wx.example.com/api/data/', 'a missing trailing slash must not break URL building');
});

test('a non-https API base is rejected rather than silently used', () => {
  assert.strictEqual(settings.normalise({ apiBase: 'http://insecure.example.com/' }).apiBase,
    settings.DEFAULT_API_BASE);
  assert.strictEqual(settings.normalise({ apiBase: 'javascript:alert(1)' }).apiBase,
    settings.DEFAULT_API_BASE);
});

test('validateIcao accepts what the API accepts and nothing else', () => {
  assert.ok(settings.validateIcao('KRDU'));
  assert.ok(settings.validateIcao('kase'));
  assert.ok(settings.validateIcao('K5J9'));
  assert.ok(!settings.validateIcao('KRD'));
  assert.ok(!settings.validateIcao('KRDUX'));
  assert.ok(!settings.validateIcao('K RD'));
  assert.ok(!settings.validateIcao(''));
  assert.ok(!settings.validateIcao(null));
});

test('Clay sends the extra stations as separate keys, and they must be collected', () => {
  const s = settings.normalise({
    homeStation: 'KRDU', station2: 'KTTA', station3: '', station4: 'kjnx', station5: 'KBOS'
  });
  assert.deepStrictEqual(s.stations, ['KRDU', 'KTTA', 'KJNX', 'KBOS']);
});

test('an extra-station key and a stations array can both be present', () => {
  const s = settings.normalise({ homeStation: 'KRDU', station2: 'KTTA', stations: ['KJNX'] });
  assert.deepStrictEqual(s.stations, ['KRDU', 'KTTA', 'KJNX']);
});
