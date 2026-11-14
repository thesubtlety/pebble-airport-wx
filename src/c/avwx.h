#pragma once
#include <pebble.h>

/*
 * Airport Wx -- shared state and types.
 *
 * The watch holds no opinions.  Every value below arrives from the phone
 * already converted, categorised and formatted; the C here decides only where
 * things go on the screen and which of them are drawn in which colour.
 */

/* Flight category.  Matches the wire enum in src/pkjs/lib/category.js. */
typedef enum {
  CAT_VFR = 0,
  CAT_MVFR = 1,
  CAT_IFR = 2,
  CAT_LIFR = 3,
  CAT_UNKNOWN = 4
} FlightCategory;

/* KEY_ERROR.  Every one of these has a design; none of them is a blank page. */
typedef enum {
  ERR_NONE = 0,
  ERR_FETCHING = 1,
  ERR_NO_REPORT = 2,
  ERR_API = 3,
  ERR_NO_GPS = 4,
  ERR_NO_STATION = 5,
  ERR_NOT_CONFIGURED = 6
} ErrorState;

/* KEY_XW_SIDE */
typedef enum {
  XW_SIDE_LEFT = 0,
  XW_SIDE_RIGHT = 1,
  XW_SIDE_NONE = 2   /* no component figure is available */
} CrosswindSide;

/* KEY_WIND_DIR sentinels */
#define WIND_DIR_VRB (-1)
#define WIND_DIR_CALM (-2)
#define WIND_DIR_MISSING (-3)

/* KEY_FLAGS -- personal minima only.  Regulatory category travels separately. */
#define FLAG_WIND     (1 << 0)
#define FLAG_XW       (1 << 1)
#define FLAG_GUST     (1 << 2)
#define FLAG_CIG      (1 << 3)
#define FLAG_VIS      (1 << 4)
#define FLAG_XW_GUST  (1 << 5)

#define MAX_TAF_PERIODS 6

/* KEY_STATUS: what the phone is working on, as a bitmask.  Matches
 * src/pkjs/lib/protocol.js.  Non-zero draws the loading indicator. */
#define BUSY_OBS      (1 << 0)
#define BUSY_TAF      (1 << 1)
#define BUSY_NEAREST  (1 << 2)

typedef enum {
  PAGE_HOME = 0,
  PAGE_WIND = 1,
  PAGE_TAF = 2,
  PAGE_RAW = 3,
  PAGE_COUNT = 4
} Page;

typedef struct {
  char station[5];
  bool is_nearest;
  int32_t obs_epoch;
  uint8_t cat_overall;
  uint8_t cat_vis;
  uint8_t cat_cig;
  int16_t wind_dir;
  uint8_t wind_spd;
  uint8_t wind_gust;
  char vis[8];
  char cig[8];
  char altim[8];
  char temp[10];
  char rwy_ident[5];
  uint16_t rwy_hdg_true;
  uint16_t rwy_len_ft;
  int8_t hw;
  int8_t xw;
  uint8_t xw_side;
  uint8_t flags;
  char raw[168];
  uint8_t error;
  bool have_data;      /* true once any observation has ever been received */
} Observation;

typedef struct {
  char station[5];     /* the station this forecast is for */
  uint8_t error;       /* ERR_API when the fetch failed and nothing is cached */
  uint8_t count;
  char valid[16];
  char issue[8];
  char label[MAX_TAF_PERIODS][6];
  char text[MAX_TAF_PERIODS][16];
  uint8_t cat[MAX_TAF_PERIODS];
  uint8_t tempo_cat[MAX_TAF_PERIODS];
  bool have_data;
} Forecast;

typedef struct {
  uint8_t stale_amber_min;
  uint8_t stale_red_min;
  uint8_t start_page;
  uint8_t taf_periods;
  uint8_t station_count;
  bool show_raw;
  bool flick_nearest;
  bool backlight_on_flick;
  bool vibe_on_cat_change;
} Settings;

typedef struct {
  Observation obs;
  Forecast taf;
  Settings settings;
  Page page;
  uint8_t busy;        /* BUSY_* bits: what is in flight, for the indicator */
  int16_t raw_scroll;  /* raw page only: Up/Down scroll offset, in pixels */
  time_t toast_until;  /* a transient message is on screen until this time */
  char toast[16];
} AppState;

AppState *state(void);
void app_refresh_display(void);
/* A transient message over the current page, for states that should not
 * displace the reading underneath them. */
void app_toast(const char *message);
/* Replace the busy mask with what the phone reports.  The phone is the
 * authority on what it is doing; the watch only guesses ahead of it. */
void app_set_busy(uint8_t mask);
/* Mark work the watch has just asked for, before the phone confirms it. */
void app_add_busy(uint8_t bits);
/* The phone or station on screen has changed under the forecast. */
void app_station_changed(void);

/* comm.c */
void comm_init(void);
void comm_deinit(void);
/* Each returns false, after telling the user, when the request could not be
 * sent -- there is then nothing in flight and no indicator is shown. */
bool comm_request_refresh(bool with_taf);
bool comm_request_taf(void);
bool comm_request_nearest(void);
bool comm_request_station_step(int8_t delta);

/* persist.c */
void persist_load(void);
void persist_save(void);

/* render.c -- drawing helpers shared by the pages */
GColor cat_color(uint8_t cat);
GColor cat_text_color(uint8_t cat);
const char *cat_name(uint8_t cat);
GColor age_color(int32_t age_minutes);
int32_t obs_age_minutes(void);

/* Draws text vertically centred inside `box`, measuring first rather than
 * guessing a baseline.  Returns the width the text actually occupied. */
int16_t draw_centred_text(GContext *ctx, const char *text, GFont font, GRect box,
                          GTextAlignment align, GColor color);
/* A value with the two-encoding rule applied: a filled category block when the
 * value's own category is below VFR, amber text when a personal minimum is
 * exceeded, white otherwise.  The block wins when both apply. */
void draw_value(GContext *ctx, const char *text, GFont font, GRect box,
                GTextAlignment align, uint8_t cat, bool amber);
void draw_rule(GContext *ctx, GRect bounds, int16_t y, GColor color);
/* The loading indicator: a ring with a turning arc, drawn only while
 * something is in flight.  `right` is the x it must stay left of, so it sits
 * beside whatever text ends there rather than on top of it. */
void draw_busy(GContext *ctx, GRect bounds, int16_t right, int16_t cy);
uint8_t busy_frame(void);
void format_wind(char *out, size_t len, const Observation *obs);
void format_age(char *out, size_t len, int32_t minutes);
/* Runway lengths are read as "10,000 ft", not "10000 ft". */
void format_length_ft(char *out, size_t len, uint16_t feet);

/* Layout scaling.  The reference geometry is the Pebble Time 2's 200 x 228;
 * everything is expressed against it and scaled to the real bounds so a wider
 * or taller display is a layout pass rather than a rewrite. */
#define REF_W 200
#define REF_H 228
#define SX(bounds, v) ((int16_t)((int32_t)(v) * (bounds).size.w / REF_W))
#define SY(bounds, v) ((int16_t)((int32_t)(v) * (bounds).size.h / REF_H))

/* page_*.c */
void page_home_draw(Layer *layer, GContext *ctx);
void page_wind_draw(Layer *layer, GContext *ctx);
void page_taf_draw(Layer *layer, GContext *ctx);
void page_raw_draw(Layer *layer, GContext *ctx);
int16_t page_raw_overflow(GRect bounds);
