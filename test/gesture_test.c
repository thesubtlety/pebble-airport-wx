/*
 * Host-side test of the touch gesture classifier in src/c/gesture.c.  Built
 * and run by tools/check-c.sh; gesture.c has no SDK dependency, so this is the
 * real code, not a model of it.
 */
#include <stdio.h>
#include "gesture.h"

static int failures = 0;

static void expect(const char *what, Gesture got, Gesture want) {
  if (got != want) {
    printf("FAIL %s: got %d, want %d\n", what, (int)got, (int)want);
    failures++;
  }
}

int main(void) {
  /* A finger that stays put, briefly, is a tap -- wobble included. */
  expect("still finger", gesture_classify(0, 0, 80), GESTURE_TAP);
  expect("tap with a wobble", gesture_classify(6, -7, 120), GESTURE_TAP);
  expect("press and hold is not a tap", gesture_classify(0, 0, 900), GESTURE_NONE);

  /* Horizontal swipes, named by the direction the finger travels. */
  expect("swipe left", gesture_classify(-140, 0, 60), GESTURE_SWIPE_LEFT);
  expect("swipe right", gesture_classify(120, 8, 200), GESTURE_SWIPE_RIGHT);
  expect("a slow swipe still counts", gesture_classify(-60, 5, 1500), GESTURE_SWIPE_LEFT);
  expect("too short to be a swipe", gesture_classify(-25, 0, 60), GESTURE_NONE);

  /* Vertical drags. */
  expect("drag up", gesture_classify(0, -110, 200), GESTURE_DRAG_UP);
  expect("drag down", gesture_classify(4, 45, 300), GESTURE_DRAG_DOWN);
  expect("too short to change station", gesture_classify(0, 20, 100), GESTURE_NONE);

  /* A diagonal is not guessed at: changing airport by accident is worse than
   * doing nothing. */
  expect("diagonal", gesture_classify(60, 60, 150), GESTURE_NONE);
  expect("mostly horizontal but not clearly", gesture_classify(60, 40, 150), GESTURE_NONE);

  /* The raw page starts scrolling once a finger clearly moves vertically. */
  if (!gesture_is_vertical_drag(2, -15)) { printf("FAIL vertical drag not seen\n"); failures++; }
  if (gesture_is_vertical_drag(30, -15)) { printf("FAIL sideways move taken as a drag\n"); failures++; }
  if (gesture_is_vertical_drag(0, 4)) { printf("FAIL a wobble taken as a drag\n"); failures++; }

  if (failures) return 1;
  printf("gesture classifier: all cases pass\n");
  return 0;
}
