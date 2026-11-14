/*
 * A stub of the parts of pebble.h this app uses.
 *
 * The Pebble SDK is not installable in every environment (and is not present
 * in CI here), but a C watchapp that has never been through a compiler is a
 * watchapp full of typos.  This header declares the SDK surface the app
 * touches, with the real signatures, so `gcc -fsyntax-only` can typecheck
 * every source file.  It builds nothing and runs nothing: the real SDK header
 * wins whenever `pebble build` is used.
 *
 * If you add an SDK call to the app, add its declaration here too.  A missing
 * declaration is a compile error, which is the point.
 */
#ifndef PEBBLE_STUB_H
#define PEBBLE_STUB_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

/* ---- geometry ---------------------------------------------------------- */

typedef struct { int16_t x, y; } GPoint;
typedef struct { int16_t w, h; } GSize;
typedef struct { GPoint origin; GSize size; } GRect;

#define GPoint(x, y) ((GPoint){ (int16_t)(x), (int16_t)(y) })
#define GSize(w, h) ((GSize){ (int16_t)(w), (int16_t)(h) })
#define GRect(x, y, w, h) ((GRect){ GPoint((x), (y)), GSize((w), (h)) })

/* ---- colour ------------------------------------------------------------ */

typedef union { uint8_t argb; } GColor8;
typedef GColor8 GColor;

#define GColorFromARGB(v) ((GColor){ .argb = (uint8_t)(v) })
#define GColorBlack       GColorFromARGB(0xC0)
#define GColorWhite       GColorFromARGB(0xFF)
#define GColorGreen       GColorFromARGB(0xCC)
#define GColorRed         GColorFromARGB(0xF0)
#define GColorMagenta     GColorFromARGB(0xF3)
#define GColorPictonBlue  GColorFromARGB(0xD7)
#define GColorChromeYellow GColorFromARGB(0xF8)
#define GColorLightGray   GColorFromARGB(0xEA)
#define GColorDarkGray    GColorFromARGB(0xD5)
#define GColorClear       GColorFromARGB(0x00)

bool gcolor_equal(GColor a, GColor b);

/* ---- layers and windows ------------------------------------------------ */

typedef struct Layer Layer;
typedef struct Window Window;
typedef struct GContext GContext;
typedef struct GFontType *GFont;

typedef void (*LayerUpdateProc)(Layer *layer, GContext *ctx);

Layer *layer_create(GRect frame);
void layer_destroy(Layer *layer);
void layer_set_update_proc(Layer *layer, LayerUpdateProc proc);
void layer_add_child(Layer *parent, Layer *child);
void layer_remove_from_parent(Layer *child);
GRect layer_get_bounds(const Layer *layer);
GRect layer_get_frame(const Layer *layer);
void layer_set_frame(Layer *layer, GRect frame);
void layer_set_hidden(Layer *layer, bool hidden);
void layer_mark_dirty(Layer *layer);

Window *window_create(void);
void window_destroy(Window *window);
Layer *window_get_root_layer(const Window *window);
void window_set_background_color(Window *window, GColor color);
void window_stack_push(Window *window, bool animated);
void window_stack_pop(bool animated);
void window_stack_pop_all(bool animated);

/* ---- clicks ------------------------------------------------------------ */

typedef enum { BUTTON_ID_BACK = 0, BUTTON_ID_UP, BUTTON_ID_SELECT, BUTTON_ID_DOWN } ButtonId;
typedef struct ClickRecognizer *ClickRecognizerRef;
typedef void (*ClickHandler)(ClickRecognizerRef recognizer, void *context);
typedef void (*ClickConfigProvider)(void *context);

typedef void (*WindowHandler)(Window *window);
typedef struct {
  WindowHandler load;
  WindowHandler appear;
  WindowHandler disappear;
  WindowHandler unload;
} WindowHandlers;
void window_set_window_handlers(Window *window, WindowHandlers handlers);

void window_set_click_config_provider(Window *window, ClickConfigProvider provider);

/* ---- touch (SDK 4.33+, PBL_TOUCH platforms) ---------------------------- */
/* Declared whether or not PBL_TOUCH is set: tools/check-c.sh compiles every
 * source both ways, so code outside the #if that calls these is caught. */

typedef enum TouchEventType {
  TouchEvent_Touchdown,
  TouchEvent_Liftoff,
  TouchEvent_PositionUpdate,
} TouchEventType;
typedef struct TouchEvent {
  TouchEventType type : 8;
  bool non_navigational;
  int16_t x;
  int16_t y;
} TouchEvent;
typedef void (*TouchServiceHandler)(const TouchEvent *event, void *context);
void touch_service_subscribe(TouchServiceHandler handler, void *context);
void touch_service_unsubscribe(void);
void window_set_touch_bridge_disabled(Window *window, bool disabled);
bool touch_service_is_enabled(void);
void window_single_click_subscribe(ButtonId button_id, ClickHandler handler);
void window_long_click_subscribe(ButtonId button_id, uint16_t delay_ms,
                                 ClickHandler down_handler, ClickHandler up_handler);

/* ---- graphics ---------------------------------------------------------- */

typedef enum { GCornerNone = 0, GCornersAll = 0x0F } GCornerMask;
typedef enum {
  GTextOverflowModeWordWrap = 0,
  GTextOverflowModeTrailingEllipsis,
  GTextOverflowModeFill
} GTextOverflowMode;
typedef enum {
  GTextAlignmentLeft = 0, GTextAlignmentCenter, GTextAlignmentRight
} GTextAlignment;
typedef struct GTextAttributes GTextAttributes;

void graphics_context_set_fill_color(GContext *ctx, GColor color);
void graphics_context_set_stroke_color(GContext *ctx, GColor color);
void graphics_context_set_text_color(GContext *ctx, GColor color);
void graphics_context_set_stroke_width(GContext *ctx, uint8_t width);
void graphics_context_set_antialiased(GContext *ctx, bool enable);
void graphics_fill_rect(GContext *ctx, GRect rect, uint16_t corner_radius, GCornerMask mask);
void graphics_draw_rect(GContext *ctx, GRect rect);
void graphics_draw_line(GContext *ctx, GPoint p0, GPoint p1);
void graphics_draw_circle(GContext *ctx, GPoint p, uint16_t radius);
void graphics_fill_circle(GContext *ctx, GPoint p, uint16_t radius);
typedef enum { GOvalScaleModeFitCircle, GOvalScaleModeFillCircle } GOvalScaleMode;
void graphics_draw_arc(GContext *ctx, GRect rect, GOvalScaleMode scale_mode, int32_t angle_start,
                       int32_t angle_end);
void graphics_draw_text(GContext *ctx, const char *text, GFont font, const GRect box,
                        const GTextOverflowMode overflow_mode,
                        const GTextAlignment alignment,
                        GTextAttributes *text_attributes);
GSize graphics_text_layout_get_content_size(const char *text, GFont const font,
                                            const GRect box,
                                            const GTextOverflowMode overflow_mode,
                                            const GTextAlignment alignment);

GFont fonts_get_system_font(const char *font_key);

#define FONT_KEY_GOTHIC_14 "RESOURCE_ID_GOTHIC_14"
#define FONT_KEY_GOTHIC_14_BOLD "RESOURCE_ID_GOTHIC_14_BOLD"
#define FONT_KEY_GOTHIC_18 "RESOURCE_ID_GOTHIC_18"
#define FONT_KEY_GOTHIC_18_BOLD "RESOURCE_ID_GOTHIC_18_BOLD"
#define FONT_KEY_GOTHIC_24_BOLD "RESOURCE_ID_GOTHIC_24_BOLD"
#define FONT_KEY_GOTHIC_28_BOLD "RESOURCE_ID_GOTHIC_28_BOLD"
#define FONT_KEY_LECO_42_NUMBERS "RESOURCE_ID_LECO_42_NUMBERS"

/* ---- paths ------------------------------------------------------------- */

typedef struct { uint32_t num_points; GPoint *points; } GPathInfo;
typedef struct GPath GPath;
GPath *gpath_create(const GPathInfo *init);
void gpath_destroy(GPath *path);
void gpath_draw_filled(GContext *ctx, GPath *path);
void gpath_move_to(GPath *path, GPoint offset);
void gpath_rotate_to(GPath *path, int32_t angle);

/* ---- trigonometry ------------------------------------------------------ */

#define TRIG_MAX_ANGLE 0x10000
#define TRIG_MAX_RATIO 0xffff
#define DEG_TO_TRIGANGLE(angle) (((angle) * TRIG_MAX_ANGLE) / 360)
int32_t sin_lookup(int32_t angle);
int32_t cos_lookup(int32_t angle);

/* ---- app message ------------------------------------------------------- */

typedef enum { APP_MSG_OK = 0, APP_MSG_SEND_TIMEOUT, APP_MSG_BUSY } AppMessageResult;
typedef enum { DICT_OK = 0, DICT_NOT_ENOUGH_STORAGE } DictionaryResult;

typedef struct DictionaryIterator DictionaryIterator;
typedef enum {
  TUPLE_BYTE_ARRAY = 0,
  TUPLE_CSTRING = 1,
  TUPLE_UINT = 2,
  TUPLE_INT = 3,
} TupleType;
typedef struct __attribute__((__packed__)) {
  uint32_t key;
  TupleType type : 8;
  uint16_t length;
  union {
    int8_t int8; uint8_t uint8;
    int16_t int16; uint16_t uint16;
    int32_t int32; uint32_t uint32;
    char cstring[1]; uint8_t data[1];
  } value[1];
} Tuple;

typedef void (*AppMessageInboxReceived)(DictionaryIterator *iterator, void *context);
typedef void (*AppMessageInboxDropped)(AppMessageResult reason, void *context);
typedef void (*AppMessageOutboxSent)(DictionaryIterator *iterator, void *context);
typedef void (*AppMessageOutboxFailed)(DictionaryIterator *iterator, AppMessageResult reason,
                                       void *context);

AppMessageResult app_message_open(const uint32_t size_inbound, const uint32_t size_outbound);
void app_message_register_inbox_received(AppMessageInboxReceived received_callback);
void app_message_register_inbox_dropped(AppMessageInboxDropped dropped_callback);
void app_message_register_outbox_sent(AppMessageOutboxSent sent_callback);
void app_message_register_outbox_failed(AppMessageOutboxFailed failed_callback);
uint32_t app_message_inbox_size_maximum(void);
uint32_t app_message_outbox_size_maximum(void);
AppMessageResult app_message_outbox_begin(DictionaryIterator **iterator);
AppMessageResult app_message_outbox_send(void);
Tuple *dict_find(const DictionaryIterator *iter, const uint32_t key);
DictionaryResult dict_write_uint8(DictionaryIterator *iter, const uint32_t key, const uint8_t value);
DictionaryResult dict_write_int8(DictionaryIterator *iter, const uint32_t key, const int8_t value);

/*
 * Generated from package.json messageKeys by the real build.  These are
 * runtime `uint32_t` variables, NOT compile-time constants -- the generated
 * message_keys.auto.c defines them and the loader fixes up their values.  They
 * are declared that way here on purpose: modelling them as #define integers
 * would let a static array initialiser typecheck here and then fail to compile
 * under the real SDK, which is exactly the mistake this header exists to catch.
 */
extern uint32_t MESSAGE_KEY_STATION;
extern uint32_t MESSAGE_KEY_IS_NEAREST;
extern uint32_t MESSAGE_KEY_OBS_EPOCH;
extern uint32_t MESSAGE_KEY_CAT_OVERALL;
extern uint32_t MESSAGE_KEY_CAT_VIS;
extern uint32_t MESSAGE_KEY_CAT_CIG;
extern uint32_t MESSAGE_KEY_WIND_DIR;
extern uint32_t MESSAGE_KEY_WIND_SPD;
extern uint32_t MESSAGE_KEY_WIND_GUST;
extern uint32_t MESSAGE_KEY_VIS_STR;
extern uint32_t MESSAGE_KEY_CIG_STR;
extern uint32_t MESSAGE_KEY_ALTIM_STR;
extern uint32_t MESSAGE_KEY_TEMP_STR;
extern uint32_t MESSAGE_KEY_RWY_IDENT;
extern uint32_t MESSAGE_KEY_RWY_HDG_TRUE;
extern uint32_t MESSAGE_KEY_RWY_LEN_FT;
extern uint32_t MESSAGE_KEY_HW;
extern uint32_t MESSAGE_KEY_XW;
extern uint32_t MESSAGE_KEY_XW_SIDE;
extern uint32_t MESSAGE_KEY_FLAGS;
extern uint32_t MESSAGE_KEY_RAW;
extern uint32_t MESSAGE_KEY_ERROR;
extern uint32_t MESSAGE_KEY_TAF_COUNT;
extern uint32_t MESSAGE_KEY_TAF_VALID;
extern uint32_t MESSAGE_KEY_TAF_ISSUE;
extern uint32_t MESSAGE_KEY_TAF_TIME_0;
extern uint32_t MESSAGE_KEY_TAF_CAT_0;
extern uint32_t MESSAGE_KEY_TAF_TEXT_0;
extern uint32_t MESSAGE_KEY_TAF_TEMPO_CAT_0;
extern uint32_t MESSAGE_KEY_TAF_TIME_1;
extern uint32_t MESSAGE_KEY_TAF_CAT_1;
extern uint32_t MESSAGE_KEY_TAF_TEXT_1;
extern uint32_t MESSAGE_KEY_TAF_TEMPO_CAT_1;
extern uint32_t MESSAGE_KEY_TAF_TIME_2;
extern uint32_t MESSAGE_KEY_TAF_CAT_2;
extern uint32_t MESSAGE_KEY_TAF_TEXT_2;
extern uint32_t MESSAGE_KEY_TAF_TEMPO_CAT_2;
extern uint32_t MESSAGE_KEY_TAF_TIME_3;
extern uint32_t MESSAGE_KEY_TAF_CAT_3;
extern uint32_t MESSAGE_KEY_TAF_TEXT_3;
extern uint32_t MESSAGE_KEY_TAF_TEMPO_CAT_3;
extern uint32_t MESSAGE_KEY_TAF_TIME_4;
extern uint32_t MESSAGE_KEY_TAF_CAT_4;
extern uint32_t MESSAGE_KEY_TAF_TEXT_4;
extern uint32_t MESSAGE_KEY_TAF_TEMPO_CAT_4;
extern uint32_t MESSAGE_KEY_TAF_TIME_5;
extern uint32_t MESSAGE_KEY_TAF_CAT_5;
extern uint32_t MESSAGE_KEY_TAF_TEXT_5;
extern uint32_t MESSAGE_KEY_TAF_TEMPO_CAT_5;
extern uint32_t MESSAGE_KEY_SET_STALE_AMBER;
extern uint32_t MESSAGE_KEY_SET_STALE_RED;
extern uint32_t MESSAGE_KEY_SET_START_PAGE;
extern uint32_t MESSAGE_KEY_SET_SHOW_RAW;
extern uint32_t MESSAGE_KEY_SET_TAF_PERIODS;
extern uint32_t MESSAGE_KEY_SET_FLICK_NEAREST;
extern uint32_t MESSAGE_KEY_SET_BACKLIGHT_FLICK;
extern uint32_t MESSAGE_KEY_SET_VIBE_CAT_CHANGE;
extern uint32_t MESSAGE_KEY_SET_STATION_COUNT;
extern uint32_t MESSAGE_KEY_REQ_FETCH;
extern uint32_t MESSAGE_KEY_REQ_TAF;
extern uint32_t MESSAGE_KEY_REQ_NEAREST;
extern uint32_t MESSAGE_KEY_REQ_STATION_INDEX;
extern uint32_t MESSAGE_KEY_STATUS;
extern uint32_t MESSAGE_KEY_TAF_STATION;

/* ---- storage, sensors, misc -------------------------------------------- */

#define PERSIST_DATA_MAX_LENGTH 256
bool persist_exists(const uint32_t key);
int persist_read_data(const uint32_t key, void *buffer, const size_t buffer_size);
int persist_write_data(const uint32_t key, const void *data, const size_t size);

typedef enum { ACCEL_AXIS_X = 0, ACCEL_AXIS_Y, ACCEL_AXIS_Z } AccelAxisType;
typedef void (*AccelTapHandler)(AccelAxisType axis, int32_t direction);
void accel_tap_service_subscribe(AccelTapHandler handler);
void accel_tap_service_unsubscribe(void);

void light_enable_interaction(void);
void vibes_short_pulse(void);
void vibes_double_pulse(void);

typedef struct AppTimer AppTimer;
typedef void (*AppTimerCallback)(void *data);
AppTimer *app_timer_register(uint32_t timeout_ms, AppTimerCallback callback, void *callback_data);
bool app_timer_reschedule(AppTimer *timer, uint32_t new_timeout_ms);
void app_timer_cancel(AppTimer *timer);

typedef enum { SECOND_UNIT = 1, MINUTE_UNIT = 2, HOUR_UNIT = 4, DAY_UNIT = 8 } TimeUnits;
typedef void (*TickHandler)(struct tm *tick_time, TimeUnits units_changed);
void tick_timer_service_subscribe(TimeUnits tick_units, TickHandler handler);
void tick_timer_service_unsubscribe(void);

bool connection_service_peek_pebble_app_connection(void);
typedef void (*ConnectionHandler)(bool connected);
typedef struct ConnectionHandlers {
  ConnectionHandler pebble_app_connection_handler;
  ConnectionHandler pebblekit_connection_handler;
} ConnectionHandlers;
void connection_service_subscribe(ConnectionHandlers conn_handlers);
void connection_service_unsubscribe(void);

uint16_t time_ms(time_t *tloc, uint16_t *out_ms);

void app_event_loop(void);

typedef enum { APP_LOG_LEVEL_ERROR = 1, APP_LOG_LEVEL_INFO = 50, APP_LOG_LEVEL_DEBUG = 100 } AppLogLevel;
void app_log(uint8_t log_level, const char *src_filename, int src_line_number,
             const char *fmt, ...);
#define APP_LOG(level, fmt, args...) app_log(level, __FILE_NAME__, __LINE__, fmt, ##args)
#ifndef __FILE_NAME__
#define __FILE_NAME__ __FILE__
#endif

#endif /* PEBBLE_STUB_H */
