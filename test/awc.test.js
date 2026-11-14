'use strict';
const test = require('node:test');
const assert = require('node:assert');
const awc = require('../src/pkjs/lib/awc');
const proto = require('../src/pkjs/lib/protocol');

const BASE = 'https://aviationweather.gov/api/data/';

test('URLs use only documented query parameters', () => {
  // The API rejects undocumented parameters outright, so the builders must not
  // invent any.
  const metar = awc.metarUrl(BASE, 'KRDU');
  assert.strictEqual(metar, BASE + 'metar?ids=KRDU&format=json');
  assert.strictEqual(awc.tafUrl(BASE, 'KRDU'), BASE + 'taf?ids=KRDU&format=json');
  assert.strictEqual(awc.areaUrl(BASE, '35.0,-79.0,36.0,-78.0'),
    BASE + 'metar?bbox=35.0%2C-79.0%2C36.0%2C-78.0&format=json');
});

test('station identifiers are encoded and upper-cased', () => {
  assert.strictEqual(awc.metarUrl(BASE, 'krdu'), BASE + 'metar?ids=KRDU&format=json');
});

function transport(response) {
  const calls = [];
  const t = function (url, headers, cb) {
    calls.push({ url: url, headers: headers });
    cb(response.err || null, response.status, response.body);
  };
  t.calls = calls;
  return t;
}

test('a custom User-Agent is always sent, because the API filters traffic without one', () => {
  const t = transport({ status: 200, body: '[]' });
  awc.fetchJson(t, 'https://example.com/x', function () {});
  assert.ok(/[Uu]ser-?[Aa]gent/.test(Object.keys(t.calls[0].headers).join(',')));
  assert.ok(t.calls[0].headers['User-Agent'].length > 0);
});

test('a 200 with data yields the parsed array', (t, done) => {
  awc.fetchJson(transport({ status: 200, body: '[{"icaoId":"KRDU"}]' }), 'u', function (err, data) {
    assert.strictEqual(err, null);
    assert.strictEqual(data[0].icaoId, 'KRDU');
    done();
  });
});

test('204 means the station reports nothing right now, which is not an error', (t, done) => {
  awc.fetchJson(transport({ status: 204, body: '' }), 'u', function (err) {
    assert.strictEqual(err, proto.ERR_NO_REPORT);
    done();
  });
});

test('an empty 200 array is the same "no report" case', (t, done) => {
  awc.fetchJson(transport({ status: 200, body: '[]' }), 'u', function (err) {
    assert.strictEqual(err, proto.ERR_NO_REPORT);
    done();
  });
});

test('rate limiting and server errors surface as an API error', (t, done) => {
  let seen = 0;
  for (const status of [429, 403, 500, 0]) {
    awc.fetchJson(transport({ status: status, body: '' }), 'u', function (err) {
      assert.strictEqual(err, proto.ERR_API, 'status ' + status);
      if (++seen === 4) done();
    });
  }
});

test('a body that is not JSON is an API error, not a crash', (t, done) => {
  awc.fetchJson(transport({ status: 200, body: '<html>bad gateway</html>' }), 'u', function (err) {
    assert.strictEqual(err, proto.ERR_API);
    done();
  });
});

test('a transport failure is an API error', (t, done) => {
  awc.fetchJson(transport({ err: new Error('offline'), status: 0, body: '' }), 'u', function (err) {
    assert.strictEqual(err, proto.ERR_API);
    done();
  });
});

test('the callback fires exactly once even if the transport is careless', (t, done) => {
  let n = 0;
  const twice = function (url, headers, cb) { cb(null, 200, '[{"a":1}]'); cb(null, 200, '[{"a":1}]'); };
  awc.fetchJson(twice, 'u', function () { n++; });
  setImmediate(function () { assert.strictEqual(n, 1); done(); });
});
