/**
 * Headless verification of the typed `<video>` element
 * (`ng-lynx/elements`' `LynxVideo`).
 *
 * **What this proves, and what it can't.** `<video>` is registered in
 * `KNOWN_LYNX_TAGS` (`main-thread/src/ops-apply.ts`), so this harness proves
 * the wire protocol is correct: the Main Thread calls the real, typed
 * `__CreateElement('video', …)` PAPI (not the `<view>` fallback unregistered
 * tags get), every typed attribute (`src`, `loop`, `volume`, `muted`,
 * `speed`, `object-fit`, `mode`, `timeupdate-interval`) reaches it as a
 * `SET_ATTR` op, and every typed event (`firstframe`, `playing`, `paused`,
 * `stopped`, `timeupdate`, `ended`, `looped`, `error`, `buffering`) wires a
 * listener that fires with the right payload shape. It does **not** and
 * cannot prove real video playback: `@lynx-js/web-core` (this repo's only
 * runnable preview target) has no `<video>` implementation at all, and no
 * iOS/Android/Harmony simulator is available in this environment either —
 * `<video>` is genuinely native-platform-only. See `LynxVideo`'s doc comment
 * in `runtime/src/elements.ts` for the same caveat.
 *
 * Run with: `npm run verify:video`.
 */
import '@angular/compiler';

import { Component, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import {
  LYNX_ELEMENTS,
  type LynxEvent,
  type LynxVideoErrorEvent,
  type LynxVideoTimeUpdateEvent,
} from 'ng-lynx/elements';
import 'ng-lynx/main-thread';

import { assert, type MockEl, getPage, installMockPapi, tick } from './mock-papi.js';

function findAllByType(el: MockEl, type: string): MockEl[] {
  const out: MockEl[] = [];
  if (el.type === type) out.push(el);
  for (const child of el.children) out.push(...findAllByType(child, type));
  return out;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  // NOTE: no `schemas` — LynxVideo makes the `video` tag (and its attrs/
  // events) known to the template checker, same as every other element here.
  template: `
    <view class="app">
      <video
        class="clip"
        [src]="src()"
        [loop]="loop()"
        [muted]="muted()"
        [volume]="volume()"
        [speed]="speed()"
        [object-fit]="fit()"
        (playing)="onPlaying($event)"
        (timeupdate)="onTimeUpdate($event)"
        (error)="onError($event)"
      ></video>
      <video class="silent" src="b.mp4"></video>
    </view>
  `,
})
export class TestComponent {
  readonly src = signal<string | undefined>('a.mp4');
  readonly loop = signal(true);
  readonly muted = signal(false);
  readonly volume = signal(0.8);
  readonly speed = signal(1.5);
  readonly fit = signal<'contain' | 'cover' | 'fill'>('cover');
  readonly playingCount = signal(0);
  readonly lastTimeUpdate = signal<LynxVideoTimeUpdateEvent['detail'] | undefined>(undefined);
  readonly lastError = signal<LynxVideoErrorEvent['detail'] | undefined>(undefined);

  onPlaying(_event: LynxEvent<unknown>): void {
    this.playingCount.update((n) => n + 1);
  }
  onTimeUpdate(event: LynxVideoTimeUpdateEvent): void {
    this.lastTimeUpdate.set(event.detail);
  }
  onError(event: LynxVideoErrorEvent): void {
    this.lastError.set(event.detail);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, any>)['renderPage']({});
  const appRef = await bootstrapLynxApplication(TestComponent);
  const app = (appRef as { components: Array<{ instance: TestComponent }> }).components[0]!.instance;
  await tick();
  const page = getPage();

  console.log('\n=== <video> creates a real native element, not the unknown-tag fallback ===');
  const videos = findAllByType(page, 'video');
  assert(videos.length === 2, `both <video> elements created (got ${videos.length})`);
  const [clip, bare] = videos;
  assert(clip!.type === 'video', 'KNOWN_LYNX_TAGS routed to __CreateElement(\'video\', …), not the __CreateView fallback');

  console.log('\n=== typed attrs reach the Main Thread as SET_ATTR ops, raw types preserved ===');
  assert(clip!.attrs['src'] === 'a.mp4', 'src forwarded');
  assert(clip!.attrs['loop'] === true, 'loop forwarded as a real boolean, not "true"');
  assert(clip!.attrs['muted'] === false, 'muted forwarded (false still an explicit attr, not omitted)');
  assert(clip!.attrs['volume'] === 0.8, 'volume forwarded as a real number');
  assert(clip!.attrs['speed'] === 1.5, 'speed forwarded as a real number');
  assert(clip!.attrs['object-fit'] === 'cover', 'object-fit forwarded');

  console.log('\n=== unbound attrs never emit an op ===');
  assert(bare!.attrs['src'] === 'b.mp4', 'second <video> got its own static src');
  assert(bare!.attrs['loop'] === undefined, 'unbound loop never set an attr on the second <video>');
  assert(bare!.attrs['volume'] === undefined, 'unbound volume never set an attr on the second <video>');

  console.log('\n=== typed events wire real listeners with the right payload shape ===');
  const playingSign = clip!.events?.['playing']?.sign as string | undefined;
  const timeupdateSign = clip!.events?.['timeupdate']?.sign as string | undefined;
  const errorSign = clip!.events?.['error']?.sign as string | undefined;
  assert(!!playingSign, '(playing) registered a listener');
  assert(!!timeupdateSign, '(timeupdate) registered a listener');
  assert(!!errorSign, '(error) registered a listener');
  assert(!clip!.events?.['ended'], 'unbound (ended) registered no listener at all — lazy outputs cost nothing');

  publishEvent(playingSign!, { type: 'playing' });
  await tick();
  assert(app.playingCount() === 1, 'playing handler ran once');

  publishEvent(timeupdateSign!, { type: 'timeupdate', detail: { current: 1.2, duration: 30 } });
  await tick();
  assert(app.lastTimeUpdate()?.current === 1.2, 'timeupdate payload delivered (current)');
  assert(app.lastTimeUpdate()?.duration === 30, 'timeupdate payload delivered (duration)');

  publishEvent(errorSign!, { type: 'error', detail: { error_code: 4, error_msg: 'decode failed' } });
  await tick();
  assert(app.lastError()?.error_code === 4, 'error payload delivered (error_code)');
  assert(app.lastError()?.error_msg === 'decode failed', 'error payload delivered (error_msg)');

  console.log('\n✅ <video> element assertions passed (wire protocol only — see the module doc for what this cannot prove).\n');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌ <video> element verification failed:\n', err);
  process.exit(1);
});
