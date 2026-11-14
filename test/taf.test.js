'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const taf = require('../src/pkjs/lib/taf');
const cat = require('../src/pkjs/lib/category');

const fixture = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'))[0];

const NOW = 1788119460; // 2026-08-30T19:51Z, the time of the KRDU observation

test('the first row is NOW and carries the observed category, not a forecast one', () => {
  const f = taf.build(fixture('taf-krdu.json'), { periods: 4, now: NOW, nowCategory: cat.MVFR });
  assert.strictEqual(f.periods[0].label, 'NOW');
  assert.strictEqual(f.periods[0].category, cat.MVFR,
    'the colour column has to start from observed reality');
});

test('periods are labelled by their start hour in Zulu', () => {
  const f = taf.build(fixture('taf-krdu.json'), { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.deepStrictEqual(f.periods.map((p) => p.label), ['NOW', '20Z', '09Z', '13Z']);
});

test('period conditions read the way a pilot reads a TAF', () => {
  const f = taf.build(fixture('taf-krdu.json'), { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.periods[1].text, 'P6SM SCT040');
  assert.strictEqual(f.periods[2].text, '5SM BR SCT040');
});

test('period category comes from that period visibility and ceiling', () => {
  const f = taf.build(fixture('taf-krdu.json'), { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.periods[1].category, cat.VFR);
  assert.strictEqual(f.periods[2].category, cat.MVFR, '5 SM is MVFR');
});

test('the period count is configurable and never exceeds what the TAF has', () => {
  const two = taf.build(fixture('taf-krdu.json'), { periods: 2, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(two.periods.length, 2);
  const six = taf.build(fixture('taf-krdu.json'), { periods: 6, now: NOW, nowCategory: cat.VFR });
  assert.ok(six.periods.length <= 6);
});

test('elapsed periods are dropped, and so is one about to expire', () => {
  // The period in progress is worth a row -- what it forecasts can differ from
  // what is being observed -- but one with minutes left on it is just noise.
  const late = taf.build(fixture('taf-krdu.json'),
    { periods: 4, now: 1788170000, nowCategory: cat.VFR });
  assert.deepStrictEqual(late.periods.map((p) => p.label), ['NOW', '09Z', '13Z'],
    'the 09Z period still has three hours to run');
  const nearlyOver = taf.build(fixture('taf-krdu.json'),
    { periods: 4, now: 1788119460, nowCategory: cat.VFR });
  assert.ok(nearlyOver.periods.map((p) => p.label).indexOf('18Z') < 0,
    'the 18Z period expires in nine minutes and earns no row');
});

test('validity and issue strings fit their AppMessage budgets', () => {
  const f = taf.build(fixture('taf-krdu.json'), { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.issue, '301826Z');
  assert.strictEqual(f.valid, '3018Z-3118Z');
  assert.ok(f.valid.length <= 15);
  assert.ok(f.issue.length <= 7);
  for (const p of f.periods) {
    assert.ok(p.label.length <= 5, p.label);
    assert.ok(p.text.length <= 15, p.text);
  }
});

test('a TEMPO group is not a period: it rides inside its parent row', () => {
  const f = taf.build(fixture('taf-tempo.json'), { periods: 4, now: 1788115000, nowCategory: cat.VFR });
  const labels = f.periods.map((p) => p.label);
  assert.ok(labels.indexOf('20Z') < 0, 'the TEMPO start must not become a row of its own');
  assert.deepStrictEqual(labels, ['NOW', '18Z*', '04Z*', '14Z']);
});

test('a TEMPO carries its own category into the parent row', () => {
  const f = taf.build(fixture('taf-tempo.json'), { periods: 4, now: 1788115000, nowCategory: cat.VFR });
  assert.strictEqual(f.periods[1].category, cat.VFR, 'the parent period is VFR');
  assert.strictEqual(f.periods[1].tempoCategory, cat.IFR, 'but it TEMPOs to 4SM BR BKN008');
  assert.strictEqual(f.periods[2].category, cat.IFR, '2SM OVC008 is IFR');
  assert.strictEqual(f.periods[2].tempoCategory, cat.LIFR, 'PROB30 1/2SM VV002 is LIFR');
});

test('a period with no TEMPO says so with the "none" sentinel, not with a colour', () => {
  const f = taf.build(fixture('taf-krdu.json'), { periods: 4, now: NOW, nowCategory: cat.VFR });
  for (const p of f.periods) assert.strictEqual(p.tempoCategory, cat.UNKNOWN);
});

test('the asterisk is the accessible carrier of the TEMPO, not the inset bar', () => {
  const f = taf.build(fixture('taf-tempo.json'), { periods: 4, now: 1788115000, nowCategory: cat.VFR });
  for (const p of f.periods) {
    assert.strictEqual(/\*$/.test(p.label), p.tempoCategory !== cat.UNKNOWN, p.label);
  }
});

test('a TAF that failed to arrive degrades to an empty forecast, not a throw', () => {
  const f = taf.build(null, { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.periods.length, 1, 'NOW is still true even with no TAF');
  assert.strictEqual(f.valid, '');
});

test('the NOW row carries the observed conditions, not an empty cell', () => {
  const f = taf.build(fixture('taf-krdu.json'), {
    periods: 4, now: NOW, nowCategory: cat.VFR, nowText: '10SM 25000'
  });
  assert.strictEqual(f.periods[0].text, '10SM 25000');
});

test('the NOW row copes with an observation we do not have yet', () => {
  const f = taf.build(fixture('taf-krdu.json'), { periods: 4, now: NOW, nowCategory: cat.UNKNOWN });
  assert.strictEqual(f.periods[0].text, '');
});

test('the NOW row text is truncated to its AppMessage budget like any other', () => {
  const f = taf.build(fixture('taf-krdu.json'), {
    periods: 4, now: NOW, nowCategory: cat.VFR, nowText: 'X'.repeat(40)
  });
  assert.ok(f.periods[0].text.length <= 15);
});

test('a condition string too long for the budget drops a whole token, never a digit', () => {
  // "P6SM VCSH SCT020" is 16 bytes against a 15-byte field.  Truncating it
  // yields "P6SM VCSH SCT02", which a pilot reads as a 200 ft base rather than
  // 2,000 ft.  A clipped height is far worse than an omitted weather group.
  const f = taf.build({
    fcsts: [{ timeFrom: NOW + 3600, timeTo: NOW + 20000, visib: '6+', wxString: 'VCSH',
              clouds: [{ cover: 'SCT', base: 2000 }] }]
  }, { periods: 2, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.periods[1].text, 'P6SM SCT020');
});

test('no condition string ever ends in a partial cloud group', () => {
  const cases = [
    { visib: 1.5, wxString: '-SHRA BR FG', clouds: [{ cover: 'OVC', base: 300 }] },
    { visib: '6+', wxString: 'VCTS -RA BR', clouds: [{ cover: 'BKN', base: 25000 }] },
    { visib: 0.25, wxString: 'FZFG', clouds: [{ cover: 'OVC', base: 100 }] }
  ];
  for (const c of cases) {
    const f = taf.build({ fcsts: [Object.assign({ timeFrom: NOW + 3600, timeTo: NOW + 20000 }, c)] },
      { periods: 2, now: NOW, nowCategory: cat.VFR });
    const text = f.periods[1].text;
    assert.ok(text.length <= 15, text);
    const layer = /([A-Z]{2,3})(\d+)\s*$/.exec(text);
    if (layer) {
      assert.strictEqual(layer[2].length, 3,
        'cloud base must keep all three digits: ' + text);
    }
    assert.ok(!/\s$/.test(text), 'no trailing space: "' + text + '"');
  }
});

test('the cloud group survives even when the visibility has to go', () => {
  const f = taf.build({
    fcsts: [{ timeFrom: NOW + 3600, timeTo: NOW + 20000, visib: '1 1/2',
              wxString: '-SHRA BR SQ', clouds: [{ cover: 'OVC', base: 300 }] }]
  }, { periods: 2, now: NOW, nowCategory: cat.VFR });
  assert.ok(f.periods[1].text.indexOf('OVC003') >= 0, f.periods[1].text);
});

function tafWith(fcsts) {
  return { issueTime: '2026-08-30T18:00:00Z', validTimeFrom: NOW - 3600, validTimeTo: NOW + 86400, fcsts: fcsts };
}

test('a TEMPO that omits clouds and visibility inherits them from its period', () => {
  // "FM... 3SM BR OVC008 / TEMPO -TSRA": the TEMPO keeps the base's IFR sky.
  // Judged alone it had no visibility and no layer, and came out VFR.
  const f = taf.build(tafWith([
    { timeFrom: NOW - 600, timeTo: NOW + 6 * 3600, visib: 3, clouds: [{ cover: 'OVC', base: 800 }] },
    { timeFrom: NOW + 3600, timeTo: NOW + 3 * 3600, fcstChange: 'TEMPO', wxString: '-TSRA', clouds: [] }
  ]), { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.periods[1].tempoCategory, cat.IFR);
});

test('a TEMPO that changes only visibility still uses the period ceiling', () => {
  const f = taf.build(tafWith([
    { timeFrom: NOW - 600, timeTo: NOW + 6 * 3600, visib: '6+', clouds: [{ cover: 'BKN', base: 2000 }] },
    { timeFrom: NOW + 3600, timeTo: NOW + 3 * 3600, fcstChange: 'TEMPO', visib: 4, wxString: 'BR' }
  ]), { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.periods[1].tempoCategory, cat.MVFR, 'MVFR from both the 4SM and the BKN020');
});

test('a TEMPO that began in an earlier period and runs into this one is attached', () => {
  const f = taf.build(tafWith([
    { timeFrom: NOW - 7200, timeTo: NOW + 1800, visib: '6+', clouds: [] },
    { timeFrom: NOW + 1800, timeTo: NOW + 6 * 3600, fcstChange: 'FM', visib: '6+', clouds: [] },
    { timeFrom: NOW - 3600, timeTo: NOW + 3600, fcstChange: 'TEMPO', visib: 1, clouds: [{ cover: 'OVC', base: 400 }] }
  ]), { periods: 4, now: NOW, nowCategory: cat.VFR });
  const fm = f.periods.find((p) => p.from === NOW + 1800);
  assert.strictEqual(fm.tempoCategory, cat.LIFR, 'the TEMPO runs until an hour from now');
  assert.match(fm.label, /\*$/);
});

test('a TEMPO that has already ended marks nothing', () => {
  const f = taf.build(tafWith([
    { timeFrom: NOW - 7200, timeTo: NOW + 6 * 3600, visib: '6+', clouds: [] },
    { timeFrom: NOW - 7200, timeTo: NOW - 600, fcstChange: 'TEMPO', visib: 1, clouds: [{ cover: 'OVC', base: 400 }] }
  ]), { periods: 4, now: NOW, nowCategory: cat.VFR });
  assert.strictEqual(f.periods[1].tempoCategory, cat.UNKNOWN);
});
