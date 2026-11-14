'use strict';

/*
 * Access to the bundled runway table.
 *
 * The table is generated offline by tools/build-runway-table.mjs from
 * OurAirports data and shipped inside the app, so the wind page works with no
 * network at all and costs no extra request against the AWC rate limit.  The
 * generator's header (tools/build-runway-table.mjs) explains how the true
 * headings are established.
 */

var TABLE = require('./runway-table');

var index = null;

function build() {
  index = {};
  var lines = TABLE.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var parts = lines[i].split('|');
    if (parts.length < 2) continue;
    var rwys = [];
    for (var j = 1; j < parts.length; j++) {
      var f = parts[j].split(':');
      if (f.length !== 4) continue;
      rwys.push({ le: f[0], he: f[1], hdg: Number(f[2]), len: Number(f[3]) });
    }
    if (rwys.length) index[parts[0]] = rwys;
  }
  return index;
}

/** @return {?Array} Runways longest first, or null if we have no data. */
function lookup(icao) {
  if (!icao) return null;
  if (!index) build();
  var key = String(icao).trim().toUpperCase();
  return index[key] || null;
}

/** The whole table, keyed by ICAO.  Used by the tests and by nothing else. */
function all() {
  return index || build();
}

module.exports = { lookup: lookup, all: all };
