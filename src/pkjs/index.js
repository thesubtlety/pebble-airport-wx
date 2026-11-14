'use strict';

/*
 * PebbleKit JS entry point.
 *
 * This file is deliberately thin: it supplies the real network, clock,
 * geolocation and AppMessage implementations to the controller, which holds
 * all of the behaviour and all of the tests.  If you are looking for logic,
 * it is in lib/.
 */

var Clay = require('pebble-clay');
var clayConfig = require('./config');
var customClay = require('./config/custom-clay');
var Controller = require('./lib/controller');
var awc = require('./lib/awc');
var proto = require('./lib/protocol');

var clay = new Clay(clayConfig, customClay, { autoHandleEvents: false });

var STORAGE_KEY = 'avwx-settings';
var TICK_MS = 30 * 1000;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    console.log('avwx: could not persist settings: ' + e);
  }
}

/*
 * XMLHttpRequest, not fetch: PebbleKit JS runs in an embedded JavaScript
 * engine rather than a browser page, and XHR is the documented transport.
 *
 * The AWC documentation states that cross-origin resource sharing is not
 * permitted.  Historically PKJS was not subject to browser CORS enforcement,
 * and the request works from any non-browser client -- but whether it works
 * from inside the current mobile app is the one thing that cannot be settled
 * off-device.  If it does not, set a proxy base in Settings and nothing else
 * about the app changes (see docs/INSTALL.md, "If it cannot fetch").
 */
function transport(url, headers, cb) {
  var xhr = new XMLHttpRequest();
  var finished = false;

  function finish(err, status, body) {
    if (finished) return;
    finished = true;
    cb(err, status, body);
  }

  try {
    xhr.open('GET', url, true);
    for (var h in headers) {
      if (headers.hasOwnProperty(h)) xhr.setRequestHeader(h, headers[h]);
    }
  } catch (e) {
    return finish(e, 0, '');
  }

  xhr.timeout = 15000;
  xhr.onload = function () { finish(null, xhr.status, xhr.responseText); };
  xhr.onerror = function () { finish(new Error('network'), xhr.status || 0, ''); };
  xhr.ontimeout = function () { finish(new Error('timeout'), 0, ''); };

  try {
    xhr.send();
  } catch (e2) {
    finish(e2, 0, '');
  }
}

var controller = new Controller({
  send: function (dict) {
    Pebble.sendAppMessage(dict, null, function (err) {
      console.log('avwx: AppMessage rejected: ' + JSON.stringify(err));
    });
  },
  now: function () {
    return Math.floor(Date.now() / 1000);
  },
  fetchJson: function (url, cb) {
    awc.fetchJson(transport, url, function (err, data) {
      /* A 204 is an answer, not a failure.  Anything else is worth a line in
       * `pebble logs`, which is otherwise silent about why a page says DATA
       * UNAVAILABLE. */
      if (err && err !== proto.ERR_NO_REPORT) {
        console.log('avwx: request failed (error ' + err + '): ' + url);
      }
      cb(err, data);
    });
  },
  geolocate: function (cb) {
    if (!navigator.geolocation) return cb(new Error('unavailable'));
    navigator.geolocation.getCurrentPosition(
      function (pos) { cb(null, { lat: pos.coords.latitude, lon: pos.coords.longitude }); },
      function (err) { cb(err || new Error('denied')); },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
    );
  }
});

controller.setSettings(loadSettings());

var refreshTimer = null;

function armRefreshTimer() {
  if (refreshTimer) clearInterval(refreshTimer);
  /* PebbleKit JS for a watchapp only runs while the app is open, so this is a
   * while-open refresh however it is configured.  refreshOnOpen simply decides
   * whether it also ticks after the initial fetch. */
  if (controller.settings.refreshOnOpen) return;
  refreshTimer = setInterval(function () {
    controller.refresh();
  }, controller.settings.refreshMin * 60 * 1000);
}

Pebble.addEventListener('ready', function () {
  controller.pushSettings();
  controller.start();
  armRefreshTimer();
  setInterval(function () { controller.tick(); }, TICK_MS);
});

Pebble.addEventListener('appmessage', function (e) {
  var d = e.payload || {};
  if (d.REQ_FETCH !== undefined) controller.refresh();
  if (d.REQ_TAF !== undefined) controller.requestTaf();
  if (d.REQ_NEAREST !== undefined) controller.requestNearest();
  if (d.REQ_STATION_INDEX !== undefined) controller.cycle(d.REQ_STATION_INDEX);
});

Pebble.addEventListener('showConfiguration', function () {
  Pebble.openURL(clay.generateUrl());
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) return;
  var raw = clay.getSettings(e.response, false);
  saveSettings(raw);
  controller.setSettings(raw);
  controller.pushSettings();
  armRefreshTimer();
  controller.start();
});
