'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const obs = require('../src/pkjs/lib/observation');
const cat = require('../src/pkjs/lib/category');

const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'))[0];

const DEFAULTS = {
  altimUnit: 'inhg', tempUnit: 'f', visUnit: 'sm', ceilUnit: 'ft',
  calmKt: 5, maxWindKt: 0, maxXwKt: 0, maxGustKt: 0, minCigFt: 0, minVisSm: 0
};
const settings = (over) => Object.assign({}, DEFAULTS, over || {});

test('a plain VFR report', () => {
  const o = obs.build(fixture('metar-krdu.json'), settings());
  assert.strictEqual(o.station, 'KRDU');
  assert.strictEqual(o.obsEpoch, 1788119460);
  assert.strictEqual(o.catOverall, cat.VFR);
  assert.strictEqual(o.catVis, cat.VFR);
  assert.strictEqual(o.catCig, cat.VFR);
  assert.strictEqual(o.visStr, '10SM');
  assert.strictEqual(o.cigStr, '4700', 'lowest BKN layer is the ceiling; SCT036 is not');
  assert.strictEqual(o.altimStr, '30.15', 'JSON altim is hPa and must be converted');
  assert.strictEqual(o.tempStr, '86/69F');
  assert.ok(o.raw.indexOf('KRDU') >= 0);
});

test('calm wind is distinguishable from a missing one', () => {
  const o = obs.build(fixture('metar-krdu.json'), settings());
  assert.strictEqual(o.windDir, obs.WIND_CALM);
  assert.strictEqual(o.windSpd, 0);
  assert.strictEqual(o.windGust, 0, 'a null wgst is no gust, not a gust of null');
});

test('a variable wind direction is its own state, not a bearing', () => {
  const o = obs.build(fixture('metar-kase-vrb.json'), settings());
  assert.strictEqual(o.windDir, obs.WIND_VRB);
  assert.strictEqual(o.windSpd, 4);
});

test('gusts survive the trip', () => {
  const o = obs.build(fixture('metar-kbos-gust.json'), settings());
  assert.strictEqual(o.windDir, 250);
  assert.strictEqual(o.windSpd, 13);
  assert.strictEqual(o.windGust, 24);
});

test('a clear sky is an unlimited ceiling, and VFR', () => {
  const o = obs.build(fixture('metar-clear.json'), settings());
  assert.strictEqual(o.ceilingFt, null);
  assert.strictEqual(o.cigStr, 'UNL');
  assert.strictEqual(o.catCig, cat.VFR);
});

test('an obscured sky uses vertical visibility as the ceiling and says so', () => {
  const o = obs.build(fixture('metar-lifr.json'), settings());
  assert.strictEqual(o.ceilingFt, 300);
  assert.strictEqual(o.ceilingIsVv, true);
  assert.strictEqual(o.cigStr, 'VV300');
  assert.strictEqual(o.catCig, cat.LIFR);
  assert.strictEqual(o.visStr, '1/2SM');
  assert.strictEqual(o.catVis, cat.LIFR);
  assert.strictEqual(o.catOverall, cat.LIFR);
});

test('each value carries its own category so the limiting one is visible', () => {
  const o = obs.build(fixture('metar-ifr-vis-mvfr-cig.json'), settings());
  assert.strictEqual(o.catVis, cat.IFR, '2 SM is IFR');
  assert.strictEqual(o.catCig, cat.MVFR, '2500 ft is MVFR');
  assert.strictEqual(o.catOverall, cat.IFR, 'the overall category is the worse of the two');
});

test('our derived overall category agrees with the API fltCat cross-check', () => {
  for (const f of ['metar-krdu.json', 'metar-kbos-gust.json', 'metar-kase-vrb.json',
                   'metar-clear.json', 'metar-lifr.json', 'metar-ifr-vis-mvfr-cig.json']) {
    const raw = fixture(f);
    const o = obs.build(raw, settings());
    assert.strictEqual(cat.name(o.catOverall), raw.fltCat, f);
  }
});

test('unit settings are applied on the phone so the watch stays unit-agnostic', () => {
  const o = obs.build(fixture('metar-krdu.json'),
    settings({ altimUnit: 'hpa', tempUnit: 'c', visUnit: 'km', ceilUnit: 'm' }));
  assert.strictEqual(o.altimStr, '1021');
  assert.strictEqual(o.tempStr, '30/21C');
  assert.strictEqual(o.visStr, '16KM');
  assert.strictEqual(o.cigStr, '1430M');
});

test('personal minima raise flags, independently of the regulatory category', () => {
  const o = obs.build(fixture('metar-kbos-gust.json'),
    settings({ maxWindKt: 12, maxGustKt: 20, minCigFt: 20000, minVisSm: 20 }));
  assert.ok(o.flags & obs.FLAG_WIND, '13 kt exceeds a 12 kt personal limit');
  assert.ok(o.flags & obs.FLAG_GUST, '24 kt gust exceeds a 20 kt personal limit');
  assert.ok(o.flags & obs.FLAG_CIG, '15000 ft is below a 20000 ft personal minimum');
  assert.ok(o.flags & obs.FLAG_VIS, '10 SM is below a 20 SM personal minimum');
});

test('a personal limit of zero means the check is off, not that everything trips it', () => {
  const o = obs.build(fixture('metar-kbos-gust.json'), settings());
  assert.strictEqual(o.flags, 0);
});

test('an unlimited ceiling never trips a personal ceiling minimum', () => {
  const o = obs.build(fixture('metar-clear.json'), settings({ minCigFt: 5000 }));
  assert.strictEqual(o.flags & obs.FLAG_CIG, 0);
});

test('runway components ride along when the airport is in the runway table', () => {
  const o = obs.build(fixture('metar-kbos-gust.json'), settings());
  // KBOS 15R/33L is the longest at 10,083 ft; a 250 wind favours the 33L end
  // (315 true), leaving 65 degrees off the nose.
  assert.strictEqual(o.runway.ident, '33L');
  assert.strictEqual(o.runway.headingTrue, 315);
  assert.strictEqual(o.runway.lengthFt, 10083);
  assert.strictEqual(o.hw, 5);
  assert.strictEqual(o.xw, 12);
  assert.strictEqual(o.xwSide, 'L');
});

test('the gust crosswind is what gets flagged, not the steady one', () => {
  const o = obs.build(fixture('metar-kbos-gust.json'), settings({ maxXwKt: 15 }));
  assert.strictEqual(o.xw, 12, 'steady crosswind is under the limit');
  assert.strictEqual(o.xwGust, 22, 'but the gust crosswind is not');
  assert.ok(o.flags & obs.FLAG_XW_GUST);
  assert.strictEqual(o.flags & obs.FLAG_XW, 0);
});

test('an airport with no runway data gets no components at all', () => {
  const raw = fixture('metar-krdu.json');
  raw.icaoId = 'K00U';
  const o = obs.build(raw, settings());
  assert.strictEqual(o.runway, null);
  assert.strictEqual(o.hw, null);
  assert.strictEqual(o.xw, null);
});

test('a variable wind gives a runway but no component figures', () => {
  const o = obs.build(fixture('metar-kase-vrb.json'), settings());
  assert.ok(o.runway, 'KASE has a runway and we can still draw the bar');
  assert.strictEqual(o.hw, null, 'VRB has no direction, so no component is computable');
});

test('the raw METAR is truncated to the AppMessage budget without corrupting it', () => {
  const raw = fixture('metar-krdu.json');
  raw.rawOb = 'X'.repeat(400);
  const o = obs.build(raw, settings());
  assert.ok(o.raw.length <= 167, o.raw.length);
});

test('a garbage report yields unknowns rather than throwing', () => {
  const o = obs.build({ icaoId: 'KXYZ' }, settings());
  assert.strictEqual(o.catOverall, cat.UNKNOWN);
  assert.strictEqual(o.visStr, '--');
  assert.strictEqual(o.windDir, obs.WIND_MISSING);
  assert.strictEqual(o.altimStr, '--');
});

test('an observation can summarise itself for the TAF strip NOW row', () => {
  const o = obs.build(fixture('metar-krdu.json'), settings());
  assert.strictEqual(obs.summaryText(o), '10SM 4700');
});

test('the summary stays inside the TAF text budget even at its longest', () => {
  const o = obs.build(fixture('metar-lifr.json'), settings());
  assert.strictEqual(obs.summaryText(o), '1/2SM VV300');
  assert.ok(obs.summaryText(o).length <= 15);
});

test('a summary of nothing is empty, not a pair of dashes', () => {
  assert.strictEqual(obs.summaryText(obs.build({ icaoId: 'KXYZ' }, settings())), '');
});

test('the NOW summary drops a whole value rather than clipping a ceiling', () => {
  const o = obs.build(fixture('metar-krdu.json'), settings());
  o.visStr = '1 1/2SM';
  o.cigStr = '25000';
  const s = obs.summaryText(o);
  assert.ok(s.length <= 15, s);
  assert.ok(s.indexOf('25000') >= 0, 'the ceiling must survive intact: ' + s);
});

test('a broken layer of unknown height is an unknown ceiling, not an unlimited one', () => {
  // "BKN///": the sky is broken and the height was not reported.  Skipping the
  // layer made this UNL and VFR.
  assert.strictEqual(obs.ceilingOf([{ cover: 'BKN', base: null }]).ft, undefined);
  const o = obs.build({ icaoId: 'KXXX', visib: '10+', clouds: [{ cover: 'OVC', base: null }] }, DEFAULTS);
  assert.strictEqual(o.cigStr, '--');
  assert.strictEqual(o.catCig, cat.UNKNOWN);
});

test('an unknown layer above a known ceiling does not hide it', () => {
  const c = obs.ceilingOf([{ cover: 'BKN', base: 800 }, { cover: 'OVC', base: null }]);
  assert.strictEqual(c.ft, 800);
});

test('an unknown layer below a known one makes the ceiling unknown', () => {
  const c = obs.ceilingOf([{ cover: 'BKN', base: null }, { cover: 'OVC', base: 2500 }]);
  assert.strictEqual(c.ft, undefined, '2,500 ft would overstate it');
});

test('a report too long for the watch is cut between groups and marked, never mid-group', () => {
  const long = 'SPECI KXXX 142230Z 24015G25KT 1/2SM R28L/2400VP6000FT +TSRAGS FG VV004 18/17 A2990 ' +
    'RMK AO2 PK WND 25032/2215 WSHFT 2205 TSB2158RAB2159GSB2205E2212UPB2201E2210 PRESRR SLP124 $';
  const raw = obs.fitRaw(long);
  assert.ok(raw.length <= obs.RAW_MAX, raw.length + ' > ' + obs.RAW_MAX);
  assert.match(raw, / \.\.\.$/, 'the cut is marked');
  const kept = raw.replace(/ \.\.\.$/, '').split(' ');
  const original = long.split(' ');
  kept.forEach((g, i) => assert.strictEqual(g, original[i], 'group ' + i + ' was clipped'));
});

test('a report that fits is passed through untouched', () => {
  const r = 'METAR KRDU 142151Z 31005G14KT 10SM FEW065 11/M04 A3006 RMK AO2 SLP179 T01111039';
  assert.strictEqual(obs.fitRaw(r), r);
  assert.strictEqual(obs.build({ icaoId: 'KRDU', rawOb: r }, DEFAULTS).raw, r);
});
