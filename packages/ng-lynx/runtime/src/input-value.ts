/**
 * Put text into a Lynx `<input>` / `<textarea>` from code.
 *
 * The native elements (XElement, on iOS and Android) have **no `value`
 * attribute**: the Lynx element reference lists none, and their content is
 * set with the `setValue` UI method. The web preview's elements accept both.
 * So binding `[attr.value]` alone works in the browser and silently does
 * nothing on a device — a pre-filled field shows empty while its model
 * already holds the value (and would submit it), and clearing a field after
 * "Send" leaves the old text. Found running the genui retirement planner as
 * a native iOS app (Sparkling, Lynx 3.9); the web preview could never have
 * shown it.
 *
 * Callers keep their attribute binding and call this too. The web
 * elements implement the same `setValue({ value, index })`, so there is one
 * code path everywhere. The call waits for the pending ops batch to reach the
 * Main Thread, so the element exists when it lands.
 *
 * **A write can still miss, so a failed one is retried.** On Android
 * (Explorer 4.1) a freshly created input sometimes isn't found yet: the call
 * fails with `no node found for selector '[ng-ref-N]'` (code 2), and a
 * pre-filled planner field showed empty. The write is retried a few times
 * (about half a second in all) while the element is still in the page. An
 * element that was removed meanwhile, as a streamed form re-renders, is
 * dropped, and so is a write a newer one for the same element has replaced.
 *
 * @internal
 */
import { whenFlushed } from './flush.js';
import { getPageRoot, type ShadowElement } from './shadow-element.js';

type Target = ShadowElement | null | undefined | (() => ShadowElement | null | undefined);

/** Delays (ms) before each retry of a failed write. */
const RETRY_DELAYS_MS = [16, 50, 150, 300];

/** The latest value written to each element, so a stale retry can step aside. */
const latestValue = new WeakMap<ShadowElement, string>();

export function writeInputValue(target: Target, value: string): void {
  queueMicrotask(() => {
    void whenFlushed().then(() => {
      const element = resolve(target);
      if (!element) return;
      latestValue.set(element, value);
      attempt(element, value, 0);
    });
  });
}

function attempt(element: ShadowElement, value: string, retry: number): void {
  if (latestValue.get(element) !== value || !isInPage(element)) return;
  try {
    element.invoke({
      method: 'setValue',
      // `index` puts the cursor at the end, like typing would.
      params: { value, index: value.length },
      fail: () => {
        const delay = RETRY_DELAYS_MS[retry];
        if (delay !== undefined) setTimeout(() => attempt(element, value, retry + 1), delay);
      },
    });
  } catch {
    // The element went away before the flush landed — nothing to write.
  }
}

function resolve(target: Target): ShadowElement | null | undefined {
  return typeof target === 'function' ? target() : target;
}

/** Still attached under the page root, i.e. not part of a removed subtree. */
function isInPage(element: ShadowElement): boolean {
  let node = element;
  while (node.parent) node = node.parent;
  return node === getPageRoot();
}
