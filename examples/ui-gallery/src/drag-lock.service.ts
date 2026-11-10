import { computed, signal } from '@angular/core';

/**
 * Shared "is any nested gesture demo currently mid-drag" flag, so
 * `app.component.ts`'s ancestor `.app-scroll` can disable itself for the
 * duration.
 *
 * **Still needed.** `pan-intercept-direction` + `pan-intercept-scope` on the
 * drag surface (iOS 3.4+, Android 3.6+; see docs/32-gestures.md) is the
 * declarative way, but Draggable moved to it alone and, on a real iPhone, a drag
 * sometimes still scrolled the page. So every drag demo locks here, and
 * Draggable keeps `pan-intercept-*` as well.
 *
 * `(catchtouchmove)` (Lynx's `stopPropagation()` — see docs/12-events.md)
 * was tried first and looked correct on paper: it stops the touch event from
 * *bubbling* to the ancestor `<scroll-view>`. **Confirmed on a real device
 * not to be enough** — the page still scrolled underneath an active drag.
 * The likely explanation: a native `<scroll-view>`'s own pan-gesture
 * recognition happens at the native/Main-Thread layer, which isn't
 * necessarily gated by Background-Thread JS event bubbling at all — `catch`
 * stops a *JS listener* on the ancestor from firing, not necessarily the
 * ancestor's own native scroll recognizer from claiming the touch. This
 * module targets the scroll-view directly instead: `[enable-scroll]` is a
 * plain (non-`initial-*`) boolean input, so it's expected to be live-
 * reactive like every other such flag in this framework, not a one-shot
 * mount-time setting.
 *
 * A counter, not a boolean: defensive against two overlapping
 * lock()/unlock() pairs (e.g. a stray `touchend` never firing for one
 * gesture while another starts) leaving scrolling wrongly disabled forever.
 *
 * **Plain module-level state, not an `@Injectable({ providedIn: 'root' })`
 * service.** That was tried first and failed to even load: the background
 * thread's module registry rejected it with `undefined factory
 * (angular:background)/./src/drag-lock.service.ts`, reproduced after a full
 * dev-server restart with the build cache cleared — a real bundling issue
 * with Ivy's injectable codegen for a brand-new file in this setup, not
 * something worth chasing down for a five-consumer, single-injector-tree,
 * app-local flag. A signal doesn't need DI to be shared; a plain exported
 * one works identically here and sidesteps the whole problem.
 */
const lockCount = signal(0);

/** Whether `app.component.ts`'s `.app-scroll` should currently allow scrolling. */
export const dragLockScrollEnabled = computed(() => lockCount() === 0);

export function lockDrag(): void {
  lockCount.update((c) => c + 1);
}

export function unlockDrag(): void {
  lockCount.update((c) => Math.max(0, c - 1));
}
