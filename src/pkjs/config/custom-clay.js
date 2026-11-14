'use strict';

/*
 * Clay page behaviour: hide what does not apply, and check identifiers before
 * they reach the API.
 */

module.exports = function (minified) {
  var clayConfig = this;

  function toggleRunwayFields() {
    var auto = clayConfig.getItemByMessageKey('runwayAuto').get();
    var manual = clayConfig.getItemByMessageKey('runwayManual');
    if (auto) manual.hide(); else manual.show();
  }

  /*
   * Identifiers are checked against the live API rather than against a regular
   * expression alone: "KXYZ" is well-formed and still not a station, and
   * finding that out here is much better than finding it out as an empty
   * screen at the aircraft.  A 204 is the API's way of saying it knows the
   * request but has nothing, so it counts as "not reporting".
   */
  function checkStation(item) {
    var value = String(item.get() || '').trim().toUpperCase();
    if (!value) return item.set('');
    item.set(value);
    if (!/^[A-Z][A-Z0-9]{3}$/.test(value)) {
      return item.setDescription('Not a valid four-character identifier.');
    }
    item.setDescription('Checking…');
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'https://aviationweather.gov/api/data/metar?ids=' +
      encodeURIComponent(value) + '&format=json', true);
    xhr.onload = function () {
      if (xhr.status === 204) return item.setDescription('✗ ' + value + ' is not reporting.');
      if (xhr.status < 200 || xhr.status >= 300) return item.setDescription('Could not check just now.');
      var data;
      try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
      if (data && data.length) item.setDescription('✓ ' + (data[0].name || value));
      else item.setDescription('✗ ' + value + ' is not reporting.');
    };
    xhr.onerror = function () { item.setDescription('Could not check just now.'); };
    xhr.send();
  }

  clayConfig.on(clayConfig.EVENTS.AFTER_BUILD, function () {
    toggleRunwayFields();
    clayConfig.getItemByMessageKey('runwayAuto').on('change', toggleRunwayFields);

    var keys = ['homeStation', 'station2', 'station3', 'station4', 'station5'];
    for (var i = 0; i < keys.length; i++) {
      (function (item) {
        if (!item) return;
        item.on('change', function () { checkStation(item); });
      }(clayConfig.getItemByMessageKey(keys[i])));
    }
  });
};
