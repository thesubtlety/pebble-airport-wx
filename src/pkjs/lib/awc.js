'use strict';

/*
 * The Aviation Weather Center client.
 *
 * Constraints this file exists to respect, all of them from the AWC's own API
 * documentation:
 *
 *  - Undocumented query parameters are rejected outright, so the URL builders
 *    below use only ids, bbox and format and nothing else.
 *  - A custom User-Agent is required or automated filtering may block
 *    otherwise-valid traffic.
 *  - HTTP 204 is a valid request with no data.  That is "this station is not
 *    reporting", which the display treats very differently from a failure.
 *  - The rate limit is 100 requests per minute and exceeding it gets access
 *    blocked, so callers batch and back off rather than retrying tightly.
 */

var proto = require('./protocol');

var USER_AGENT = 'AirportWx/1.0 (Pebble watchapp)';

function query(params) {
  var parts = [];
  for (var i = 0; i < params.length; i++) {
    parts.push(encodeURIComponent(params[i][0]) + '=' + encodeURIComponent(params[i][1]));
  }
  return parts.join('&');
}

function metarUrl(base, ids) {
  return base + 'metar?' + query([['ids', String(ids).toUpperCase()], ['format', 'json']]);
}

function tafUrl(base, ids) {
  return base + 'taf?' + query([['ids', String(ids).toUpperCase()], ['format', 'json']]);
}

function areaUrl(base, bbox) {
  return base + 'metar?' + query([['bbox', bbox], ['format', 'json']]);
}

/**
 * @param {function} transport  (url, headers, cb(err, status, body)).  Injected
 *   so the mapping below can be tested without a network or an XHR.
 * @param {function} cb  (errorEnum|null, data)
 */
function fetchJson(transport, url, cb) {
  var done = false;
  function finish(err, data) {
    if (done) return;
    done = true;
    cb(err, data);
  }

  transport(url, { 'User-Agent': USER_AGENT }, function (err, status, body) {
    if (err) return finish(proto.ERR_API, null);
    if (status === 204) return finish(proto.ERR_NO_REPORT, null);
    if (status < 200 || status >= 300) return finish(proto.ERR_API, null);

    var data;
    try {
      data = JSON.parse(body);
    } catch (e) {
      return finish(proto.ERR_API, null);
    }
    if (!data || !data.length) return finish(proto.ERR_NO_REPORT, null);
    finish(null, data);
  });
}

module.exports = {
  USER_AGENT: USER_AGENT,
  metarUrl: metarUrl,
  tafUrl: tafUrl,
  areaUrl: areaUrl,
  fetchJson: fetchJson
};
