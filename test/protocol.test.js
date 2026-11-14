'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const proto = require('../src/pkjs/lib/protocol');
const obsLib = require('../src/pkjs/lib/observation');
const tafLib = require('../src/pkjs/lib/taf');
const cat = require('../src/pkjs/lib/category');

const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'))[0];
const S = {
  altimUnit: 'inhg', tempUnit: 'f', visUnit: 'sm', ceilUnit: 'ft', calmKt: 5,
  maxWindKt: 0, maxXwKt: 0, maxGustKt: 0, minCigFt: 0, minVisSm: 0
};

test('an observation becomes a flat dictionary of display-ready values', () => {
  const o = obsLib.build(fixture('metar-kbos-gust.json'), S);
  const d = proto.observationMessage(o, { isNearest: false });
  assert.strictEqual(d.STATION, 'KBOS');
  assert.strictEqual(d.IS_NEAREST, 0);
  assert.strictEqual(d.OBS_EPOCH, 1788119640);
  assert.strictEqual(d.WIND_DIR, 250);
  assert.strictEqual(d.WIND_SPD, 13);
  assert.strictEqual(d.WIND_GUST, 24);
  assert.strictEqual(d.CAT_OVERALL, cat.VFR);
  assert.strictEqual(d.ERROR, proto.ERR_NONE);
  assert.strictEqual(d.RWY_IDENT, '33L');
  assert.strictEqual(d.RWY_HDG_TRUE, 315);
  assert.strictEqual(d.RWY_LEN_FT, 10083);
  assert.strictEqual(d.HW, 5);
  assert.strictEqual(d.XW, 12);
  assert.strictEqual(d.XW_SIDE, proto.SIDE_LEFT);
});

test('every string field fits the buffer the watch allocated for it', () => {
  const budgets = {
    STATION: 4, VIS_STR: 7, CIG_STR: 7, ALTIM_STR: 7, TEMP_STR: 9,
    RWY_IDENT: 4, RAW: 167
  };
  for (const f of ['metar-krdu.json', 'metar-kbos-gust.json', 'metar-lifr.json',
                   'metar-kase-vrb.json', 'metar-clear.json']) {
    const d = proto.observationMessage(obsLib.build(fixture(f), S), {});
    for (const key in budgets) {
      assert.ok(d[key].length <= budgets[key], f + ' ' + key + '="' + d[key] + '"');
    }
  }
});

test('no runway data sends an empty ident, so the watch knows to draw no bar', () => {
  const raw = fixture('metar-krdu.json');
  raw.icaoId = 'K00U';
  const d = proto.observationMessage(obsLib.build(raw, S), {});
  assert.strictEqual(d.RWY_IDENT, '');
  assert.strictEqual(d.RWY_LEN_FT, 0);
  assert.strictEqual(d.XW_SIDE, proto.SIDE_NONE);
});

test('a known runway with an unusable wind draws the bar but sends no components', () => {
  const d = proto.observationMessage(obsLib.build(fixture('metar-kase-vrb.json'), S), {});
  assert.strictEqual(d.RWY_IDENT, '15');
  assert.strictEqual(d.XW_SIDE, proto.SIDE_NONE, 'VRB gives no component figure');
  assert.strictEqual(d.HW, 0);
});

test('the wind direction sentinels survive the trip as negative numbers', () => {
  assert.strictEqual(proto.observationMessage(obsLib.build(fixture('metar-krdu.json'), S), {}).WIND_DIR,
    obsLib.WIND_CALM);
  assert.strictEqual(proto.observationMessage(obsLib.build(fixture('metar-kase-vrb.json'), S), {}).WIND_DIR,
    obsLib.WIND_VRB);
  assert.strictEqual(proto.observationMessage(obsLib.build({ icaoId: 'KXYZ' }, S), {}).WIND_DIR,
    obsLib.WIND_MISSING);
});

test('components are clamped into the signed byte the protocol allots them', () => {
  const o = obsLib.build(fixture('metar-kbos-gust.json'), S);
  o.hw = -200; o.xw = 900;
  const d = proto.observationMessage(o, {});
  assert.strictEqual(d.HW, -128);
  assert.strictEqual(d.XW, 127);
});

test('unsigned fields never go negative on the wire', () => {
  const o = obsLib.build(fixture('metar-kbos-gust.json'), S);
  o.windSpd = -3; o.windGust = 400; o.runway.lengthFt = 99999;
  const d = proto.observationMessage(o, {});
  assert.strictEqual(d.WIND_SPD, 0);
  assert.strictEqual(d.WIND_GUST, 255);
  assert.strictEqual(d.RWY_LEN_FT, 65535);
});

test('an error state is a message in its own right, not a silent absence', () => {
  const d = proto.errorMessage('KRDU', proto.ERR_NO_REPORT);
  assert.strictEqual(d.STATION, 'KRDU');
  assert.strictEqual(d.ERROR, proto.ERR_NO_REPORT);
});

test('the nearest flag rides with the observation so the header can say NRST', () => {
  const d = proto.observationMessage(obsLib.build(fixture('metar-krdu.json'), S), { isNearest: true });
  assert.strictEqual(d.IS_NEAREST, 1);
});

test('a TAF becomes indexed keys the watch can walk', () => {
  const f = tafLib.build(fixture('taf-krdu.json'),
    { periods: 4, now: 1788119460, nowCategory: cat.VFR });
  const d = proto.tafMessage(f);
  assert.strictEqual(d.TAF_COUNT, 4);
  assert.strictEqual(d.TAF_ISSUE, '301826Z');
  assert.strictEqual(d.TAF_VALID, '3018Z-3118Z');
  assert.strictEqual(d.TAF_TIME_0, 'NOW');
  assert.strictEqual(d.TAF_CAT_0, cat.VFR);
  assert.strictEqual(d.TAF_TIME_1, '20Z');
  assert.strictEqual(d.TAF_TEXT_1, 'P6SM SCT040');
  assert.strictEqual(d.TAF_TEMPO_CAT_1, cat.UNKNOWN, '4 is the "no TEMPO" sentinel');
});

test('the TAF message never sends more periods than the protocol has keys for', () => {
  const f = tafLib.build(fixture('taf-krdu.json'),
    { periods: 20, now: 1788119460, nowCategory: cat.VFR });
  const d = proto.tafMessage(f);
  assert.ok(d.TAF_COUNT <= proto.MAX_TAF_PERIODS);
  assert.strictEqual(d['TAF_TIME_' + proto.MAX_TAF_PERIODS], undefined);
});

test('TAF strings fit their buffers too', () => {
  const f = tafLib.build(fixture('taf-tempo.json'),
    { periods: 6, now: 1788115000, nowCategory: cat.LIFR });
  const d = proto.tafMessage(f);
  assert.ok(d.TAF_VALID.length <= 15);
  assert.ok(d.TAF_ISSUE.length <= 7);
  for (let i = 0; i < d.TAF_COUNT; i++) {
    assert.ok(d['TAF_TIME_' + i].length <= 5, d['TAF_TIME_' + i]);
    assert.ok(d['TAF_TEXT_' + i].length <= 15, d['TAF_TEXT_' + i]);
  }
});

test('settings reach the watch so it can render before the first fetch lands', () => {
  const d = proto.settingsMessage({
    staleAmberMin: 45, staleRedMin: 75, startPage: 1, showRawPage: false,
    tafPeriods: 4, flickNearest: true, backlightOnFlick: true, vibeOnCatChange: false,
    stations: ['KRDU', 'KTTA']
  });
  assert.strictEqual(d.SET_STALE_AMBER, 45);
  assert.strictEqual(d.SET_STALE_RED, 75);
  assert.strictEqual(d.SET_START_PAGE, 1);
  assert.strictEqual(d.SET_SHOW_RAW, 0);
  assert.strictEqual(d.SET_FLICK_NEAREST, 1);
  assert.strictEqual(d.SET_STATION_COUNT, 2);
});

test('a forecast message names its station, and a status message is the mask alone', () => {
  const d = proto.tafMessage({ periods: [], valid: '', issue: '' }, 'KRDU');
  assert.strictEqual(d.TAF_STATION, 'KRDU');
  assert.strictEqual(d.ERROR, proto.ERR_NONE);
  assert.deepStrictEqual(proto.statusMessage(proto.BUSY_OBS | proto.BUSY_TAF), { STATUS: 3 });
});

test('the busy bits are distinct', () => {
  const bits = [proto.BUSY_OBS, proto.BUSY_TAF, proto.BUSY_NEAREST];
  assert.strictEqual(bits.reduce((a, b) => a | b, 0), 7);
});
