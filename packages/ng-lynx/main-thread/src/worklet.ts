/**
 * `ng-lynx/worklet`: the Main-Thread API for worklets, refs, functions called
 * across the threads, and the Main-Thread `lynx` object. Import it from a
 * Main-Thread module (`mainThreadModules`). See docs/11-worklets.md.
 *
 * A facade over worklet-apply.ts, whose op handlers (`applySetRef`, …) are
 * the Main-Thread executor's, not the app's.
 */
export type { LynxDataProcessor, LynxDataProcessorDefinition } from './data-processors.js';
export type { MainThreadAnimation, MainThreadAnimationOptions, MainThreadElement } from './worklet-runtime/element.js';
export {
  bindWorklet,
  defineMainThreadFunction,
  defineMainThreadRef,
  defineWorklet,
  lynxAnimate,
  lynxTween,
  mainThreadLynx,
  registerWorklet,
  runOnBackground,
  type BackgroundFunctionHandle,
  type BoundWorklet,
  type LynxAnimateOptions,
  type LynxAnimationHandle,
  type LynxTweenOptions,
  type MainThreadEvent,
  type MainThreadEventTarget,
  type MainThreadFlingGestureEvent,
  type MainThreadFunctionHandle,
  type MainThreadGesture,
  type MainThreadGestureEvent,
  type MainThreadRef,
  type MainThreadRefHandle,
  type MainThreadScrollResult,
  type MainThreadTouch,
  type MainThreadTouchEvent,
  type ToMainThread,
  type Worklet,
  type WorkletContext,
  type WorkletHandle,
  ɵregisterInlineMainThread,
} from './worklet-apply.js';
