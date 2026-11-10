/**
 * Main-thread worklets for the example.
 *
 * This module runs on the **Main Thread** (it's listed in `mainThreadModules` in
 * lynx.config.ts). `defineWorklet` registers each worklet AND returns a typed
 * reference; the component imports the reference and binds it directly via
 * `[lynxMainThread]="{ event: ref }"` — no magic string to keep in sync.
 *
 * The worklet's registry id comes from its function's own `.name` — give it a
 * name (a `function` declaration, as below), not an anonymous arrow, which
 * has no name to derive one from even when assigned to a `const` (naming from
 * an assignment only applies when the function is its *direct* right-hand
 * side, not when it's passed as an argument to `defineWorklet(...)`, which is
 * what happens here). Pass an explicit id as `defineWorklet('id', fn)` instead
 * if you'd rather keep an anonymous function.
 */
import {
  defineMainThreadFunction,
  defineMainThreadRef,
  defineWorklet,
  lynxAnimate,
  mainThreadLynx,
  type MainThreadGestureEvent,
  type WorkletContext,
} from 'angular-lynx/worklet';

// A main-thread ref to the card, so a worklet on *another* element can reach it.
export const cardRef = defineMainThreadRef('card');

// Dim the pressed element instantly on the Main Thread (via ctx — the bound
// element), then tell the Background Thread it was pressed. Always sets the
// SAME fixed value — it's not a toggle — so a second tap re-applies 0.5 and
// looks like nothing happened; the tap count below still goes up every time,
// since that's a separate runOnBackground call regardless of the style result.
function pressFadeMT(ctx: WorkletContext): void {
  ctx.setStyle('opacity: 0.5');
  ctx.runOnBackground({ at: Date.now() });
}
export const pressFade = defineWorklet(pressFadeMT);

// Bound to the *Reset* button, but restores the *card* through the ref —
// demonstrating cross-element main-thread access with zero BG round-trip.
function resetCardMT(): void {
  cardRef.current?.setStyle('opacity: 1');
}
export const resetCard = defineWorklet(resetCardMT);

// Bound to the *Fade* button, mutating the *card* through the same ref —
// but via `lynxAnimate`: real timer-driven interpolation on
// the Main Thread over 400ms, not a single setStyle snapshot (and not a CSS
// transition — Lynx has no runtime CSS injection, see docs/13-styling.md).
// Restore with the *Reset* button above (a plain, instant setStyle).
function fadeCardMT(): void {
  if (!cardRef.current) return;
  lynxAnimate(cardRef.current, (v) => `opacity: ${v};`, { from: 1, to: 0.15, duration: 400 });
}
export const fadeCard = defineWorklet(fadeCardMT);

// A native gesture, through `[lynxGesture]`: drag the chip sideways. Each phase
// tells the Background Thread, so the page can show what the engine fired.
export const chipRef = defineMainThreadRef('chip');
const chipGrabX = defineMainThreadRef('chipGrabX', 0);
const chipX = defineMainThreadRef('chipX', 0);

function onPanStartMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  chipGrabX.current = ctx.event.params.clientX - chipX.current;
  chipRef.current?.setStyleProperty('opacity', '0.6');
  ctx.runOnBackground('onStart');
}
export const onPanStart = defineWorklet(onPanStartMT);

function onPanUpdateMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  chipX.current = ctx.event.params.clientX - chipGrabX.current;
  chipRef.current?.setStyleProperty('transform', `translateX(${chipX.current}px)`);
  ctx.runOnBackground('onUpdate');
}
export const onPanUpdate = defineWorklet(onPanUpdateMT);

function onPanEndMT(ctx: WorkletContext<MainThreadGestureEvent>): void {
  chipRef.current?.setStyleProperty('opacity', '1');
  ctx.runOnBackground('onEnd');
}
export const onPanEnd = defineWorklet(onPanEndMT);

// Called from the Background Thread with `runOnMainThread`, which gets the result
// back. Uses `MainThread.Element` on a real element and reports what each call gave.
export const checkElementApi = defineMainThreadFunction(async function checkElementApiMT() {
  const box = mainThreadLynx.querySelector('.api-box');
  if (!box) return 'querySelector found nothing';
  box.setAttribute('checked-by', 'worklet');
  box.setStyleProperties({ 'border-width': '2px', 'border-style': 'solid', 'border-color': '#ffffff' });
  box.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 600 });
  const scroller = box.querySelector('.api-scroll');
  const scrolled = await scroller?.invoke('scrollTo', { offset: 40 }).then(
    () => 'ok',
    (err: Error) => err.message,
  );
  return [
    `attribute ${String(box.getAttribute('checked-by'))}`,
    `names ${box.getAttributeNames().includes('checked-by')}`,
    `items ${box.querySelectorAll('.api-item').length}`,
    `scrollTo ${String(scrolled)}`,
    `text width ${mainThreadLynx.getTextInfo('Lynx', { fontSize: '14px' }).width > 0}`,
    `border ${box.getComputedStyleProperty('border-top-width')}`,
  ].join(', ');
});
