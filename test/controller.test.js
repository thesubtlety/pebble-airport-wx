'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Controller = require('../src/pkjs/lib/controller');
const proto = require('../src/pkjs/lib/protocol');

const raw = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
const NOW = 1788119500;

/* What the watch was sent, leaving out the bare STATUS messages that announce
 * work starting -- the tests below are about results. */
const isStatusOnly = (d) => Object.keys(d).length === 1 && d.STATUS !== undefined;
const out = (h) => h.sent.filter((d) => !isStatusOnly(d));
/* A fixture re-labelled as another station, for tests that only need its weather. */
const as = (station, n) => raw(n).map((m) => Object.assign({}, m, { icaoId: station }));

function harness(over) {
  const sent = [];
  const fetches = [];
  const h = {
    sent: sent,
    fetches: fetches,
    now: NOW,
    responses: {},
    geo: { lat: 35.8923, lon: -78.782 },
    geoError: null
  };
  const deps = {
    send: (d) => sent.push(d),
    now: () => h.now,
    fetchJson: (url, cb) => {
      fetches.push(url);
      const key = Object.keys(h.responses).find((k) => url.indexOf(k) >= 0);
      const r = key ? h.responses[key] : { err: proto.ERR_API };
      cb(r.err || null, r.data || null);
    },
    geolocate: (cb) => (h.geoError ? cb(h.geoError) : cb(null, h.geo))
  };
  h.c = new Controller(Object.assign(deps, over || {}));
  h.c.setSettings({ homeStation: 'KRDU', stations: ['KBOS', 'KASE'] });
  return h;
}

test('a refresh fetches the current station and sends what it got', () => {
  const h = harness();
  h.responses['ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.c.refresh();
  assert.strictEqual(h.fetches.length, 1);
  assert.match(h.fetches[0], /metar\?ids=KRDU&format=json$/);
  assert.strictEqual(out(h).length, 1);
  assert.strictEqual(out(h)[0].STATION, 'KRDU');
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NONE);
});

test('a station that is not reporting sends the state, not silence', () => {
  const h = harness();
  h.responses['ids=KRDU'] = { err: proto.ERR_NO_REPORT };
  h.c.refresh();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NO_REPORT);
  assert.strictEqual(out(h)[0].STATION, 'KRDU', 'the header still names the station being shown');
});

test('an API failure is reported as one', () => {
  const h = harness();
  h.responses['ids=KRDU'] = { err: proto.ERR_API };
  h.c.refresh();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_API);
});

test('Up and Down cycle the configured stations and wrap', () => {
  const h = harness();
  h.responses['ids='] = { data: raw('metar-krdu.json') };
  assert.strictEqual(h.c.currentStation(), 'KRDU');
  h.c.cycle(1); assert.strictEqual(h.c.currentStation(), 'KBOS');
  h.c.cycle(1); assert.strictEqual(h.c.currentStation(), 'KASE');
  h.c.cycle(1); assert.strictEqual(h.c.currentStation(), 'KRDU');
  h.c.cycle(-1); assert.strictEqual(h.c.currentStation(), 'KASE');
});

test('cycling fetches the station it moved to', () => {
  const h = harness();
  h.responses['ids=KBOS'] = { data: raw('metar-kbos-gust.json') };
  h.c.cycle(1);
  assert.strictEqual(h.sent[h.sent.length - 1].STATION, 'KBOS');
});

test('cycling away from a nearest station returns to the pinned list', () => {
  const h = harness();
  h.geo = { lat: 42.36, lon: -71.01 }; // standing at Logan, home is KRDU
  h.responses['bbox'] = { data: raw('metar-kbos-gust.json') };
  h.responses['metar?ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.c.requestNearest();
  assert.strictEqual(h.c.isNearest(), true);
  h.c.cycle(1);
  assert.strictEqual(h.c.isNearest(), false);
});

test('the TAF is fetched only when the TAF page asks for it', () => {
  const h = harness();
  h.responses['metar?ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.c.refresh();
  assert.ok(!h.fetches.some((u) => u.indexOf('taf?') >= 0), 'a refresh alone must not fetch a TAF');
  h.responses['taf?ids=KRDU'] = { data: raw('taf-krdu.json') };
  h.c.requestTaf();
  assert.ok(h.fetches.some((u) => u.indexOf('taf?ids=KRDU') >= 0));
  const taf = h.sent[h.sent.length - 1];
  assert.strictEqual(taf.TAF_COUNT, 4);
  assert.strictEqual(taf.TAF_TIME_0, 'NOW');
});

test('the NOW row of the TAF carries the observed category', () => {
  const h = harness();
  h.responses['metar?ids=KRDU'] = { data: as('KRDU', 'metar-ifr-vis-mvfr-cig.json') };
  h.responses['taf?ids=KRDU'] = { data: raw('taf-krdu.json') };
  h.c.refresh();
  h.c.requestTaf();
  const taf = h.sent[h.sent.length - 1];
  assert.strictEqual(taf.TAF_CAT_0, 2, 'the observation is IFR, so the strip starts IFR');
});

test('a nearest lookup area-queries around the fix and sends the closest station', () => {
  const h = harness();
  h.responses['bbox'] = { data: raw('metar-krdu.json') };
  h.c.requestNearest();
  assert.ok(h.fetches[0].indexOf('bbox=') >= 0, h.fetches[0]);
  assert.strictEqual(out(h)[0].IS_NEAREST, 1);
  assert.strictEqual(out(h)[0].STATION, 'KRDU');
});

test('the NRST station is whichever is closest, not whichever the API listed first', () => {
  const h = harness();
  const far = JSON.parse(JSON.stringify(raw('metar-kbos-gust.json')));
  far[0].lat = 36.5; far[0].lon = -78.9; far[0].obsTime = NOW - 300;
  const near = JSON.parse(JSON.stringify(raw('metar-krdu.json')));
  near[0].obsTime = NOW - 300;
  h.responses['bbox'] = { data: far.concat(near) };
  h.c.requestNearest();
  assert.strictEqual(out(h)[0].STATION, 'KRDU');
});

test('a denied or timed-out fix says NO GPS and leaves the station alone', () => {
  const h = harness();
  h.geoError = new Error('denied');
  h.c.requestNearest();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NO_GPS);
  assert.strictEqual(h.c.isNearest(), false);
  assert.strictEqual(h.c.currentStation(), 'KRDU');
});

test('nothing reporting inside the radius says so rather than reaching further', () => {
  const h = harness();
  const stale = JSON.parse(JSON.stringify(raw('metar-krdu.json')));
  stale[0].obsTime = NOW - 20000;
  h.responses['bbox'] = { data: stale };
  h.c.requestNearest();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NO_STATION);
  assert.strictEqual(h.c.isNearest(), false);
});

test('the nearest station reverts to home after the configured interval', () => {
  const h = harness();
  h.geo = { lat: 42.36, lon: -71.01 };
  h.responses['bbox'] = { data: raw('metar-kbos-gust.json') };
  h.responses['metar?ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.c.requestNearest();
  assert.strictEqual(h.c.isNearest(), true);

  h.now = NOW + 9 * 60;
  h.c.tick();
  assert.strictEqual(h.c.isNearest(), true, 'nine minutes is inside the ten-minute window');

  h.now = NOW + 11 * 60;
  h.c.tick();
  assert.strictEqual(h.c.isNearest(), false);
  assert.strictEqual(h.sent[h.sent.length - 1].STATION, 'KRDU');
});

test('a revert interval of zero means never revert', () => {
  const h = harness();
  h.geo = { lat: 42.36, lon: -71.01 };
  h.c.setSettings({ homeStation: 'KRDU', nearestRevertMin: 0 });
  h.responses['bbox'] = { data: raw('metar-kbos-gust.json') };
  h.c.requestNearest();
  h.now = NOW + 24 * 3600;
  h.c.tick();
  assert.strictEqual(h.c.isNearest(), true);
});

test('settings changes reach the watch immediately, before any fetch', () => {
  const h = harness();
  h.c.setSettings({ homeStation: 'KRDU', staleAmberMin: 30, staleRedMin: 60 });
  h.c.pushSettings();
  const s = h.sent[h.sent.length - 1];
  assert.strictEqual(s.SET_STALE_AMBER, 30);
  assert.strictEqual(s.SET_STALE_RED, 60);
});

test('a refresh while one is already in flight does not stack requests', () => {
  let pending = null;
  const h = harness({ fetchJson: (url, cb) => { pending = cb; } });
  h.c.refresh();
  h.c.refresh();
  h.c.refresh();
  assert.strictEqual(h.c.inFlight(), true);
  pending(proto.ERR_API, null);
  assert.strictEqual(h.c.inFlight(), false);
});

test('cycling twice quickly still fetches the station it landed on', () => {
  // Pressing Down twice before the first fetch returns must not leave the
  // display on the first station while the index has moved past it: the
  // header would then be naming an airport the reading did not come from.
  const pending = [];
  const h = harness({ fetchJson: (url, cb) => pending.push({ url: url, cb: cb }) });
  h.c.cycle(1);
  h.c.cycle(1);
  assert.strictEqual(h.c.currentStation(), 'KASE');
  assert.ok(pending.some((p) => p.url.indexOf('ids=KASE') >= 0),
    'the station now selected was never requested: ' + pending.map((p) => p.url).join(', '));
});

test('a slow response for an abandoned station does not overwrite a newer one', () => {
  const pending = [];
  const h = harness({ fetchJson: (url, cb) => pending.push({ url: url, cb: cb }) });
  h.c.cycle(1);   // KBOS
  h.c.cycle(1);   // KASE
  // KASE answers first, then the abandoned KBOS request finally lands.
  pending[1].cb(null, raw('metar-kase-vrb.json'));
  pending[0].cb(null, raw('metar-kbos-gust.json'));
  assert.strictEqual(h.sent[h.sent.length - 1].STATION, 'KASE',
    'the stale KBOS response must be discarded, not drawn');
});

test('repeated refreshes of the same station still do not stack', () => {
  const pending = [];
  const h = harness({ fetchJson: (url, cb) => pending.push({ url: url, cb: cb }) });
  h.c.refresh();
  h.c.refresh();
  h.c.refresh();
  assert.strictEqual(pending.length, 1);
});

test('a new observation refreshes the NOW row without spending another request', () => {
  const h = harness();
  h.responses['metar?ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.responses['taf?ids=KRDU'] = { data: raw('taf-krdu.json') };

  // The TAF page can be opened before the first observation lands.
  h.c.requestTaf();
  assert.strictEqual(h.sent[h.sent.length - 1].TAF_CAT_0, 4, 'nothing observed yet');

  const fetchesBefore = h.fetches.length;
  h.c.refresh();
  const taf = h.sent.filter((d) => d.TAF_COUNT !== undefined).pop();
  assert.strictEqual(taf.TAF_CAT_0, 0, 'the NOW row now carries the observed category');
  assert.strictEqual(taf.TAF_TEXT_0, '10SM 4700');
  assert.strictEqual(h.fetches.length, fetchesBefore + 1,
    'rebuilding the strip must not cost a second TAF request');
});

test('a cached TAF is not reused for a different station', () => {
  const h = harness();
  h.responses['taf?ids=KRDU'] = { data: raw('taf-krdu.json') };
  h.responses['metar?ids=KBOS'] = { data: raw('metar-kbos-gust.json') };
  h.c.requestTaf();
  const tafCount = h.sent.filter((d) => d.TAF_COUNT !== undefined).length;
  h.c.cycle(1); // to KBOS
  assert.strictEqual(h.sent.filter((d) => d.TAF_COUNT !== undefined).length, tafCount,
    'KRDU forecast must not be redrawn under a KBOS observation');
});

test('with no airport set, the app shows the nearest reporting station', () => {
  // A first run has no airport.  Rather than an empty page, show the weather
  // where the user is.
  const h = harness();
  h.c.setSettings({});
  h.responses['bbox'] = { data: raw('metar-krdu.json') };
  h.c.start();
  assert.ok(h.fetches[0].indexOf('bbox=') >= 0, h.fetches[0]);
  assert.strictEqual(out(h)[0].STATION, 'KRDU');
  assert.strictEqual(out(h)[0].IS_NEAREST, 1);
});

test('a refresh with no airport set also looks up the nearest station', () => {
  const h = harness();
  h.c.setSettings({});
  h.responses['bbox'] = { data: raw('metar-krdu.json') };
  h.c.refresh();
  assert.ok(h.fetches[0].indexOf('bbox=') >= 0);
  assert.notStrictEqual(out(h)[0].ERROR, proto.ERR_NOT_CONFIGURED);
});

test('with no airport set, a failed lookup is the state of the page, not a toast', () => {
  const h = harness();
  h.c.setSettings({});
  h.geoError = new Error('denied');
  h.c.start();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NO_GPS);
  assert.strictEqual(out(h)[0].IS_NEAREST, undefined,
    'there is no airport to fall back on, so the watch must show this on the page');
});

test('"always nearest" opens on the nearest station even with airports set', () => {
  const h = harness();
  h.c.setSettings({ homeStation: 'KRDU', alwaysNearest: true });
  h.geo = { lat: 42.36, lon: -71.01 };
  h.responses['bbox'] = { data: raw('metar-kbos-gust.json') };
  h.c.start();
  assert.strictEqual(h.c.currentStation(), 'KBOS');
  assert.strictEqual(out(h)[0].IS_NEAREST, 1);
});

test('"always nearest" falls back to the home airport when the lookup fails', () => {
  const h = harness();
  h.c.setSettings({ homeStation: 'KRDU', alwaysNearest: true });
  h.geoError = new Error('timeout');
  h.responses['metar?ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.c.start();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NO_GPS);
  assert.strictEqual(out(h)[0].IS_NEAREST, 1, 'a toast: there is a reading to show');
  assert.strictEqual(out(h)[1].STATION, 'KRDU', 'and the reading is the home airport');
});

test('a followed nearest station is located again on refresh, and never reverts', () => {
  const h = harness();
  h.c.setSettings({ homeStation: 'KRDU', alwaysNearest: true });
  h.responses['bbox'] = { data: raw('metar-krdu.json') };
  h.c.start();
  const before = h.fetches.length;
  h.c.refresh();
  assert.ok(h.fetches[before].indexOf('bbox=') >= 0, 'the user may have moved');
  h.now = NOW + 3 * 3600;
  h.c.tick();
  assert.strictEqual(h.c.isNearest(), true, 'following nearest is the setting, not a detour');
});

test('Up and Down still reach the airports when "always nearest" is on', () => {
  const h = harness();
  h.c.setSettings({ homeStation: 'KRDU', station2: 'KBOS', alwaysNearest: true });
  h.responses['bbox'] = { data: raw('metar-kase-vrb.json') };
  h.responses['metar?ids=KBOS'] = { data: raw('metar-kbos-gust.json') };
  h.c.start();
  h.c.cycle(1);
  assert.strictEqual(h.c.currentStation(), 'KBOS');
  assert.strictEqual(h.c.isNearest(), false);
});

test('setting an airport moves the app off the nearest station it was following', () => {
  const h = harness();
  h.c.setSettings({});
  h.geo = { lat: 42.36, lon: -71.01 };
  h.responses['bbox'] = { data: raw('metar-kbos-gust.json') };
  h.c.start();
  assert.strictEqual(h.c.isNearest(), true);
  h.c.setSettings({ homeStation: 'KRDU' });
  h.responses['metar?ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.c.start();
  assert.strictEqual(h.c.currentStation(), 'KRDU');
  assert.strictEqual(out(h).pop().STATION, 'KRDU');
});

test('the not-configured state is distinct from a station that is not reporting', () => {
  assert.notStrictEqual(proto.ERR_NOT_CONFIGURED, proto.ERR_NO_REPORT);
  const h = harness();
  h.responses['metar?ids=KRDU'] = { err: proto.ERR_NO_REPORT };
  h.c.refresh();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NO_REPORT);
});

/* ---- the loading indicator ------------------------------------------------ */

test('a refresh tells the watch it has started, and the result takes that back', () => {
  let pending = null;
  const h = harness({ fetchJson: (url, cb) => { pending = cb; } });
  h.c.refresh();
  assert.deepStrictEqual(h.sent[0], { STATUS: proto.BUSY_OBS }, 'the indicator goes up before the network answers');
  pending(null, raw('metar-krdu.json'));
  const result = h.sent[h.sent.length - 1];
  assert.strictEqual(result.STATION, 'KRDU');
  assert.strictEqual(result.STATUS, 0, 'the result itself clears the indicator');
});

test('a failed refresh clears the indicator too', () => {
  const h = harness();
  h.responses['ids=KRDU'] = { err: proto.ERR_API };
  h.c.refresh();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_API);
  assert.strictEqual(out(h)[0].STATUS, 0);
});

test('the start is announced once, not once per request', () => {
  const h = harness({ fetchJson: () => {} });
  h.c.refresh();
  h.c.refresh();
  assert.strictEqual(h.sent.filter(isStatusOnly).length, 1);
});

test('overlapping work keeps the indicator up until the last of it finishes', () => {
  const pending = {};
  const h = harness({ fetchJson: (url, cb) => { pending[url.indexOf('taf?') >= 0 ? 'taf' : 'metar'] = cb; } });
  h.c.refresh();
  h.c.requestTaf();
  assert.deepStrictEqual(h.sent[h.sent.length - 1], { STATUS: proto.BUSY_OBS | proto.BUSY_TAF });
  pending.metar(null, raw('metar-krdu.json'));
  assert.strictEqual(h.sent[h.sent.length - 1].STATUS, proto.BUSY_TAF, 'the forecast is still coming');
  pending.taf(null, raw('taf-krdu.json'));
  assert.strictEqual(h.sent[h.sent.length - 1].STATUS, 0);
});

test('a nearest lookup shows as busy until it lands', () => {
  let geoCb = null;
  const h = harness({ geolocate: (cb) => { geoCb = cb; } });
  h.c.requestNearest();
  assert.deepStrictEqual(h.sent[0], { STATUS: proto.BUSY_NEAREST });
  geoCb(new Error('timeout'));
  assert.strictEqual(h.sent[h.sent.length - 1].STATUS, 0);
});

test('a second nearest request while one is in flight does not start another', () => {
  let calls = 0;
  const h = harness({ geolocate: () => { calls++; } });
  h.c.requestNearest();
  h.c.requestNearest();
  assert.strictEqual(calls, 1);
  assert.strictEqual(h.sent[h.sent.length - 1].STATUS, proto.BUSY_NEAREST,
    'the watch is still told it is busy, so its own indicator does not time out early');
});

test('a nearest lookup that never answered does not block the next one forever', () => {
  let calls = 0;
  const h = harness({ geolocate: () => { calls++; } });
  h.c.requestNearest();
  h.now = NOW + 120;
  h.c.requestNearest();
  assert.strictEqual(calls, 2);
});

test('cycling with nothing pinned leaves a nearest station alone and answers the watch', () => {
  const h = harness();
  h.c.setSettings({});
  h.responses['bbox'] = { data: raw('metar-kbos-gust.json') };
  h.geo = { lat: 42.36, lon: -71.01 };
  h.c.requestNearest();
  assert.strictEqual(h.c.currentStation(), 'KBOS');
  const before = h.sent.length;
  h.c.cycle(1);
  assert.strictEqual(h.c.currentStation(), 'KBOS', 'there is nowhere else to go');
  assert.strictEqual(h.c.isNearest(), true);
  assert.deepStrictEqual(h.sent.slice(before), [{ STATUS: 0 }],
    'the watch put its indicator up when it asked, so it needs an answer');
});

/* ---- nearest failures --------------------------------------------------- */

test('a failed nearest lookup is marked as one, so it does not label the reading', () => {
  const h = harness();
  h.responses['bbox'] = { err: proto.ERR_API };
  h.c.requestNearest();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_API);
  assert.strictEqual(out(h)[0].IS_NEAREST, 1);
  assert.strictEqual(out(h)[0].STATION, 'KRDU', 'the station on screen is unchanged');
});

test('an ordinary fetch failure is not marked as a nearest failure', () => {
  const h = harness();
  h.responses['ids=KRDU'] = { err: proto.ERR_NO_REPORT };
  h.c.refresh();
  assert.strictEqual(out(h)[0].IS_NEAREST, undefined);
});

/* ---- forecasts ------------------------------------------------------------ */

test('the forecast says which station it is for', () => {
  const h = harness();
  h.responses['taf?ids=KRDU'] = { data: raw('taf-krdu.json') };
  h.c.requestTaf();
  assert.strictEqual(out(h)[0].TAF_STATION, 'KRDU');
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_NONE);
});

test('a forecast that lands after the user moved on is dropped, not drawn', () => {
  const pending = [];
  const h = harness({ fetchJson: (url, cb) => pending.push({ url: url, cb: cb }) });
  h.c.requestTaf();               // KRDU
  h.c.cycle(1);                   // now KBOS
  pending[0].cb(null, raw('taf-krdu.json'));
  assert.ok(!h.sent.some((d) => d.TAF_COUNT !== undefined),
    'the KRDU forecast must not reach a watch showing KBOS');
  assert.strictEqual(h.sent[h.sent.length - 1].STATUS, proto.BUSY_OBS,
    'and the indicator reflects what is still in flight');
});

test('a forecast fetch that fails says so, distinctly from "no TAF published"', () => {
  const h = harness();
  h.responses['taf?ids=KRDU'] = { err: proto.ERR_API };
  h.c.requestTaf();
  assert.strictEqual(out(h)[0].ERROR, proto.ERR_API);

  const h2 = harness();
  h2.responses['taf?ids=KRDU'] = { err: proto.ERR_NO_REPORT };
  h2.c.requestTaf();
  assert.strictEqual(out(h2)[0].ERROR, proto.ERR_NONE, 'a 204 is a real answer: no forecast');
  assert.strictEqual(out(h2)[0].TAF_COUNT, 1, 'only the NOW row');
});

test('a failed refetch keeps the forecast already held', () => {
  const h = harness();
  h.responses['taf?ids=KRDU'] = { data: raw('taf-krdu.json') };
  h.c.requestTaf();
  h.responses['taf?ids=KRDU'] = { err: proto.ERR_API };
  h.c.requestTaf();
  const last = out(h).pop();
  assert.strictEqual(last.ERROR, proto.ERR_NONE);
  assert.strictEqual(last.TAF_COUNT, 4, 'the cached forecast, not an empty strip');
});

test('the NOW row never takes its category from another station', () => {
  const h = harness();
  h.responses['metar?ids=KRDU'] = { data: raw('metar-krdu.json') };
  h.responses['taf?ids=KBOS'] = { data: raw('taf-tempo.json') };
  h.c.refresh();            // KRDU observed
  h.c.cycle(1);             // to KBOS; its METAR fails in this harness
  h.c.requestTaf();
  const taf = out(h).filter((d) => d.TAF_COUNT !== undefined).pop();
  assert.strictEqual(taf.TAF_STATION, 'KBOS');
  assert.strictEqual(taf.TAF_CAT_0, 4, 'nothing observed at KBOS yet, so NOW is unknown');
});
