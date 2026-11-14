'use strict';
const test = require('node:test');
const assert = require('node:assert');
const config = require('../src/pkjs/config');
const settings = require('../src/pkjs/lib/settings');

function walk(items, fn) {
  for (const item of items) {
    fn(item);
    if (item.items) walk(item.items, fn);
  }
}

test('the Clay config is a well-formed list of items', () => {
  assert.ok(Array.isArray(config));
  walk(config, (i) => assert.ok(typeof i.type === 'string' && i.type.length, JSON.stringify(i)));
});

test('every configurable field has somewhere to land in the settings model', () => {
  // station2..5 are collapsed into settings.stations; everything else must map
  // one-for-one, or a user could set something that silently does nothing.
  const collapsed = ['station2', 'station3', 'station4', 'station5'];
  walk(config, (i) => {
    if (!i.messageKey) return;
    if (collapsed.indexOf(i.messageKey) >= 0) return;
    assert.ok(i.messageKey in settings.DEFAULTS, 'unhandled setting: ' + i.messageKey);
  });
});

test('Clay defaults agree with the code defaults', () => {
  walk(config, (i) => {
    if (!i.messageKey || i.defaultValue === undefined) return;
    if (!(i.messageKey in settings.DEFAULTS)) return;
    const expected = settings.DEFAULTS[i.messageKey];
    if (typeof expected === 'boolean') {
      assert.strictEqual(i.defaultValue, expected, i.messageKey);
    } else if (typeof expected === 'number') {
      assert.strictEqual(Number(i.defaultValue), expected, i.messageKey);
    } else {
      assert.strictEqual(String(i.defaultValue), String(expected), i.messageKey);
    }
  });
});

test('the settings a user saves survive normalisation', () => {
  const saved = {};
  walk(config, (i) => {
    if (i.messageKey && i.defaultValue !== undefined) saved[i.messageKey] = i.defaultValue;
  });
  saved.homeStation = 'KRDU';
  const s = settings.normalise(saved);
  assert.deepStrictEqual(s.stations, ['KRDU']);
  assert.strictEqual(s.tafPeriods, 4);
  assert.strictEqual(s.calmKt, 5);
});

test('the disclaimer is present and says what it must', () => {
  let text = '';
  walk(config, (i) => { if (i.type === 'text') text += i.defaultValue; });
  assert.match(text, /not a flight planning tool/i);
  assert.match(text, /official/i);
});
