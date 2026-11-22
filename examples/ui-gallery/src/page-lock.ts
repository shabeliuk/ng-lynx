import { mainThreadRef } from 'ng-lynx';
import type { MainThreadElement } from 'ng-lynx/worklet';

/**
 * The page's `<scroll-view>`, for the drag demos to stop it scrolling under a drag.
 *
 * `app.component.ts` binds it with `[lynxMainThreadRef]`, and each demo passes it to
 * its worklets, which call `lockPage`/`unlockPage` (`page-lock.mt.ts`) on the Main
 * Thread. So the page stops on the touch that starts the drag, not after a round
 * trip to the Background Thread, as it did when the demos switched `[enable-scroll]`
 * through a signal.
 *
 * Why it's needed at all: `pan-intercept-*` and `catch` events don't stop the
 * page reliably. A native `<scroll-view>` recognizes its own pan, and on a real
 * iPhone a drag in a demo sometimes scrolled the page too (docs/37-ui-gallery.md).
 *
 * A ref made outside a component lives as long as the page, which this one does.
 */
export const pageScroll = mainThreadRef<MainThreadElement | null>();
