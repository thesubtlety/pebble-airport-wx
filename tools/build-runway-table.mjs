#!/usr/bin/env node
/**
 * Generates src/pkjs/lib/runway-table.js from the OurAirports runways.csv
 * (public domain).  Run it when you want to refresh the bundled data:
 *
 *   curl -L -o /tmp/runways.csv https://davidmegginson.github.io/ourairports-data/runways.csv
 *   node tools/build-runway-table.mjs /tmp/runways.csv
 *
 * True-heading sourcing, in priority order:
 *
 *   1. Geodetic bearing between the two threshold coordinates.  This is the
 *      most defensible source: it comes from surveyed positions, it is by
 *      construction self-consistent (the reciprocal end really is +180), and
 *      it agrees with the dataset's own le_heading_degT to a median 0.25 deg.
 *   2. le_heading_degT / he_heading_degT, when present.
 *   3. Nothing.  The runway is dropped from the table and the watch shows the
 *      wind rose with no runway bar and no HW/XW readout.  We never fabricate
 *      a true heading from an assumed magnetic variation.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../src/pkjs/lib/runway-table.js');

const MIN_LENGTH_FT = 2000;
// Idents we care about: US and US-territory ICAO codes.  The app is US-only
// (its category limits are the US ones); a wider net just inflates the bundle.
const IDENT_RE = /^(K[A-Z0-9]{3}|P[AH][A-Z0-9]{2})$/;

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { quoted = false; }
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s) => {
  const t = (s || '').trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function geodeticBearing(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const src = process.argv[2] || '/tmp/runways.csv';
const rows = parseCsv(readFileSync(src, 'utf8'));
const header = rows.shift();
const col = Object.fromEntries(header.map((h, i) => [h.replace(/"/g, ''), i]));

const airports = new Map();
const stats = { seen: 0, kept: 0, geodetic: 0, tabulated: 0, dropped: 0, contradictory: 0 };

// A runway ident is its magnetic heading in tens of degrees, so the true
// heading should sit within one magnetic variation of it.  Variation reaches
// about 20 degrees over Alaska, and the ident itself is rounded to the nearest
// 10, so anything beyond 30 degrees is not variation -- it is bad source data,
// a runway renumbered without the record being updated, or threshold
// coordinates transposed.  Those get dropped: the wind page falls back to a
// bare rose, which is honest, where a wrong bar and a wrong crosswind are not.
const MAX_VARIATION_DEG = 30;
// Where the dataset gives us both a tabulated heading and threshold
// coordinates, they should agree.  When they disagree badly one of them is
// wrong and we cannot tell which.
const MAX_SOURCE_DISAGREEMENT_DEG = 15;

const norm180 = (d) => ((d % 360) + 540) % 360 - 180;

for (const r of rows) {
  if (r.length < header.length) continue;
  const ident = (r[col.airport_ident] || '').trim().toUpperCase();
  if (!IDENT_RE.test(ident)) continue;
  if ((r[col.closed] || '').trim() === '1') continue;
  const length = num(r[col.length_ft]);
  if (!length || length < MIN_LENGTH_FT) continue;
  stats.seen++;

  // OurAirports writes "1R" where a pilot reads "01R".  Pad so the label on
  // the watch matches the numbers painted on the pavement.
  // Idents must be a real runway number, 01-36, optionally with a position
  // letter.  A few military fields carry three-digit heading-style idents and
  // a few records are simply malformed; neither can be labelled or checked, so
  // they are dropped rather than displayed.
  const padIdent = (s) => {
    const m = /^(\d{1,2})([LRCWGA]?)$/.exec((s || '').trim().toUpperCase());
    if (!m) return null;
    const n = Number(m[1]);
    if (n < 1 || n > 36) return null;
    return String(n).padStart(2, '0') + m[2];
  };
  const le = padIdent(r[col.le_ident]);
  const he = padIdent(r[col.he_ident]);
  if (!le || !he) { stats.dropped++; continue; }

  const lat1 = num(r[col.le_latitude_deg]), lon1 = num(r[col.le_longitude_deg]);
  const lat2 = num(r[col.he_latitude_deg]), lon2 = num(r[col.he_longitude_deg]);

  const tabulated = num(r[col.le_heading_degT]);
  const geodetic =
    lat1 !== null && lon1 !== null && lat2 !== null && lon2 !== null &&
    !(lat1 === lat2 && lon1 === lon2)
      ? geodeticBearing(lat1, lon1, lat2, lon2)
      : null;

  let leHdg = null;
  if (geodetic !== null) { leHdg = geodetic; stats.geodetic++; }
  else if (tabulated !== null) { leHdg = tabulated; stats.tabulated++; }
  if (leHdg === null) { stats.dropped++; continue; }

  if (geodetic !== null && tabulated !== null &&
      Math.abs(norm180(geodetic - tabulated)) > MAX_SOURCE_DISAGREEMENT_DEG) {
    stats.contradictory++; stats.dropped++; continue;
  }
  if (Math.abs(norm180(leHdg - Number(le.slice(0, 2)) * 10)) > MAX_VARIATION_DEG) {
    stats.contradictory++; stats.dropped++; continue;
  }

  stats.kept++;
  if (!airports.has(ident)) airports.set(ident, []);
  airports.get(ident).push({ le, he, hdg: Math.round(leHdg) % 360, len: Math.round(length) });
}

const lines = [];
for (const ident of [...airports.keys()].sort()) {
  // Longest first: the runway-selection heuristic wants the longest runway and
  // reading order saves it a sort on the watch side.
  const rwys = airports.get(ident).sort((a, b) => b.len - a.len);
  lines.push(ident + '|' + rwys.map((w) => `${w.le}:${w.he}:${w.hdg}:${w.len}`).join('|'));
}

const table = lines.join('\n');
const out = `/* GENERATED by tools/build-runway-table.mjs -- do not edit by hand.
 *
 * Source: OurAirports runways.csv (public domain), filtered to open US runways
 * of ${MIN_LENGTH_FT} ft or more.  One line per airport:
 *
 *   ICAO|LE_IDENT:HE_IDENT:LE_TRUE_HEADING:LENGTH_FT|...
 *
 * Runways are listed longest first.  LE_TRUE_HEADING is degrees TRUE; the
 * reciprocal end's heading is that plus 180.  Runways whose true heading could
 * not be established, or whose sources contradict each other or the painted
 * runway number, are absent entirely rather than guessed: ${stats.dropped} of
 * ${stats.seen} were dropped, ${stats.contradictory} of them for contradiction.
 *
 * Airports: ${airports.size}.  Runways: ${stats.kept}.
 * Generated ${new Date().toISOString().slice(0, 10)}.
 */
'use strict';

module.exports = ${JSON.stringify(table)};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);
console.log(`airports=${airports.size} runways=${stats.kept} geodetic=${stats.geodetic} ` +
            `tabulated=${stats.tabulated} dropped=${stats.dropped} ` +
            `contradictory=${stats.contradictory} bytes=${out.length}`);
