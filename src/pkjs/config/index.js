'use strict';

/*
 * Clay configuration.
 *
 * Sections 4 and 6 -- units and personal minima -- are not in the original
 * specification's table but are implied by it: the observation message carries
 * pre-formatted strings precisely so unit choice can live here, and KEY_FLAGS
 * carries personal-minima flags that have to be set somewhere.
 *
 * Fields that only matter in some configurations are hidden in the others; see
 * custom-clay.js.  A settings page that shows everything at all times is where
 * this kind of app usually goes wrong.
 */

module.exports = [
  {
    type: 'heading',
    defaultValue: 'Airport Wx'
  },
  {
    type: 'text',
    defaultValue: 'Current conditions for your airport. Not for flight planning ' +
      'or navigation — always consult an official source before flight.'
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Stations' },
      {
        type: 'input',
        messageKey: 'homeStation',
        label: 'Home airport',
        attributes: { placeholder: 'KRDU', maxlength: 4, autocapitalize: 'characters' },
        description: 'Four-character ICAO identifier. Leave empty to use the nearest ' +
          'reporting station.'
      },
      {
        type: 'input', messageKey: 'station2', label: 'Also show',
        attributes: { placeholder: 'optional', maxlength: 4, autocapitalize: 'characters' }
      },
      {
        type: 'input', messageKey: 'station3', label: 'Also show',
        attributes: { placeholder: 'optional', maxlength: 4, autocapitalize: 'characters' }
      },
      {
        type: 'input', messageKey: 'station4', label: 'Also show',
        attributes: { placeholder: 'optional', maxlength: 4, autocapitalize: 'characters' }
      },
      {
        type: 'input', messageKey: 'station5', label: 'Also show',
        attributes: { placeholder: 'optional', maxlength: 4, autocapitalize: 'characters' },
        description: 'Up and Down cycle through these on the watch.'
      },
      {
        type: 'select',
        messageKey: 'startPage',
        label: 'Start page',
        defaultValue: '0',
        options: [
          { label: 'Home', value: '0' },
          { label: 'Wind', value: '1' },
          { label: 'TAF', value: '2' }
        ]
      }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Nearest station' },
      {
        type: 'toggle', messageKey: 'alwaysNearest', label: 'Always open on nearest station',
        defaultValue: false,
        description: 'Up and Down still show your airports.'
      },
      { type: 'toggle', messageKey: 'flickNearest', label: 'Flick to nearest', defaultValue: true },
      {
        type: 'slider', messageKey: 'nearestRadiusNm', label: 'Search radius (nm)',
        defaultValue: 50, min: 10, max: 200, step: 5
      },
      {
        type: 'slider', messageKey: 'nearestRevertMin', label: 'Revert to home after (min)',
        defaultValue: 10, min: 0, max: 60, step: 5,
        description: '0 never reverts. Does not apply when the app opens on the nearest station.'
      }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Runway' },
      {
        type: 'toggle', messageKey: 'runwayAuto', label: 'Auto-select runway', defaultValue: true,
        description: 'Longest runway, wind-favoured end. A guess at the likely runway, ' +
          'never a statement of the active one.'
      },
      {
        type: 'input', messageKey: 'runwayManual', label: 'Manual runway',
        attributes: { placeholder: '23R', maxlength: 3, autocapitalize: 'characters' }
      },
      {
        type: 'input', messageKey: 'runwayCalm', label: 'Calm-wind runway',
        attributes: { placeholder: '05L', maxlength: 3, autocapitalize: 'characters' }
      },
      {
        type: 'slider', messageKey: 'calmKt', label: 'Calm-wind threshold (kt)',
        defaultValue: 5, min: 0, max: 10, step: 1
      }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Units' },
      {
        type: 'select', messageKey: 'altimUnit', label: 'Altimeter', defaultValue: 'inhg',
        options: [{ label: 'inHg', value: 'inhg' }, { label: 'hPa', value: 'hpa' }]
      },
      {
        type: 'select', messageKey: 'tempUnit', label: 'Temperature', defaultValue: 'f',
        options: [{ label: '°F', value: 'f' }, { label: '°C', value: 'c' }]
      },
      {
        type: 'select', messageKey: 'visUnit', label: 'Visibility', defaultValue: 'sm',
        options: [{ label: 'Statute miles', value: 'sm' }, { label: 'Kilometres', value: 'km' }]
      },
      {
        type: 'select', messageKey: 'ceilUnit', label: 'Ceiling', defaultValue: 'ft',
        options: [{ label: 'Feet', value: 'ft' }, { label: 'Metres', value: 'm' }]
      }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Refresh and alerts' },
      {
        type: 'select', messageKey: 'refreshMin', label: 'Refresh interval', defaultValue: '15',
        options: [
          { label: '5 min', value: '5' }, { label: '10 min', value: '10' },
          { label: '15 min', value: '15' }, { label: '30 min', value: '30' }
        ]
      },
      {
        type: 'toggle', messageKey: 'refreshOnOpen', label: 'Refresh only when opened',
        defaultValue: true,
        description: 'Kinder to the battery, and enough for an app you open deliberately.'
      },
      {
        type: 'slider', messageKey: 'staleAmberMin', label: 'Age turns amber at (min)',
        defaultValue: 45, min: 15, max: 90, step: 5
      },
      {
        type: 'slider', messageKey: 'staleRedMin', label: 'Age turns red at (min)',
        defaultValue: 75, min: 30, max: 180, step: 5
      },
      { type: 'toggle', messageKey: 'vibeOnCatChange', label: 'Vibrate on category change', defaultValue: false },
      { type: 'toggle', messageKey: 'backlightOnFlick', label: 'Backlight on flick', defaultValue: true }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Personal minima' },
      {
        type: 'text',
        defaultValue: 'A value past one of these is drawn in amber. Set any to 0 to turn ' +
          'that check off. These are your limits, not regulatory ones — the coloured ' +
          'blocks show the regulatory category and always take precedence.'
      },
      { type: 'slider', messageKey: 'maxWindKt', label: 'Max wind (kt)', defaultValue: 0, min: 0, max: 60, step: 1 },
      { type: 'slider', messageKey: 'maxGustKt', label: 'Max gust (kt)', defaultValue: 0, min: 0, max: 60, step: 1 },
      { type: 'slider', messageKey: 'maxXwKt', label: 'Max crosswind (kt)', defaultValue: 0, min: 0, max: 40, step: 1 },
      { type: 'slider', messageKey: 'minCigFt', label: 'Min ceiling (ft)', defaultValue: 0, min: 0, max: 10000, step: 100 },
      { type: 'slider', messageKey: 'minVisSm', label: 'Min visibility (SM)', defaultValue: 0, min: 0, max: 10, step: 1 }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Display' },
      {
        type: 'slider', messageKey: 'tafPeriods', label: 'TAF periods shown',
        defaultValue: 4, min: 2, max: 6, step: 1
      },
      { type: 'toggle', messageKey: 'showRawPage', label: 'Show raw METAR page', defaultValue: true }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'Advanced' },
      {
        type: 'input', messageKey: 'apiBase', label: 'API base URL',
        attributes: { placeholder: 'https://aviationweather.gov/api/data/' },
        description: 'Leave blank for the Aviation Weather Center directly. A proxy on ' +
          'any other host only works in a build that declares that host: the phone ' +
          'refuses requests to hosts the app has not declared. See docs/INSTALL.md.'
      }
    ]
  },

  {
    type: 'section',
    items: [
      { type: 'heading', defaultValue: 'About' },
      {
        type: 'text',
        defaultValue: 'Version 1.0. Weather data from the NOAA/NWS Aviation Weather Center. ' +
          'Runway data from OurAirports (public domain).<br><br>' +
          '<b>This app is not a flight planning tool.</b> It is a convenience display of ' +
          'publicly available weather. Reports can be late, wrong or missing, the runway ' +
          'shown is a guess and not the active runway, and the flight category shown is ' +
          'derived using US definitions. Obtain an official weather briefing before flight.'
      }
    ]
  },

  { type: 'submit', defaultValue: 'Save' }
];
