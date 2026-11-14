#!/usr/bin/env node
/**
 * The network spike from the specification's build order, step 1.
 *
 * It makes exactly the requests the app makes and prints what came back, so
 * that "does this endpoint still behave the way the code assumes" is one
 * command rather than an afternoon.  Run it against the AWC directly, or
 * against a proxy:
 *
 *   node tools/spike-fetch.mjs
 *   node tools/spike-fetch.mjs https://wx.example.com/api/data/
 *
 * Note what this does NOT prove.  It runs in Node, not in the phone's
 * JavaScript engine, so it says nothing about whether PebbleKit JS is subject
 * to browser CORS enforcement.  What it does prove
 * is that the endpoint is reachable, needs no credentials, and still sends the
 * field shapes the parser expects.
 */

const base = (process.argv[2] || 'https://aviationweather.gov/api/data/').replace(/\/?$/, '/');
const UA = 'AirportWx/1.0 (spike)';

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const body = res.status === 204 ? '' : await res.text();
  return { status: res.status, body };
}

function check(label, ok, detail) {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  -- ' + detail : ''}`);
  return ok;
}

const results = [];

{
  const { status, body } = await get(base + 'metar?ids=KRDU&format=json');
  const m = status === 200 ? JSON.parse(body)[0] : null;
  results.push(check('METAR fetch', status === 200 && !!m, 'HTTP ' + status));
  if (m) {
    results.push(check('altim is hectopascals, not inHg',
      typeof m.altim === 'number' && m.altim > 800 && m.altim < 1100, String(m.altim)));
    results.push(check('visib may be a string', ['string', 'number'].includes(typeof m.visib),
      JSON.stringify(m.visib)));
    results.push(check('obsTime is epoch seconds',
      typeof m.obsTime === 'number' && m.obsTime > 1e9, String(m.obsTime)));
    results.push(check('clouds[] present', Array.isArray(m.clouds), JSON.stringify(m.clouds)));
    results.push(check('rawOb fits the 167-byte budget',
      typeof m.rawOb === 'string' && m.rawOb.length <= 167, m.rawOb.length + ' bytes'));
  }
}

{
  const { status, body } = await get(base + 'taf?ids=KRDU&format=json');
  const t = status === 200 ? JSON.parse(body)[0] : null;
  results.push(check('TAF fetch', status === 200 && Array.isArray(t && t.fcsts),
    'HTTP ' + status + (t ? ', ' + t.fcsts.length + ' periods' : '')));
}

{
  const { status, body } = await get(base + 'metar?bbox=35.5,-79.3,36.3,-78.3&format=json');
  const list = status === 200 ? JSON.parse(body) : [];
  results.push(check('bbox area query', status === 200 && list.length > 0,
    'HTTP ' + status + ', ' + list.length + ' stations'));
}

{
  const { status } = await get(base + 'metar?ids=KZZZZ&format=json');
  results.push(check('unknown station gives 204, not an error', status === 204, 'HTTP ' + status));
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed against ${base}`);
process.exit(failed ? 1 : 0);
