/**
 * Main-thread gestures (Main-Thread side).
 *
 * Applies a `SET_GESTURE_DETECTOR` op by calling the real `__SetGestureDetector`
 * PAPI directly — unlike a worklet *event* (`SET_WORKLET_EVENT`, routed through
 * `__AddEvent`), a gesture detector has its own dedicated registration call.
 * The gesture's callbacks are ordinary worklets (`{ _wkltId, _workletType:
 * 'main-thread' }` — the same shape `[lynxMainThread]` sends), so no new
 * Main-Thread dispatch mechanism is needed: whatever invokes a gesture-phase
 * callback (the native engine, at gesture-recognition time) resolves it from
 * `lynxWorkletImpl._workletMap` exactly like `runWorklet` already does for a
 * tapped `[lynxMainThread]` binding — see `worklet-apply.ts`'s module doc.
 *
 * @remarks
 * The web preview has only no-op detectors (web-core 0.26), so gestures fire on
 * a device only. Guarded the same way `registerWorklet` guards a missing
 * worklet-runtime, for engines without the PAPI. See docs/32-gestures.md.
 */
import { elements } from './element-registry.js';

declare const __DEV__: boolean;

/** Apply a SET_GESTURE_DETECTOR op: register a native gesture detector on an element. */
export function applySetGestureDetector(
  elId: number,
  gestureId: number,
  gestureType: number,
  config: Record<string, unknown>,
  relationMap: Record<string, unknown>,
): void {
  const el = elements.get(elId);
  if (!el) return;
  if (typeof __SetGestureDetector === 'undefined') {
    if (__DEV__) {
      console.warn(
        '[angular-lynx] [lynxGesture] used, but __SetGestureDetector is unavailable in this '
          + 'environment — this engine (e.g. the web preview) has no native gesture-detector '
          + 'support; the gesture will never fire. See docs/32-gestures.md.',
      );
    }
    return;
  }
  __SetGestureDetector(el, gestureId, gestureType, config, relationMap);
}
