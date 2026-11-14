#include "avwx.h"
#include "gesture.h"

/*
 * Airport Wx for the Pebble Time 2.
 *
 * Not a flight planning tool.  See README.md and the disclaimer in settings:
 * this is a convenience display of publicly available weather, the runway it
 * shows is a guess rather than the active one, and no part of it substitutes
 * for an official briefing.
 */

static AppState s_state;
static Window *s_window;
static Layer *s_page_layer;

/* Ignore the tap from the motion of raising your wrist to look at the watch. */
#define TAP_IGNORE_AFTER_LAUNCH_S 2
#define TAP_DEBOUNCE_S 3
#define TOAST_S 2
#define SCROLL_STEP 24

/* The loading indicator turns one step per frame while anything is in flight. */
#define BUSY_FRAME_MS 100
#define BUSY_FRAMES 12
/* A busy state the phone never resolved -- a lost message, a phone that went
 * quiet -- is dropped after this long rather than spinning forever.  Longer
 * than a GPS fix (10 s) plus a request (15 s), which is the slowest real case. */
#define BUSY_TIMEOUT_MS 30000

static time_t s_launched_at;
static time_t s_last_tap;
static AppTimer *s_toast_timer;
static AppTimer *s_busy_frame_timer;
static AppTimer *s_busy_timeout;
static uint8_t s_busy_frame;

AppState *state(void) {
  return &s_state;
}

void app_refresh_display(void) {
  if (s_page_layer) layer_mark_dirty(s_page_layer);
}

static void toast_expired(void *data) {
  s_toast_timer = NULL;
  s_state.toast[0] = '\0';
  app_refresh_display();
}

void app_toast(const char *message) {
  strncpy(s_state.toast, message, sizeof(s_state.toast) - 1);
  s_state.toast[sizeof(s_state.toast) - 1] = '\0';
  s_state.toast_until = time(NULL) + TOAST_S;
  /* The page only redraws when something changes, so the toast needs its own
   * timer to take itself back off the screen. */
  if (s_toast_timer) app_timer_cancel(s_toast_timer);
  s_toast_timer = app_timer_register(TOAST_S * 1000, toast_expired, NULL);
  app_refresh_display();
}

/* ---- loading indicator ---------------------------------------------------- */

uint8_t busy_frame(void) {
  return s_busy_frame;
}

static void busy_frame_tick(void *data) {
  s_busy_frame_timer = NULL;
  if (!s_state.busy) return;
  s_busy_frame = (uint8_t)((s_busy_frame + 1) % BUSY_FRAMES);
  app_refresh_display();
  s_busy_frame_timer = app_timer_register(BUSY_FRAME_MS, busy_frame_tick, NULL);
}

static void busy_timed_out(void *data) {
  s_busy_timeout = NULL;
  app_set_busy(0);
}

void app_set_busy(uint8_t mask) {
  bool was_busy = s_state.busy != 0;
  s_state.busy = mask;

  if (mask) {
    /* Every report of work in progress restarts the clock, so only a busy
     * state nobody has mentioned for BUSY_TIMEOUT_MS is given up on. */
    if (s_busy_timeout) app_timer_reschedule(s_busy_timeout, BUSY_TIMEOUT_MS);
    else s_busy_timeout = app_timer_register(BUSY_TIMEOUT_MS, busy_timed_out, NULL);
    if (!s_busy_frame_timer) {
      s_busy_frame_timer = app_timer_register(BUSY_FRAME_MS, busy_frame_tick, NULL);
    }
  } else {
    if (s_busy_timeout) app_timer_cancel(s_busy_timeout);
    s_busy_timeout = NULL;
    if (s_busy_frame_timer) app_timer_cancel(s_busy_frame_timer);
    s_busy_frame_timer = NULL;
  }
  if (was_busy != (mask != 0)) app_refresh_display();
}

void app_add_busy(uint8_t bits) {
  app_set_busy(s_state.busy | bits);
}

/* ---- the forecast follows the station ---------------------------------- */

void app_station_changed(void) {
  Forecast *f = &s_state.taf;
  /* Whatever forecast is held belongs to the station that was on screen. */
  if (f->have_data && strcmp(f->station, s_state.obs.station) != 0) {
    memset(f, 0, sizeof(*f));
  }
  /* The TAF page asks for its forecast when it opens.  If the station changes
   * under it -- Up/Down, a nearest lookup, or the app opening straight onto
   * this page -- it has to ask again, or it sits on FETCHING for good. */
  if (s_state.page == PAGE_TAF && !f->have_data && !(s_state.busy & BUSY_TAF)) {
    comm_request_taf();
  }
}

static void page_update_proc(Layer *layer, GContext *ctx) {
  switch (s_state.page) {
    case PAGE_WIND: page_wind_draw(layer, ctx); break;
    case PAGE_TAF:  page_taf_draw(layer, ctx); break;
    case PAGE_RAW:  page_raw_draw(layer, ctx); break;
    case PAGE_HOME:
    default:        page_home_draw(layer, ctx); break;
  }

  if (s_state.toast[0] && time(NULL) < s_state.toast_until) {
    GRect bounds = layer_get_bounds(layer);
    GRect box = GRect(SX(bounds, 20), SY(bounds, 96), bounds.size.w - SX(bounds, 40),
                      SY(bounds, 32));
    graphics_context_set_fill_color(ctx, GColorDarkGray);
    graphics_fill_rect(ctx, box, 4, GCornersAll);
    draw_centred_text(ctx, s_state.toast, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD),
                      box, GTextAlignmentCenter, GColorWhite);
  }
}

static void go_to_page(Page page) {
  s_state.page = page;
  s_state.raw_scroll = 0;
  /* The TAF is a second request, so it is only made when the page that needs
   * it is actually opened. */
  if (page == PAGE_TAF && !s_state.taf.have_data && !(s_state.busy & BUSY_TAF)) {
    comm_request_taf();
  }
  app_refresh_display();
}

static Page next_page(Page page) {
  Page next = (Page)((page + 1) % PAGE_COUNT);
  if (next == PAGE_RAW && !s_state.settings.show_raw) next = PAGE_HOME;
  return next;
}

static Page prev_page(Page page) {
  Page prev = (Page)((page + PAGE_COUNT - 1) % PAGE_COUNT);
  if (prev == PAGE_RAW && !s_state.settings.show_raw) prev = PAGE_TAF;
  return prev;
}

static void set_raw_scroll(int16_t offset) {
  int16_t max = page_raw_overflow(layer_get_bounds(s_page_layer));
  if (offset > max) offset = max;
  if (offset < 0) offset = 0;
  if (offset == s_state.raw_scroll) return;
  s_state.raw_scroll = offset;
  app_refresh_display();
}

/* Fetch the station on screen again, and its forecast if that is what is on
 * screen.  One request, so the outbox is not asked to hold two. */
static void refresh_now(void) {
  comm_request_refresh(s_state.page == PAGE_TAF);
}

static void click_select(ClickRecognizerRef recognizer, void *context) {
  go_to_page(next_page(s_state.page));
}

static void click_select_long(ClickRecognizerRef recognizer, void *context) {
  comm_request_nearest();
}

static void click_back(ClickRecognizerRef recognizer, void *context) {
  /* Back returns to Home from anywhere else, and only exits from Home.  This
   * overrides the default, which would exit from any page. */
  if (s_state.page != PAGE_HOME) {
    go_to_page(PAGE_HOME);
    return;
  }
  window_stack_pop_all(true);
}

/* Up and Down cycle stations -- except on the raw page, where they scroll the
 * report that is under them. */
static void step_station(int8_t delta) {
  /* station_count is 0 until the first settings message lands; only refuse to
   * cycle once we actually know there is nowhere to cycle to.  On a nearest
   * station there is always somewhere to go: back to the pinned one.  Refusing
   * there left a one-airport user stuck on NRST until it timed out -- or for
   * good, with the revert set to never. */
  if (s_state.settings.station_count == 1 && !s_state.obs.is_nearest) {
    app_toast("ONE STATION");
    return;
  }
  comm_request_station_step(delta);
}

static void step(int8_t delta) {
  if (s_state.page == PAGE_RAW) {
    set_raw_scroll((int16_t)(s_state.raw_scroll + delta * SCROLL_STEP));
    return;
  }
  step_station(delta);
}

static void click_up(ClickRecognizerRef recognizer, void *context) {
  step(-1);
}

static void click_down(ClickRecognizerRef recognizer, void *context) {
  step(1);
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, click_select);
  window_single_click_subscribe(BUTTON_ID_UP, click_up);
  window_single_click_subscribe(BUTTON_ID_DOWN, click_down);
  window_single_click_subscribe(BUTTON_ID_BACK, click_back);
  window_long_click_subscribe(BUTTON_ID_SELECT, 700, click_select_long, NULL);
}

static void tap_handler(AccelAxisType axis, int32_t direction) {
  if (!s_state.settings.flick_nearest) return;
  time_t now = time(NULL);
  if (now - s_launched_at < TAP_IGNORE_AFTER_LAUNCH_S) return;
  if (now - s_last_tap < TAP_DEBOUNCE_S) return;
  s_last_tap = now;
  if (s_state.settings.backlight_on_flick) light_enable_interaction();
  comm_request_nearest();
}

/* The age in the header counts up on its own, with or without a phone. */
static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  app_refresh_display();
}

/* A phone that has gone away cannot deliver what it was fetching, and the
 * header's disconnected mark should not wait for the next minute to appear. */
static void phone_connection_handler(bool connected) {
  if (!connected) app_set_busy(0);
  app_refresh_display();
}

#if defined(PBL_TOUCH)
/*
 * Touch, on the Pebble Time 2.  The same actions as the buttons, by the
 * gestures a touchscreen user tries first:
 *
 *   swipe left / right   next / previous page   (Select)
 *   drag up / down       next / previous station (Down / Up)
 *                        -- on the raw page, scroll the report instead
 *   tap                  fetch again now
 *
 * Long-press has no touch equivalent here; nearest stays on Select-held and
 * the flick.  Back stays on its button, so leaving the app is never a gesture
 * you can make by accident.
 *
 * What a touch was is decided when the finger lifts, by gesture_classify()
 * in gesture.c.  The one thing that happens while the finger is still down is
 * scrolling the raw page, so the report moves with it.
 */

static struct {
  bool active;           /* a finger is down and this gesture is ours */
  bool scrolling;        /* the raw page is following the finger */
  GPoint start;
  GPoint last;
  int16_t scroll_base;   /* raw_scroll at touchdown */
  time_t down_s;
  uint16_t down_ms;
} s_touch;

static uint32_t ms_since(time_t s, uint16_t ms) {
  time_t now_s;
  uint16_t now_ms;
  time_ms(&now_s, &now_ms);
  int32_t elapsed = (int32_t)(now_s - s) * 1000 + (int32_t)now_ms - (int32_t)ms;
  return elapsed < 0 ? 0 : (uint32_t)elapsed;
}

static void touch_finished(void) {
  int16_t dx = (int16_t)(s_touch.last.x - s_touch.start.x);
  int16_t dy = (int16_t)(s_touch.last.y - s_touch.start.y);
  /* The raw page already followed the finger; the drag is done. */
  if (s_touch.scrolling) return;

  Gesture gesture = gesture_classify(dx, dy, ms_since(s_touch.down_s, s_touch.down_ms));
  /* `pebble logs` shows what each touch was taken as, which is the first
   * question when a gesture does not do what was expected. */
  APP_LOG(APP_LOG_LEVEL_DEBUG, "touch: dx=%d dy=%d -> gesture %d", dx, dy, (int)gesture);
  switch (gesture) {
    case GESTURE_TAP:         refresh_now(); break;
    /* Content follows the finger: swiping left brings the next page in from
     * the right. */
    case GESTURE_SWIPE_LEFT:  go_to_page(next_page(s_state.page)); break;
    case GESTURE_SWIPE_RIGHT: go_to_page(prev_page(s_state.page)); break;
    /* Drag up for the next station, as in a list: the same as Down. */
    case GESTURE_DRAG_UP:     step_station(1); break;
    case GESTURE_DRAG_DOWN:   step_station(-1); break;
    case GESTURE_NONE:
    default:                  break;
  }
}

static void touch_handler(const TouchEvent *event, void *context) {
  GPoint at = GPoint(event->x, event->y);
  switch (event->type) {
    case TouchEvent_Touchdown:
      /* The system marks touches that must not drive navigation -- contact
       * made before the watch was woken for interaction.  Leave those be. */
      s_touch.active = !event->non_navigational;
      s_touch.scrolling = false;
      s_touch.start = at;
      s_touch.last = at;
      s_touch.scroll_base = s_state.raw_scroll;
      time_ms(&s_touch.down_s, &s_touch.down_ms);
      break;

    case TouchEvent_PositionUpdate:
      if (!s_touch.active) break;
      s_touch.last = at;
      if (s_state.page == PAGE_RAW &&
          (s_touch.scrolling ||
           gesture_is_vertical_drag((int16_t)(at.x - s_touch.start.x),
                                    (int16_t)(at.y - s_touch.start.y)))) {
        /* The report moves with the finger: dragging up reveals what is
         * below. */
        s_touch.scrolling = true;
        set_raw_scroll((int16_t)(s_touch.scroll_base - (at.y - s_touch.start.y)));
      }
      break;

    case TouchEvent_Liftoff:
      if (!s_touch.active) break;
      s_touch.active = false;
      s_touch.last = at;
      touch_finished();
      break;

    default:
      break;
  }
}

static void touch_attach(Window *window) {
  /* This window handles its own touches.  Without this the system's
   * touch-to-button bridge may turn them into button presses as well. */
  window_set_touch_bridge_disabled(window, true);
  touch_service_subscribe(touch_handler, NULL);
}

static void touch_detach(void) {
  touch_service_unsubscribe();
}
#endif

static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(root);
  s_page_layer = layer_create(bounds);
  layer_set_update_proc(s_page_layer, page_update_proc);
  layer_add_child(root, s_page_layer);
#if defined(PBL_TOUCH)
  touch_attach(window);
#endif
}

static void window_unload(Window *window) {
#if defined(PBL_TOUCH)
  touch_detach();
#endif
  layer_destroy(s_page_layer);
  s_page_layer = NULL;
}

static void init(void) {
  s_launched_at = time(NULL);
  memset(&s_state, 0, sizeof(s_state));
  persist_load();

  s_window = window_create();
  window_set_background_color(s_window, GColorBlack);
  window_set_click_config_provider(s_window, click_config_provider);
  window_set_window_handlers(s_window, (WindowHandlers){
    .load = window_load,
    .unload = window_unload
  });
  window_stack_push(s_window, true);

  comm_init();
  accel_tap_service_subscribe(tap_handler);
  tick_timer_service_subscribe(MINUTE_UNIT, tick_handler);
  connection_service_subscribe((ConnectionHandlers){
    .pebble_app_connection_handler = phone_connection_handler
  });

  /* The phone fetches as soon as its side of the app starts, which the watch
   * cannot see.  Show the indicator from launch so the first seconds do not
   * look idle; the phone's first message corrects it either way. */
  if (connection_service_peek_pebble_app_connection()) app_add_busy(BUSY_OBS);
}

static void deinit(void) {
  if (s_toast_timer) app_timer_cancel(s_toast_timer);
  app_set_busy(0);
  connection_service_unsubscribe();
  persist_save();
  tick_timer_service_unsubscribe();
  accel_tap_service_unsubscribe();
  comm_deinit();
  /* window_destroy runs the unload handler, which owns the page layer. */
  window_destroy(s_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
  return 0;
}
