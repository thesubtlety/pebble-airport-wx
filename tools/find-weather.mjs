#!/usr/bin/env node
/*
 * List US stations reporting below VFR right now, with whether the app has
 * runway data for them.  For choosing screenshot stations; see
 * tools/capture-store-screenshots.sh.
 *
 *   node tools/find-weather.mjs
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const runways = require('../src/pkjs/lib/runways.js');
const { USER_AGENT } = require('../src/pkjs/lib/awc.js');

const url = 'https://aviationweather.gov/api/data/metar?bbox=24,-125,50,-66&format=json';
const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
if (!res.ok) {
  console.error('AWC returned HTTP ' + res.status);
  process.exit(1);
}
const data = await res.json();
for (const cat of ['LIFR', 'IFR', 'MVFR']) {
  for (const m of data.filter((x) => x.fltCat === cat && /^K/.test(x.icaoId || ''))) {
    console.log(cat.padEnd(5), m.icaoId, runways.lookup(m.icaoId) ? 'rwy' : '   ', (m.rawOb || '').slice(0, 90));
  }
}
