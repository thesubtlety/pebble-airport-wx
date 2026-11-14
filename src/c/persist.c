#include "avwx.h"

/*
 * Persistence.
 *
 * On launch the cached observation is drawn immediately, with its age computed
 * live against the clock, and only then does the app ask for a new one.  A
 * stale reading honestly labelled -- amber or red in the header, counting up --
 * is more use to a pilot than a spinner.
 */

#define PERSIST_KEY_OBS 1
#define PERSIST_KEY_SETTINGS 2

/* Bumped whenever the structs change, so an old install does not read a new
 * struct out of an old blob. */
#define PERSIST_VERSION 1

typedef struct {
  uint8_t version;
  Observation obs;
} StoredObservation;

typedef struct {
  uint8_t version;
  Settings settings;
} StoredSettings;

/* persist_write_data stores at most PERSIST_DATA_MAX_LENGTH bytes.  A struct
 * that grows past it is truncated on write and then fails the size check on
 * every read, which looks like an app that forgets its last reading.  Catch
 * that here instead. */
_Static_assert(sizeof(StoredObservation) <= PERSIST_DATA_MAX_LENGTH,
               "StoredObservation no longer fits one persist record");
_Static_assert(sizeof(StoredSettings) <= PERSIST_DATA_MAX_LENGTH,
               "StoredSettings no longer fits one persist record");

static void set_defaults(Settings *s) {
  s->stale_amber_min = 45;
  s->stale_red_min = 75;
  s->start_page = PAGE_HOME;
  s->taf_periods = 4;
  s->station_count = 0;
  s->show_raw = true;
  s->flick_nearest = true;
  s->backlight_on_flick = true;
  s->vibe_on_cat_change = false;
}

void persist_load(void) {
  AppState *s = state();
  set_defaults(&s->settings);

  StoredSettings stored_settings;
  if (persist_exists(PERSIST_KEY_SETTINGS) &&
      persist_read_data(PERSIST_KEY_SETTINGS, &stored_settings, sizeof(stored_settings)) ==
          (int)sizeof(stored_settings) &&
      stored_settings.version == PERSIST_VERSION) {
    s->settings = stored_settings.settings;
  }

  StoredObservation stored_obs;
  if (persist_exists(PERSIST_KEY_OBS) &&
      persist_read_data(PERSIST_KEY_OBS, &stored_obs, sizeof(stored_obs)) ==
          (int)sizeof(stored_obs) &&
      stored_obs.version == PERSIST_VERSION) {
    s->obs = stored_obs.obs;
    /* Whatever the last error was, it belongs to the last session.  This one
     * is fetching. */
    s->obs.error = ERR_FETCHING;
  } else {
    memset(&s->obs, 0, sizeof(s->obs));
    s->obs.cat_overall = CAT_UNKNOWN;
    s->obs.cat_vis = CAT_UNKNOWN;
    s->obs.cat_cig = CAT_UNKNOWN;
    s->obs.wind_dir = WIND_DIR_MISSING;
    s->obs.xw_side = XW_SIDE_NONE;
    s->obs.error = ERR_FETCHING;
  }

  s->page = (Page)(s->settings.start_page < PAGE_COUNT ? s->settings.start_page : PAGE_HOME);
}

void persist_save(void) {
  const AppState *s = state();

  StoredSettings stored_settings = { PERSIST_VERSION, s->settings };
  persist_write_data(PERSIST_KEY_SETTINGS, &stored_settings, sizeof(stored_settings));

  if (s->obs.have_data) {
    StoredObservation stored_obs = { PERSIST_VERSION, s->obs };
    persist_write_data(PERSIST_KEY_OBS, &stored_obs, sizeof(stored_obs));
  }
}
