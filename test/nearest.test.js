'use strict';
const test = require('node:test');
const assert = require('node:assert');
const nearest = require('../src/pkjs/lib/nearest');

const RDU = { lat: 35.8923, lon: -78.782 };

test('great-circle distance in nautical miles', () => {
  // KRDU to KJFK is a shade over 370 nm.
  const d = nearest.distanceNm(RDU.lat, RDU.lon, 40.6392, -73.7639);
  assert.ok(Math.abs(d - 371) < 5, d);
  assert.strictEqual(Math.round(nearest.distanceNm(RDU.lat, RDU.lon, RDU.lat, RDU.lon)), 0);
});

test('the bounding box spans the search radius in both directions', () => {
  const b = nearest.boundingBox(RDU.lat, RDU.lon, 60);
  assert.ok(Math.abs((b.maxLat - b.minLat) - 2) < 0.01, 'a degree of latitude is 60 nm');
  assert.ok(b.maxLon - b.minLon > 2, 'longitude degrees are shorter at 36 N, so the box is wider');
  assert.ok(b.minLat < RDU.lat && b.maxLat > RDU.lat);
});

test('the bounding box does not run off the end of the world', () => {
  const polar = nearest.boundingBox(89.5, 0, 200);
  assert.ok(polar.maxLat <= 90 && polar.minLat >= -90);
  assert.ok(polar.maxLon <= 180 && polar.minLon >= -180);
});

test('the bounding box formats as the API expects it', () => {
  const s = nearest.bboxParam(RDU.lat, RDU.lon, 60);
  assert.match(s, /^-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+$/, s);
  assert.strictEqual(s.split(',').length, 4);
});

const NOW = 1788122100;
const stations = [
  { icaoId: 'KRDU', lat: 35.8923, lon: -78.782, obsTime: NOW - 600 },
  { icaoId: 'KTTA', lat: 35.5762, lon: -79.1035, obsTime: NOW - 300 },
  { icaoId: 'KLHZ', lat: 36.0229, lon: -78.3341, obsTime: NOW - 300 },
  { icaoId: 'KOLD', lat: 35.90, lon: -78.79, obsTime: NOW - 9000 }
];

test('the nearest station wins', () => {
  const p = nearest.pick(stations, 35.60, -79.05, { now: NOW, maxAgeS: 5400, radiusNm: 50 });
  assert.strictEqual(p.icaoId, 'KTTA');
});

test('a stale report is not a nearby station, however close it is', () => {
  const p = nearest.pick(stations, RDU.lat, RDU.lon, { now: NOW, maxAgeS: 5400, radiusNm: 50 });
  assert.strictEqual(p.icaoId, 'KRDU', 'KOLD is closer in the list order but two and a half hours old');
});

test('a station beyond the radius is out, even though the box included it', () => {
  const p = nearest.pick(stations, RDU.lat, RDU.lon, { now: NOW, maxAgeS: 5400, radiusNm: 1 });
  assert.strictEqual(p.icaoId, 'KRDU', 'only the station under our feet is inside a 1 nm radius');
  const none = nearest.pick(stations, 30, -100, { now: NOW, maxAgeS: 5400, radiusNm: 50 });
  assert.strictEqual(none, null);
});

test('nothing in range returns null rather than the least-bad option', () => {
  assert.strictEqual(nearest.pick([], RDU.lat, RDU.lon, { now: NOW, maxAgeS: 5400, radiusNm: 50 }), null);
  assert.strictEqual(nearest.pick(null, RDU.lat, RDU.lon, { now: NOW, maxAgeS: 5400, radiusNm: 50 }), null);
});

test('stations without a position are skipped rather than treated as at the equator', () => {
  const p = nearest.pick([{ icaoId: 'KBAD', obsTime: NOW }].concat(stations),
    RDU.lat, RDU.lon, { now: NOW, maxAgeS: 5400, radiusNm: 50 });
  assert.strictEqual(p.icaoId, 'KRDU');
});
