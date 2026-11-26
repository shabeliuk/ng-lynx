/**
 * `lynxEnter` / `lynxLeave` — enter and leave animations for elements Angular adds
 * and removes, with CSS classes. What Angular's own `animate.enter` /
 * `animate.leave` do on the web, and vue-lynx's `<Transition>` does for Vue.
 *
 * Angular's `animate.enter` and `animate.leave` compile, but do nothing on Lynx:
 * `@angular/core` decides when it loads that animations are supported only where
 * `document.documentElement.getAnimations` exists, and times them with
 * `getComputedStyle` and `getAnimations()`. The Background Thread, where Angular
 * runs, has none of those. Lynx runs the animation itself from the CSS, and tells
 * the element when it's over: `animationend` and `transitionend` are element
 * events, as on the web. So the classes are what these directives set, and those
 * events are what they wait for. See docs/33-animations.md.
 *
 * A leave keeps the element on screen after Angular removes it: Angular has
 * detached it from its view, and the renderer holds back the element's REMOVE and
 * DESTROY ops until its animation is over (`startLeave`, called by
 * `LynxRenderer2.removeChild`).
 */
import { Directive, ElementRef, inject, Input, type OnInit, Renderer2 } from '@angular/core';

import { OP } from 'ng-lynx/internal/ops';

import { addElementListener } from './element-events.js';
import { scheduleFlush } from './flush.js';
import { pushOp } from './ops.js';
import { clearPendingStyleClass, markClassDirty } from './pending-style.js';
import type { ShadowElement } from './shadow-element.js';

/**
 * How long an enter or a leave waits for its `animationend` or `transitionend`
 * before it ends anyway: for classes with no animation in them, and for an
 * animation the engine ends without an event. Angular's `animate.leave` waits
 * 4 seconds at most; this is shorter, since there's no computed style to read
 * the real duration from. Set it to your animation's length for an exact end.
 */
export const DEFAULT_TRANSITION_TIMEOUT = 2000;

const END_EVENTS = ['animationend', 'transitionend'] as const;

function classList(value: string | null | undefined): string[] {
  return (value ?? '').split(/\s+/).filter(Boolean);
}

/** Whether an event is the element's own, not one bubbled up from a child's animation. */
function isOwnEvent(event: unknown): boolean {
  if (event === null || typeof event !== 'object') return true;
  const { target, currentTarget } = event as { target?: { uid?: unknown }; currentTarget?: { uid?: unknown } };
  if (target?.uid == null || currentTarget?.uid == null) return true;
  return target.uid === currentTarget.uid;
}

/**
 * Wait for the element's own `animationend` or `transitionend`, or `timeout` ms,
 * whichever is first, then call `done` once.
 */
function whenAnimationEnds(el: ShadowElement, timeout: number, done: () => void): () => void {
  let finished = false;
  const unlisteners: (() => void)[] = [];
  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const unlisten of unlisteners) unlisten();
    done();
  };
  for (const name of END_EVENTS) {
    unlisteners.push(addElementListener(el, 'bindEvent', name, (event) => {
      if (isOwnEvent(event)) finish();
    }));
  }
  const timer = setTimeout(finish, Math.max(0, timeout));
  return finish;
}

// ---------------------------------------------------------------------------
// Leave: the renderer's side
// ---------------------------------------------------------------------------

/** What a leave needs, read when the element is removed: a bound `[lynxLeave]` may change. */
interface LeaveSpec {
  lynxLeave: string;
  lynxLeaveTimeout: number;
}

const leaveSpecs = new WeakMap<ShadowElement, LeaveSpec>();
/** Nodes of a leaving subtree: still on the Main Thread, so not destroyed yet. */
const leaving = new WeakSet<ShadowElement>();

/** Whether `destroyNode` must leave this node alone for now: it's still leaving. */
export function isLeaving(node: ShadowElement): boolean {
  return leaving.has(node);
}

/**
 * Called by `LynxRenderer2.removeChild` once Angular has detached `el` from
 * `parentId`. Returns `false` when the element has no leave animation, for the
 * renderer to remove it now. Otherwise the leave classes go on, and the REMOVE
 * and the DESTROY of its subtree follow when the animation is over.
 */
export function startLeave(
  el: ShadowElement,
  parentId: number,
  destroySubtree: (node: ShadowElement) => void,
): boolean {
  const spec = leaveSpecs.get(el);
  const classes = classList(spec?.lynxLeave);
  if (!spec || classes.length === 0) return false;
  leaveSpecs.delete(el);

  const stack = [el];
  while (stack.length > 0) {
    const n = stack.pop()!;
    leaving.add(n);
    for (let c = n.firstChild; c; c = c.next) stack.push(c);
  }

  for (const name of classes) el.classes.add(name);
  markClassDirty(el);

  whenAnimationEnds(el, spec.lynxLeaveTimeout, () => {
    pushOp(OP.REMOVE, parentId, el.id);
    const nodes = [el];
    while (nodes.length > 0) {
      const n = nodes.pop()!;
      leaving.delete(n);
      for (let c = n.firstChild; c; c = c.next) nodes.push(c);
    }
    clearPendingStyleClass(el);
    destroySubtree(el);
    scheduleFlush();
  });
  scheduleFlush();
  return true;
}

// ---------------------------------------------------------------------------
// The directives
// ---------------------------------------------------------------------------

/**
 * Animate an element in when Angular creates it: the classes go on with it, and
 * come off when its own `animationend` or `transitionend` arrives, or after
 * `lynxEnterTimeout` ms. Give the class a CSS `animation`:
 *
 * ```css
 * .fade-in { animation: fade-in 250ms ease-out; }
 * @keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
 * ```
 *
 * ```html
 * @if (open()) {
 *   <view class="panel" lynxEnter="fade-in" lynxLeave="fade-out">…</view>
 * }
 * ```
 *
 * It runs on the first render too, as Angular's `animate.enter` does.
 *
 * @experimental
 */
@Directive({ selector: '[lynxEnter]', standalone: true })
export class LynxEnter implements OnInit {
  /** The classes to animate in with, separated by spaces. */
  @Input({ required: true }) lynxEnter = '';
  /** How long to wait for the animation's end event, in milliseconds. */
  @Input() lynxEnterTimeout = DEFAULT_TRANSITION_TIMEOUT;

  private readonly host = inject<ElementRef<ShadowElement>>(ElementRef).nativeElement;
  private readonly renderer = inject(Renderer2);

  ngOnInit(): void {
    const classes = classList(this.lynxEnter);
    if (classes.length === 0) return;
    for (const name of classes) this.renderer.addClass(this.host, name);
    whenAnimationEnds(this.host, this.lynxEnterTimeout, () => {
      for (const name of classes) this.renderer.removeClass(this.host, name);
    });
  }
}

/**
 * Animate an element out when Angular removes it: the classes go on, and the
 * element stays on screen until its own `animationend` or `transitionend`
 * arrives, or `lynxLeaveTimeout` ms pass. Give the class a CSS `animation` that
 * ends where the element should disappear, or a `transition`:
 *
 * ```css
 * .fade-out { animation: fade-out 200ms ease-in forwards; }
 * @keyframes fade-out { from { opacity: 1; } to { opacity: 0; } }
 * ```
 *
 * Put it on an element Angular removes itself: one directly inside an `@if`,
 * `@for` or `@switch` block, or a component's root. An element inside one of
 * those is removed with its parent, at once.
 *
 * Elements under a `<list>` aren't animated: the list removes its own items.
 *
 * @experimental
 */
@Directive({ selector: '[lynxLeave]', standalone: true })
export class LynxLeave implements OnInit {
  /** The classes to animate out with, separated by spaces. */
  @Input({ required: true }) lynxLeave = '';
  /** How long to keep the element for its animation's end event, in milliseconds. */
  @Input() lynxLeaveTimeout = DEFAULT_TRANSITION_TIMEOUT;

  private readonly host = inject<ElementRef<ShadowElement>>(ElementRef).nativeElement;

  ngOnInit(): void {
    leaveSpecs.set(this.host, this);
  }
}
