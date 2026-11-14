'use strict';
const test = require('node:test');
const assert = require('node:assert');
const runways = require('../src/pkjs/lib/runways');

test('looks an airport up in the bundled table', () => {
  const r = runways.lookup('KRDU');
  assert.ok(Array.isArray(r) && r.length >= 2);
  assert.deepStrictEqual(r[0], { le: '05L', he: '23R', hdg: 45, len: 10000 });
});

test('runways come back longest first', () => {
  const r = runways.lookup('KBOS');
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].len >= r[i].len);
});

test('lookup is case-insensitive and tolerates whitespace', () => {
  assert.deepStrictEqual(runways.lookup(' krdu '), runways.lookup('KRDU'));
});

test('an airport with no usable runway data returns null, not an empty guess', () => {
  assert.strictEqual(runways.lookup('KZZZZ'), null);
  assert.strictEqual(runways.lookup(''), null);
  assert.strictEqual(runways.lookup(null), null);
});

test('single-digit runway idents are padded the way the pavement is painted', () => {
  const r = runways.lookup('KSFO');
  const idents = r.map((x) => x.le).concat(r.map((x) => x.he));
  assert.ok(idents.indexOf('01R') >= 0, idents.join(','));
  assert.ok(idents.indexOf('1R') < 0);
});

test('every heading in the table is a plausible true bearing', () => {
  for (const icao of ['KRDU', 'KJFK', 'KSFO', 'KBOS', 'KASE', 'PANC']) {
    for (const r of runways.lookup(icao)) {
      assert.ok(r.hdg >= 0 && r.hdg < 360, icao + ' ' + r.le + ' ' + r.hdg);
      assert.ok(r.len >= 2000);
    }
  }
});

test('the true heading is within a magnetic variation of the painted number', () => {
  // A runway ident is its magnetic heading in tens of degrees.  True and
  // magnetic differ by the local variation, which nowhere on earth exceeds
  // about 25 degrees at the latitudes this table covers.  A larger gap would
  // mean the table had picked up a heading in the wrong reference frame.
  const table = runways.all();
  let checked = 0;
  for (const icao in table) {
    for (const r of table[icao]) {
      const painted = parseInt(r.le, 10) * 10;
      let d = (r.hdg - painted + 540) % 360 - 180;
      assert.ok(Math.abs(d) <= 30, icao + ' ' + r.le + ' true ' + r.hdg + ' vs painted ' + painted);
      checked++;
    }
  }
  assert.ok(checked > 4000, 'expected a few thousand runways, got ' + checked);
});
