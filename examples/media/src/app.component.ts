import { ChangeDetectionStrategy, Component, computed, type ElementRef, signal, ViewChild } from '@angular/core';

import { asLynxElement, lynxAssetUrl } from 'ng-lynx';
import { LYNX_ELEMENTS, type LynxEvent, type LynxVideoFirstFrameEvent } from 'ng-lynx/elements';

/**
 * Video and audio on Lynx — and an honest account of what the platform does
 * and doesn't give you.
 *
 * ## What Lynx provides
 *
 * **Video: a real element.** `<video>` is a built-in
 * ([reference](https://lynxjs.org/api/elements/built-in/video.html)), typed
 * here by `ng-lynx/elements` as `LynxVideo` — `src`, `poster`,
 * `autoplay`, `object-fit`, plus `(playing)`, `(pause)`, `(ended)`,
 * `(timeupdate)`, `(error)`. This page binds all of them.
 *
 * **Audio: no element at all.** Lynx's built-in element set has no `<audio>`.
 * The list is `view`, `text`, `image`, `scroll-view`, `list`, `frame`,
 * `input`, `textarea`, `overlay`, `svg`, `refresh`, `title-bar-view` plus the
 * platform-only extras — audio simply isn't in it. So the two ways to play a
 * sound are:
 *
 *  1. **`<video>` pointed at an audio file** — the media stack decodes it and
 *     plays the audio track with nothing to draw. That's what this page does,
 *     since it needs no host-app changes.
 *  2. **A native module** (`lynx.getJSModule(...)`) exposing the host's own
 *     audio player. That's the production answer, but it only exists if the
 *     host app implements it — see docs/27-native-modules.md.
 *
 * ## Where it runs
 *
 * Both engines 4.1+ and the web preview play it. How that was established,
 * including two earlier notes here that turned out wrong:
 *
 *  - **`<video>` did not exist before Lynx engine 4.1.** Confirmed on an iOS
 *    simulator (Explorer 4.0.0): the tag reaches the native layer and it
 *    *tries* to construct the UI, then throws
 *    `LynxCreateUIException: video ui not found`.
 *
 *    An earlier note here read that as "the stock build ships without the
 *    AVPlayer-backed component, so it needs a host app that registers the
 *    video UI". That was a guess, and the simpler answer turned out to be the
 *    right one: Lynx's own compatibility data
 *    (`lynx-family/lynx-website`, `packages/lynx-compat-data/elements/video.json`)
 *    gives `<video>` `version_added: 4.1` on android and ios. There was
 *    nothing to register before 4.1 — the element was not in that engine
 *    (and that "4.0.0" Explorer was really engine 3.7). **Measured on
 *    Explorer 4.1.0 (iOS simulator): it plays, with no host-app changes.**
 *    Two things differ from HTML, both found in that run: Lynx's video has
 *    no `autoplay` attribute (it shows its first frame until `play()` is
 *    called, hence the play()/pause() buttons), and it fires `paused`, not
 *    `pause` (so both are bound; each platform fires only its own).
 *
 *    So the Autoplay toggle is the app's own: it calls `play()` from
 *    `(firstframe)`, which both engines fire once per loaded source (iOS
 *    `LynxVideoView.m`, Android `LynxVideoView.kt`). A `play()` sent together
 *    with a new `src` is no substitute: both engines cancel queued methods on
 *    a source change. Reload has to change the URL, too: iOS ignores a `src`
 *    equal to the current one, so it appends a counter.
 *  - **The web preview DOES play it — an earlier note here was wrong.** This
 *    used to claim `@lynx-js/web-core` "renders an inert box; only the
 *    `(error)` path fires". Measured directly instead of assumed: web-core
 *    passes `<video>` straight through to a **real HTML `<video>` element**
 *    (Lynx's tag name happens to collide with HTML's), and pointed at a
 *    reachable source it decodes and plays for real — `readyState` 4,
 *    `videoWidth`/`videoHeight` 640×360, `duration` 9.64 (the earlier clip),
 *    `currentTime` advancing, `error` null.
 *
 *    What made it *look* inert was a separate artifact, now **fixed in the
 *    plugin**: rspeedy's dev `assetPrefix` is an absolute LAN-IP origin (so a
 *    phone can fetch assets), which made every asset a **cross-origin
 *    subresource** for a preview opened at `localhost` — and the dev server
 *    sends `Cross-Origin-Embedder-Policy: require-corp`, which blocks those
 *    (`ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaultedToSameOriginByCoep`).
 *    The media element then failed with `MEDIA_ELEMENT_ERROR: Format error`,
 *    which reads exactly like "web-core doesn't implement video". The old
 *    workaround was to open the preview at the printed LAN-IP URL.
 *
 *    `pluginAngularLynx` now scopes `dev.assetPrefix` to
 *    `http://localhost:<port>/` for the **`web` environment only**, so its
 *    assets are same-origin wherever the preview is opened and the `lynx`
 *    environment keeps the LAN-IP prefix the device needs. Verified: this page
 *    renders a real decoded frame at `localhost` with `error 0×`. The same fix
 *    un-broke `<image>`/`<svg src>` — see
 *    `docs/41-device-testing.md`.
 *
 *    Caveat that survives: a `[muted]` binding does **not** mute it on web.
 *    Lynx applies attributes after the element exists, and HTML's `muted`
 *    content attribute only seeds `defaultMuted` at creation — so the live
 *    `.muted` property stays `false` (measured) and the browser's autoplay
 *    policy blocks unmuted autoplay. Native is unaffected.
 *
 * Every event is counted on screen, and the banner explains what you're
 * looking at, in the same spirit as `examples/primitives`, so an engine
 * without `<video>` fails visibly rather than showing a blank box.
 *
 * The assets are served from this example's own `public/media/` and addressed
 * through `lynxAssetUrl()`, because a relative `src` has no document to
 * resolve against on a real engine (docs/22-http.md).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <scroll-view class="app" scroll-orientation="vertical">
      <text class="title">Video &amp; audio</text>
      <text class="subtitle">&lt;video&gt; is a built-in · audio has no element</text>

      <view class="banner">
        <text class="banner-text">
          &lt;video&gt; is new in Lynx engine 4.1, and plays there with no
          host-app changes (measured on Explorer 4.1). Older engines throw
          “video ui not found”: the element doesn't exist. Lynx's video has no
          autoplay attribute, so Autoplay here calls play() once a source has
          loaded (the firstframe event). The web preview plays it too
          (web-core passes it through to a browser &lt;video&gt;). Lynx still has
          no &lt;audio&gt; element at all.
        </text>
      </view>

      <!-- ============================== video ============================== -->
      <view class="section">
        <text class="section-title">Video</text>
        <video
          #videoRef
          class="video"
          [src]="videoUrl()"
          [autoplay]="autoplay()"
          object-fit="contain"
          (firstframe)="onFirstFrame($event)"
          (playing)="onPlaying()"
          (pause)="onPause()"
          (paused)="onPause()"
          (ended)="onEnded()"
          (timeupdate)="onTimeUpdate($event)"
          (error)="onError($event)"
        ></video>

        <view class="progress">
          <view class="progress-fill" [style.width.%]="percent()"></view>
        </view>
        <text class="time">{{ clock() }}</text>

        <view class="btn-row">
          <view class="btn" (tap)="videoMethod('play')"><text class="btn-label">play()</text></view>
          <view class="btn btn-muted" (tap)="videoMethod('pause')"><text class="btn-label">pause()</text></view>
        </view>
        <view class="btn-row">
          <view class="btn" (tap)="autoplay.set(!autoplay())">
            <text class="btn-label">Autoplay: {{ autoplay() ? 'on' : 'off' }}</text>
          </view>
          <view class="btn btn-muted" (tap)="reload()">
            <text class="btn-label">Reload source</text>
          </view>
        </view>

        <text class="status">
          loads {{ counts().firstframe }}× ·
          playing {{ counts().playing }}× · paused {{ counts().paused }}× ·
          ended {{ counts().ended }}× · timeupdate {{ counts().timeupdate }}× ·
          error {{ counts().error }}×
        </text>
        @if (lastError()) {
          <text class="status error">last error: {{ lastError() }}</text>
        }
      </view>

      <!-- ============================== audio ============================== -->
      <view class="section">
        <text class="section-title">Audio</text>
        <text class="section-body">
          Lynx has no &lt;audio&gt; element, so this is the same &lt;video&gt;
          element pointed at an .mp3 — the media stack decodes it and there is
          simply nothing to draw. A production app would call a host native
          module instead.
        </text>
        <text class="status">Bach, Goldberg Variation 4, played by Kimiko Ishizaka (CC0)</text>

        <!-- Deliberately zero-height: there is no picture, only a sound. -->
        <video
          #audioRef
          class="audio"
          [src]="audioSrc"
          [autoplay]="audioPlaying()"
          (playing)="onAudioPlaying()"
          (pause)="onAudioPause()"
          (paused)="onAudioPause()"
          (ended)="onAudioEnded()"
          (error)="onAudioError($event)"
        ></video>

        <view class="btn-row">
          <view class="btn" (tap)="toggleAudio()">
            <text class="btn-label">{{ audioPlaying() ? 'Pause' : 'Play' }} track</text>
          </view>
        </view>
        <text class="status">
          audio: playing {{ counts().audioPlaying }}× · paused {{ counts().audioPaused }}× ·
          ended {{ counts().audioEnded }}× · error {{ counts().audioError }}×
        </text>
        @if (lastAudioError()) {
          <text class="status error">last audio error: {{ lastAudioError() }}</text>
        }
      </view>
    </scroll-view>
  `,
})
export class AppComponent {
  /** Both assets live in this example's `public/media/`; absolute for a real engine. */
  readonly videoSrc = lynxAssetUrl('media/earth-from-iss.mp4');
  readonly audioSrc = lynxAssetUrl('media/goldberg-variation-4.mp3');

  /** Bumped by Reload, so the engine sees a new URL and loads it again. */
  private readonly reloads = signal(0);
  protected readonly videoUrl = computed(() =>
    this.reloads() === 0 ? this.videoSrc : `${this.videoSrc}?reload=${this.reloads()}`,
  );

  @ViewChild('videoRef') videoRef?: ElementRef;
  @ViewChild('audioRef') audioRef?: ElementRef;

  protected readonly autoplay = signal(false);
  protected readonly audioPlaying = signal(false);

  protected readonly current = signal(0);
  protected readonly duration = signal(0);
  protected readonly lastError = signal('');
  protected readonly lastAudioError = signal('');

  protected readonly percent = computed(() => {
    const d = this.duration();
    return d > 0 ? Math.min(100, (this.current() / d) * 100) : 0;
  });

  protected readonly clock = computed(
    () => `${fmt(this.current())} / ${fmt(this.duration())}`,
  );

  protected readonly counts = signal({
    firstframe: 0,
    playing: 0,
    paused: 0,
    ended: 0,
    timeupdate: 0,
    error: 0,
    audioPlaying: 0,
    audioPaused: 0,
    audioEnded: 0,
    audioError: 0,
  });

  private bump(key: keyof ReturnType<typeof this.counts>): void {
    this.counts.update((c) => ({ ...c, [key]: c[key] + 1 }));
  }

  /**
   * A source finished loading and shows its first frame: the moment HTML's
   * `autoplay` would start it, so the toggle starts it here. Not fired by the
   * web preview, whose HTML video uses the `[autoplay]` binding instead.
   */
  protected onFirstFrame(event: LynxVideoFirstFrameEvent): void {
    this.bump('firstframe');
    const d = event.detail?.duration;
    if (typeof d === 'number' && d > 0) this.duration.set(d);
    if (this.autoplay()) this.videoMethod('play');
  }

  protected onPlaying(): void {
    this.bump('playing');
  }

  protected onPause(): void {
    this.bump('paused');
  }

  protected onEnded(): void {
    this.bump('ended');
  }

  /** `(timeupdate)` carries `{ current, duration }` in seconds. */
  protected onTimeUpdate(event: LynxEvent<{ current: number; duration: number }>): void {
    this.bump('timeupdate');
    const d = event.detail;
    if (typeof d?.current === 'number') this.current.set(d.current);
    if (typeof d?.duration === 'number') this.duration.set(d.duration);
  }

  protected onError(event: LynxEvent<{ error_code?: number; error_msg?: string }>): void {
    this.bump('error');
    this.lastError.set(describeError(event));
  }

  protected onAudioPlaying(): void {
    this.bump('audioPlaying');
  }

  protected onAudioPause(): void {
    this.bump('audioPaused');
  }

  protected onAudioEnded(): void {
    this.bump('audioEnded');
    this.audioPlaying.set(false);
  }

  protected onAudioError(event: LynxEvent<{ error_code?: number; error_msg?: string }>): void {
    this.bump('audioError');
    this.lastAudioError.set(describeError(event));
  }

  /**
   * Lynx's video starts and stops through its methods; it has no autoplay.
   * In the web preview the call reaches the HTML video too and it plays, but
   * web-core 0.26.1 then logs `DataCloneError: … #<Promise> could not be
   * cloned`: it tries to post `play()`'s returned Promise back to the worker.
   * Harmless, and upstream's to fix.
   */
  protected videoMethod(method: 'play' | 'pause'): void {
    if (!this.videoRef) return;
    asLynxElement(this.videoRef.nativeElement).invoke({ method });
  }

  /**
   * The flag drives `[autoplay]` (all the web preview's HTML video needs) and
   * the method call is what a Lynx engine needs.
   */
  protected toggleAudio(): void {
    const play = !this.audioPlaying();
    this.audioPlaying.set(play);
    if (this.audioRef) asLynxElement(this.audioRef.nativeElement).invoke({ method: play ? 'play' : 'pause' });
  }

  /**
   * Loads the video again from the start. The engine stops the old source,
   * and `(firstframe)` plays the new one when Autoplay is on.
   */
  protected reload(): void {
    this.reloads.update((n) => n + 1);
    this.current.set(0);
    this.duration.set(0);
    this.lastError.set('');
  }
}

/** mm:ss, the formatting a player needs regardless of whether decode works. */
function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function describeError(
  event: LynxEvent<{ error_code?: number; error_msg?: string }>,
): string {
  const d = event.detail;
  return d?.error_msg ?? (d?.error_code !== undefined ? `code ${d.error_code}` : 'unknown');
}
