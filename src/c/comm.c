#include "avwx.h"

/*
 * AppMessage.
 *
 * Four shapes of message arrive here and they are told apart by which keys are
 * present, not by a type field:
 *
 *   an observation  (has OBS_EPOCH)   -- replaces the cached reading
 *   an error        (has ERROR only)  -- annotates the cached reading, keeping
 *                                        it on screen with its age counting up
 *   a forecast      (has TAF_COUNT)
 *   settings        (has SET_*)
 *
 * That matters most for the error case: a failed fetch must never blank a
 * reading the pilot can still use, it must label it.  The exception is an
 * error for a *different* station: the cached reading is then another
 * airport's weather, and is not usable at all.
 *
 * Any of them may also carry STATUS, the phone's busy mask, and a message with
 * only STATUS is the phone saying it has started something.
 */

/* An observation is about 440 bytes at its largest (a 167-character raw
 * report).  1 KB leaves room for the protocol to grow without a dropped
 * message being the first sign it has outgrown the buffer. */
#define INBOX_SIZE 1024
#define OUTBOX_SIZE 128

/*
 * Indexed TAF keys, written out rather than computed from TAF_TIME_0 + 4*i:
 * the generated key numbers follow declaration order in package.json, and a
 * reordering there should not silently scramble the forecast.
 *
 * These are filled in at startup rather than at compile time because the
 * generated MESSAGE_KEY_* symbols are runtime `uint32_t` variables, not
 * constants -- a static initialiser using them does not compile.
 */
static uint32_t TAF_TIME_KEYS[MAX_TAF_PERIODS];
static uint32_t TAF_CAT_KEYS[MAX_TAF_PERIODS];
static uint32_t TAF_TEXT_KEYS[MAX_TAF_PERIODS];
static uint32_t TAF_TEMPO_KEYS[MAX_TAF_PERIODS];

static void init_taf_keys(void) {
  TAF_TIME_KEYS[0] = MESSAGE_KEY_TAF_TIME_0;
  TAF_TIME_KEYS[1] = MESSAGE_KEY_TAF_TIME_1;
  TAF_TIME_KEYS[2] = MESSAGE_KEY_TAF_TIME_2;
  TAF_TIME_KEYS[3] = MESSAGE_KEY_TAF_TIME_3;
  TAF_TIME_KEYS[4] = MESSAGE_KEY_TAF_TIME_4;
  TAF_TIME_KEYS[5] = MESSAGE_KEY_TAF_TIME_5;

  TAF_CAT_KEYS[0] = MESSAGE_KEY_TAF_CAT_0;
  TAF_CAT_KEYS[1] = MESSAGE_KEY_TAF_CAT_1;
  TAF_CAT_KEYS[2] = MESSAGE_KEY_TAF_CAT_2;
  TAF_CAT_KEYS[3] = MESSAGE_KEY_TAF_CAT_3;
  TAF_CAT_KEYS[4] = MESSAGE_KEY_TAF_CAT_4;
  TAF_CAT_KEYS[5] = MESSAGE_KEY_TAF_CAT_5;

  TAF_TEXT_KEYS[0] = MESSAGE_KEY_TAF_TEXT_0;
  TAF_TEXT_KEYS[1] = MESSAGE_KEY_TAF_TEXT_1;
  TAF_TEXT_KEYS[2] = MESSAGE_KEY_TAF_TEXT_2;
  TAF_TEXT_KEYS[3] = MESSAGE_KEY_TAF_TEXT_3;
  TAF_TEXT_KEYS[4] = MESSAGE_KEY_TAF_TEXT_4;
  TAF_TEXT_KEYS[5] = MESSAGE_KEY_TAF_TEXT_5;

  TAF_TEMPO_KEYS[0] = MESSAGE_KEY_TAF_TEMPO_CAT_0;
  TAF_TEMPO_KEYS[1] = MESSAGE_KEY_TAF_TEMPO_CAT_1;
  TAF_TEMPO_KEYS[2] = MESSAGE_KEY_TAF_TEMPO_CAT_2;
  TAF_TEMPO_KEYS[3] = MESSAGE_KEY_TAF_TEMPO_CAT_3;
  TAF_TEMPO_KEYS[4] = MESSAGE_KEY_TAF_TEMPO_CAT_4;
  TAF_TEMPO_KEYS[5] = MESSAGE_KEY_TAF_TEMPO_CAT_5;
}

static void copy_string(char *dest, size_t size, const Tuple *t) {
  if (!t) {
    dest[0] = '\0';
    return;
  }
  size_t n = t->length < size ? t->length : size - 1;
  memcpy(dest, t->value->cstring, n);
  dest[n] = '\0';
}

/*
 * An integer, whatever width it arrived in.  The tuple's length says whether
 * it is 1, 2 or 4 bytes and its type says whether it is signed.  Reading a
 * fixed width works only while the phone happens to send 32-bit integers --
 * the emulator does, but nothing promises a phone app will -- and a 1-byte -3
 * read as an int16 picks up a garbage high byte.
 */
static int32_t tuple_int(const Tuple *t, int32_t fallback) {
  if (!t) return fallback;
  bool is_signed = t->type == TUPLE_INT;
  if (t->type != TUPLE_INT && t->type != TUPLE_UINT) return fallback;
  switch (t->length) {
    case 1: return is_signed ? (int32_t)t->value->int8 : (int32_t)t->value->uint8;
    case 2: return is_signed ? (int32_t)t->value->int16 : (int32_t)t->value->uint16;
    case 4: return is_signed ? t->value->int32 : (int32_t)t->value->uint32;
    default: return fallback;
  }
}

static uint8_t tuple_u8(const Tuple *t, uint8_t fallback) {
  return (uint8_t)tuple_int(t, fallback);
}

/* The identifier a message names, or "" when it names none. */
static void message_station(DictionaryIterator *iter, uint32_t key, char out[5]) {
  const Tuple *t = dict_find(iter, key);
  copy_string(out, 5, t);
}

/* A message for another station invalidates everything cached for this one
 * that the message itself does not replace. */
static bool is_other_station(const char *incoming) {
  const char *current = state()->obs.station;
  return incoming[0] && current[0] && strcmp(incoming, current) != 0;
}

static void read_observation(DictionaryIterator *iter) {
  AppState *s = state();
  Observation *o = &s->obs;
  char incoming[5];
  message_station(iter, MESSAGE_KEY_STATION, incoming);
  bool changed = is_other_station(incoming);
  /* A category change is only news at the same airport.  Moving to another
   * one with different weather is not a change in the weather. */
  uint8_t previous_cat = (o->have_data && !changed) ? o->cat_overall : CAT_UNKNOWN;

  int32_t epoch = tuple_int(dict_find(iter, MESSAGE_KEY_OBS_EPOCH), 0);
  /* A different report starts at its top.  A scroll position kept from the
   * last one could open the page partway down, or past the end of a shorter
   * report. */
  if (changed || epoch != o->obs_epoch) s->raw_scroll = 0;

  memcpy(o->station, incoming, sizeof(o->station));
  o->is_nearest = tuple_u8(dict_find(iter, MESSAGE_KEY_IS_NEAREST), 0) != 0;
  o->obs_epoch = epoch;
  o->cat_overall = tuple_u8(dict_find(iter, MESSAGE_KEY_CAT_OVERALL), CAT_UNKNOWN);
  o->cat_vis = tuple_u8(dict_find(iter, MESSAGE_KEY_CAT_VIS), CAT_UNKNOWN);
  o->cat_cig = tuple_u8(dict_find(iter, MESSAGE_KEY_CAT_CIG), CAT_UNKNOWN);

  o->wind_dir = (int16_t)tuple_int(dict_find(iter, MESSAGE_KEY_WIND_DIR), WIND_DIR_MISSING);
  o->wind_spd = tuple_u8(dict_find(iter, MESSAGE_KEY_WIND_SPD), 0);
  o->wind_gust = tuple_u8(dict_find(iter, MESSAGE_KEY_WIND_GUST), 0);

  copy_string(o->vis, sizeof(o->vis), dict_find(iter, MESSAGE_KEY_VIS_STR));
  copy_string(o->cig, sizeof(o->cig), dict_find(iter, MESSAGE_KEY_CIG_STR));
  copy_string(o->altim, sizeof(o->altim), dict_find(iter, MESSAGE_KEY_ALTIM_STR));
  copy_string(o->temp, sizeof(o->temp), dict_find(iter, MESSAGE_KEY_TEMP_STR));
  copy_string(o->rwy_ident, sizeof(o->rwy_ident), dict_find(iter, MESSAGE_KEY_RWY_IDENT));
  copy_string(o->raw, sizeof(o->raw), dict_find(iter, MESSAGE_KEY_RAW));

  o->rwy_hdg_true = (uint16_t)tuple_int(dict_find(iter, MESSAGE_KEY_RWY_HDG_TRUE), 0);
  o->rwy_len_ft = (uint16_t)tuple_int(dict_find(iter, MESSAGE_KEY_RWY_LEN_FT), 0);
  o->hw = (int8_t)tuple_int(dict_find(iter, MESSAGE_KEY_HW), 0);
  o->xw = (int8_t)tuple_int(dict_find(iter, MESSAGE_KEY_XW), 0);
  o->xw_side = tuple_u8(dict_find(iter, MESSAGE_KEY_XW_SIDE), XW_SIDE_NONE);
  o->flags = tuple_u8(dict_find(iter, MESSAGE_KEY_FLAGS), 0);
  o->error = tuple_u8(dict_find(iter, MESSAGE_KEY_ERROR), ERR_NONE);
  o->have_data = true;

  if (s->settings.vibe_on_cat_change && previous_cat != CAT_UNKNOWN &&
      previous_cat != o->cat_overall) {
    vibes_short_pulse();
  }
  persist_save();
  if (changed || !s->taf.have_data) app_station_changed();
}

/* Only the nearest lookup failed; the reading on screen is as good as it was. */
static void nearest_failed(uint8_t error) {
  switch (error) {
    case ERR_NO_GPS:     app_toast("NO GPS"); break;
    case ERR_NO_STATION: app_toast("NONE NEARBY"); break;
    default:             app_toast("NRST FAILED"); break;
  }
}

static void read_error(DictionaryIterator *iter) {
  AppState *s = state();
  uint8_t error = tuple_u8(dict_find(iter, MESSAGE_KEY_ERROR), ERR_API);

  /* A refused or timed-out fix, or a failed area query, says nothing about
   * the weather on screen, so it gets a two-second toast and leaves the
   * station and its reading alone.  The phone leaves the flag off when there
   * is no airport set: the lookup failing is then the state of the page. */
  if (tuple_u8(dict_find(iter, MESSAGE_KEY_IS_NEAREST), 0)) {
    nearest_failed(error);
    return;
  }

  char incoming[5];
  message_station(iter, MESSAGE_KEY_STATION, incoming);
  if (is_other_station(incoming)) {
    /* The cached reading is another airport's.  Keeping it under this
     * station's identifier would show one field's wind and ceiling as
     * another's, so it goes, and the page says what happened instead. */
    Observation *o = &s->obs;
    memset(o, 0, sizeof(*o));
    o->cat_overall = CAT_UNKNOWN;
    o->cat_vis = CAT_UNKNOWN;
    o->cat_cig = CAT_UNKNOWN;
    o->wind_dir = WIND_DIR_MISSING;
    o->xw_side = XW_SIDE_NONE;
    memcpy(o->station, incoming, sizeof(o->station));
    s->obs.error = error;
    app_station_changed();
    return;
  }
  if (incoming[0]) memcpy(s->obs.station, incoming, sizeof(s->obs.station));
  s->obs.error = error;
}

static void read_taf(DictionaryIterator *iter, uint8_t count) {
  Forecast *f = &state()->taf;
  char incoming[5];
  message_station(iter, MESSAGE_KEY_TAF_STATION, incoming);
  /* The phone drops forecasts for a station the user has left; this is the
   * same rule on the receiving end, so neither side alone has to be right. */
  if (is_other_station(incoming)) return;

  if (count > MAX_TAF_PERIODS) count = MAX_TAF_PERIODS;
  memcpy(f->station, incoming, sizeof(f->station));
  f->error = tuple_u8(dict_find(iter, MESSAGE_KEY_ERROR), ERR_NONE);
  f->count = count;
  copy_string(f->valid, sizeof(f->valid), dict_find(iter, MESSAGE_KEY_TAF_VALID));
  copy_string(f->issue, sizeof(f->issue), dict_find(iter, MESSAGE_KEY_TAF_ISSUE));
  for (uint8_t i = 0; i < count; i++) {
    copy_string(f->label[i], sizeof(f->label[i]), dict_find(iter, TAF_TIME_KEYS[i]));
    copy_string(f->text[i], sizeof(f->text[i]), dict_find(iter, TAF_TEXT_KEYS[i]));
    f->cat[i] = tuple_u8(dict_find(iter, TAF_CAT_KEYS[i]), CAT_UNKNOWN);
    f->tempo_cat[i] = tuple_u8(dict_find(iter, TAF_TEMPO_KEYS[i]), CAT_UNKNOWN);
  }
  f->have_data = true;
}

static void read_settings(DictionaryIterator *iter) {
  Settings *set = &state()->settings;
  set->stale_amber_min = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_STALE_AMBER),
                                  set->stale_amber_min);
  set->stale_red_min = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_STALE_RED),
                                set->stale_red_min);
  set->start_page = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_START_PAGE), set->start_page);
  set->taf_periods = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_TAF_PERIODS), set->taf_periods);
  set->station_count = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_STATION_COUNT),
                                set->station_count);
  set->show_raw = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_SHOW_RAW), set->show_raw) != 0;
  set->flick_nearest = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_FLICK_NEAREST),
                                set->flick_nearest) != 0;
  set->backlight_on_flick = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_BACKLIGHT_FLICK),
                                     set->backlight_on_flick) != 0;
  set->vibe_on_cat_change = tuple_u8(dict_find(iter, MESSAGE_KEY_SET_VIBE_CAT_CHANGE),
                                     set->vibe_on_cat_change) != 0;
  persist_save();
}

static void inbox_received(DictionaryIterator *iter, void *context) {
  const Tuple *status = dict_find(iter, MESSAGE_KEY_STATUS);
  if (status) app_set_busy(tuple_u8(status, 0));

  const Tuple *taf_count = dict_find(iter, MESSAGE_KEY_TAF_COUNT);
  if (taf_count) {
    read_taf(iter, (uint8_t)taf_count->value->uint8);
    app_refresh_display();
    return;
  }
  if (dict_find(iter, MESSAGE_KEY_SET_STALE_AMBER)) {
    read_settings(iter);
    app_refresh_display();
    return;
  }
  if (dict_find(iter, MESSAGE_KEY_OBS_EPOCH)) {
    read_observation(iter);
  } else if (dict_find(iter, MESSAGE_KEY_ERROR)) {
    read_error(iter);
  }
  app_refresh_display();
}

static void inbox_dropped(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "inbox dropped: %d", (int)reason);
}

/* What a request the watch sent will keep the phone busy with. */
static uint8_t busy_bits_of(DictionaryIterator *iter) {
  uint8_t bits = 0;
  if (dict_find(iter, MESSAGE_KEY_REQ_FETCH)) bits |= BUSY_OBS;
  if (dict_find(iter, MESSAGE_KEY_REQ_STATION_INDEX)) bits |= BUSY_OBS;
  if (dict_find(iter, MESSAGE_KEY_REQ_TAF)) bits |= BUSY_TAF;
  if (dict_find(iter, MESSAGE_KEY_REQ_NEAREST)) bits |= BUSY_NEAREST;
  return bits;
}

/* The request never reached the phone, so nothing it asked for is coming. */
static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "outbox failed: %d", (int)reason);
  app_set_busy(state()->busy & (uint8_t)~busy_bits_of(iter));
  app_toast("NOT SENT");
}

/*
 * One message per user action.  The outbox holds a single message until the
 * phone acknowledges it, so two sends back to back lose the second; a refresh
 * that also wants the forecast therefore asks for both in one dictionary.
 */
static bool send_request(uint32_t key, int8_t value, uint32_t key2, uint8_t busy) {
  if (!connection_service_peek_pebble_app_connection()) {
    app_toast("NO PHONE");
    return false;
  }
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) return false;
  dict_write_int8(out, key, value);
  if (key2) dict_write_int8(out, key2, 1);
  if (app_message_outbox_send() != APP_MSG_OK) return false;
  /* Shown at once rather than when the phone confirms it: the indicator is
   * feedback for the press as much as a report on the network. */
  app_add_busy(busy);
  return true;
}

bool comm_request_refresh(bool with_taf) {
  return send_request(MESSAGE_KEY_REQ_FETCH, 1, with_taf ? MESSAGE_KEY_REQ_TAF : 0,
                      with_taf ? (BUSY_OBS | BUSY_TAF) : BUSY_OBS);
}

bool comm_request_taf(void) {
  return send_request(MESSAGE_KEY_REQ_TAF, 1, 0, BUSY_TAF);
}

bool comm_request_nearest(void) {
  return send_request(MESSAGE_KEY_REQ_NEAREST, 1, 0, BUSY_NEAREST);
}

bool comm_request_station_step(int8_t delta) {
  return send_request(MESSAGE_KEY_REQ_STATION_INDEX, delta, 0, BUSY_OBS);
}

void comm_init(void) {
  init_taf_keys();
  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_failed(outbox_failed);

  /* The raw METAR alone can be 160 bytes, so ask for room and complain loudly
   * if the system could not give it. */
  AppMessageResult result = app_message_open(INBOX_SIZE, OUTBOX_SIZE);
  if (result != APP_MSG_OK) {
    APP_LOG(APP_LOG_LEVEL_ERROR, "app_message_open failed: %d", (int)result);
  }
}

void comm_deinit(void) {
}
