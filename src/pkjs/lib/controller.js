'use strict';

/*
 * The phone-side controller: what to fetch, when, and what to send.
 *
 * Every external thing it touches -- the network, geolocation, the clock,
 * AppMessage -- arrives as an injected dependency, so all of the behaviour
 * below is exercised in tests without a phone or a watch.  src/pkjs/index.js
 * is the thin layer that supplies the real ones.
 */

var awc = require('./awc');
var settingsLib = require('./settings');
var observation = require('./observation');
var tafLib = require('./taf');
var proto = require('./protocol');
var nearest = require('./nearest');

/* A report older than this is not a nearby station's weather, it is history. */
var NEAREST_MAX_AGE_S = 90 * 60;

/* A nearest lookup that has not answered in this long is assumed lost, so a
 * new one is allowed rather than refused forever. */
var NEAREST_STUCK_S = 60;

function Controller(deps) {
  this.deps = deps;
  this.settings = settingsLib.normalise({});
  this.stationIndex = 0;
  this.nearestStation = null;
  this.nearestSince = 0;
  this.lastObservation = null;
  /* The last TAF JSON, kept so the NOW row can be rebuilt against a fresh
   * observation without spending another request against the rate limit. */
  this.lastTaf = null;
  this.lastTafStation = null;
  this.pendingStation = null;
  /* Bumped on every request so a slow response for a station the user has
   * already moved off can be recognised and discarded. */
  this.requestSeq = 0;
  /* The same, for forecasts. */
  this.tafPending = null;
  this.tafSeq = 0;
  this.locating = false;
  this.locatingSince = 0;
  /* The busy mask the watch was last told, so a start is announced once. */
  this.lastStatus = 0;
}

Controller.prototype.now = function () {
  return this.deps.now ? this.deps.now() : Math.floor(Date.now() / 1000);
};

Controller.prototype.setSettings = function (rawSettings) {
  this.settings = settingsLib.normalise(rawSettings);
  if (this.stationIndex >= this.settings.stations.length) this.stationIndex = 0;
};

Controller.prototype.pushSettings = function () {
  this.send(proto.settingsMessage(this.settings));
};

/** What is in flight, as the STATUS bitmask the watch draws its indicator from. */
Controller.prototype.busyMask = function () {
  return (this.pendingStation !== null ? proto.BUSY_OBS : 0) |
         (this.tafPending !== null ? proto.BUSY_TAF : 0) |
         (this.locating ? proto.BUSY_NEAREST : 0);
};

/**
 * Every message carries the current busy mask.  Callers clear their in-flight
 * marker before sending a result, so the message that delivers the result is
 * also the one that takes the watch's loading indicator down -- no second
 * message, and no window in which the two can disagree.
 */
Controller.prototype.send = function (dict) {
  dict.STATUS = this.busyMask();
  this.lastStatus = dict.STATUS;
  this.deps.send(dict);
};

/** Tell the watch work has started, once per change rather than per request. */
Controller.prototype.announce = function () {
  var mask = this.busyMask();
  if (mask === this.lastStatus) return;
  this.lastStatus = mask;
  this.deps.send(proto.statusMessage(mask));
};

/**
 * Tell the watch the current mask even if it has not changed.  For requests
 * that end without a result to carry it -- the watch shows its indicator as
 * soon as it asks, and would otherwise wait for its own timeout.
 */
Controller.prototype.syncStatus = function () {
  this.lastStatus = this.busyMask();
  this.deps.send(proto.statusMessage(this.lastStatus));
};

/** The station being displayed: a GPS-derived one if active, else the pinned one. */
Controller.prototype.currentStation = function () {
  if (this.nearestStation) return this.nearestStation;
  return this.settings.stations[this.stationIndex] || '';
};

Controller.prototype.isNearest = function () {
  return this.nearestStation !== null;
};

/**
 * Whether the station shown is wherever the user is: always with no airport
 * set, and on request with "always nearest" on.  A station followed this way
 * is located again on each refresh, because the user may have moved, and it
 * never reverts to a home airport.
 */
Controller.prototype.followsNearest = function () {
  return !this.settings.stations.length || this.settings.alwaysNearest;
};

/**
 * What to show when the app opens or the settings change: the nearest station
 * if the app follows it, the home airport otherwise.
 */
Controller.prototype.start = function () {
  if (this.followsNearest()) {
    this.requestNearest();
    return;
  }
  /* Airports are set and nearest is not wanted.  A nearest station left over
   * from before the settings changed gives way to the home airport. */
  this.nearestStation = null;
  this.stationIndex = 0;
  this.refresh();
};

Controller.prototype.inFlight = function () {
  return this.pendingStation !== null;
};

Controller.prototype.cycle = function (delta) {
  var list = this.settings.stations;
  /* With nothing pinned there is nowhere to cycle to, and dropping a nearest
   * station here would leave the watch showing it while the phone had moved
   * on to nothing. */
  if (!list.length) {
    this.syncStatus();
    return;
  }
  /* Moving through the pinned list is also how you get back off a nearest
   * station -- the alternative is a state you can only leave by waiting. */
  this.nearestStation = null;
  var n = list.length;
  this.stationIndex = ((this.stationIndex + delta) % n + n) % n;
  this.refresh();
};

Controller.prototype.refresh = function () {
  var station = this.currentStation();
  /* A followed nearest station is found again, not fetched again: the nearest
   * one may have changed since. */
  if (this.followsNearest() && (!station || this.isNearest())) {
    this.requestNearest();
    return;
  }
  if (!station) {
    /* Nothing configured: say so rather than spending a request on it, and say
     * the right thing -- this is not a station that failed to report. */
    this.send(proto.errorMessage('', proto.ERR_NOT_CONFIGURED));
    return;
  }
  /* A repeat request for the station already in flight is a no-op.  A request
   * for a *different* station is not: dropping it would leave the watch
   * showing one airport while the selection had moved to another. */
  if (this.pendingStation === station) return;

  var self = this;
  var isNearest = this.isNearest();
  var seq = ++this.requestSeq;
  this.pendingStation = station;
  this.announce();
  this.deps.fetchJson(awc.metarUrl(this.settings.apiBase, station), function (err, data) {
    if (seq !== self.requestSeq) return; /* superseded; the user moved on */
    self.pendingStation = null;
    if (err) {
      self.send(proto.errorMessage(station, err));
      return;
    }
    var o = observation.build(data[0], self.settings);
    self.lastObservation = o;
    self.send(proto.observationMessage(o, { isNearest: isNearest }));
    /* The TAF page may have been opened before this arrived, leaving its NOW
     * row with nothing observed to show.  Redraw it from what we now know. */
    self.resendTaf(station);
  });
};

/**
 * Build and send the forecast strip for `station` from the cached TAF.
 * @param {number=} error  ERR_API when the latest fetch failed and there is
 *   nothing cached to show in its place.
 */
Controller.prototype.sendTaf = function (station, error) {
  var last = this.lastObservation;
  var json = this.lastTafStation === station ? this.lastTaf : null;
  var f = tafLib.build(json, {
    periods: this.settings.tafPeriods,
    now: this.now(),
    nowCategory: last && last.station === station ? last.catOverall : 4,
    nowText: last && last.station === station ? observation.summaryText(last) : ''
  });
  this.send(proto.tafMessage(f, station, error));
};

/** Rebuild the forecast strip from the cached TAF, with no network call. */
Controller.prototype.resendTaf = function (station) {
  if (this.lastTafStation !== station) return;
  this.sendTaf(station);
};

Controller.prototype.requestTaf = function () {
  var station = this.currentStation();
  if (!station) {
    this.syncStatus();
    return;
  }
  if (this.tafPending === station) return;
  var self = this;
  var seq = ++this.tafSeq;
  this.tafPending = station;
  this.announce();
  this.deps.fetchJson(awc.tafUrl(this.settings.apiBase, station), function (err, data) {
    if (seq !== self.tafSeq) return; /* superseded by a request for another station */
    self.tafPending = null;
    /* The user moved to another station while this was in flight.  Its
     * forecast must not be drawn under the new station's name. */
    if (station !== self.currentStation()) {
      self.syncStatus();
      return;
    }
    if (!err) {
      self.lastTaf = data[0];
      self.lastTafStation = station;
    } else if (err === proto.ERR_NO_REPORT) {
      /* A 204 is a real answer: this station publishes no forecast. */
      self.lastTaf = null;
      self.lastTafStation = station;
    } else if (self.lastTafStation === station && self.lastTaf) {
      /* A failed refetch keeps the forecast already held.  It carries its own
       * issue time, so it never passes for a newer one. */
      err = proto.ERR_NONE;
    }
    self.sendTaf(station, err === proto.ERR_NO_REPORT ? proto.ERR_NONE : err);
  });
};

Controller.prototype.requestNearest = function () {
  /* One lookup at a time.  A flick and a long-press together are one request,
   * not two racing GPS fixes. */
  if (this.locating && this.now() - this.locatingSince < NEAREST_STUCK_S) {
    this.syncStatus();
    return;
  }
  var self = this;
  this.locating = true;
  this.locatingSince = this.now();
  this.announce();

  /* A failed lookup is about the lookup, not about the reading on screen --
   * unless the app has no airport to fall back on.  Then the failure is the
   * state of the page, and the watch shows it there. */
  function fail(code) {
    self.locating = false;
    var fallback = self.settings.stations.length > 0;
    self.send(proto.errorMessage(self.currentStation(), code, { nearest: fallback }));
    /* Opening on the nearest station failed, but there is a home airport:
     * show that rather than whatever reading was cached last time. */
    if (fallback && !self.nearestStation && self.settings.alwaysNearest) self.refresh();
  }

  this.deps.geolocate(function (err, pos) {
    if (err || !pos) return fail(proto.ERR_NO_GPS);
    var bbox = nearest.bboxParam(pos.lat, pos.lon, self.settings.nearestRadiusNm);
    self.deps.fetchJson(awc.areaUrl(self.settings.apiBase, bbox), function (fetchErr, data) {
      if (fetchErr) {
        return fail(fetchErr === proto.ERR_NO_REPORT ? proto.ERR_NO_STATION : fetchErr);
      }
      var pick = nearest.pick(data, pos.lat, pos.lon, {
        now: self.now(),
        maxAgeS: NEAREST_MAX_AGE_S,
        radiusNm: self.settings.nearestRadiusNm
      });
      if (!pick) return fail(proto.ERR_NO_STATION);
      var o = observation.build(pick, self.settings);
      self.locating = false;
      self.requestSeq++;
      self.pendingStation = null;
      self.lastObservation = o;
      self.nearestStation = o.station;
      self.nearestSince = self.now();
      self.send(proto.observationMessage(o, { isNearest: true }));
      self.resendTaf(o.station);
    });
  });
};

/**
 * Called on the app's timer.  Its only job is the auto-revert: a watch left
 * sitting on a station the user has since driven away from is showing the
 * wrong airport's weather with no hint that it is doing so.
 */
Controller.prototype.tick = function () {
  if (!this.nearestStation) return;
  /* Following the nearest station is the setting, not a detour from home. */
  if (this.followsNearest()) return;
  var revert = this.settings.nearestRevertMin;
  if (!revert) return; /* 0 means never */
  if (this.now() - this.nearestSince < revert * 60) return;
  this.nearestStation = null;
  this.refresh();
};

Controller.NEAREST_MAX_AGE_S = NEAREST_MAX_AGE_S;
module.exports = Controller;
