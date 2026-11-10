import {
  ChangeDetectionStrategy,
  Component,
  computed,
  type ElementRef,
  signal,
  ViewChild,
} from '@angular/core';

import { asLynxElement, lynxAssetUrl, whenFlushed } from 'angular-lynx';
import { LYNX_ELEMENTS, type LynxEvent } from 'angular-lynx/elements';

/** Simulated network latency for the pull-to-refresh demo. */
const REFRESH_LATENCY_MS = 1200;

// NOTE: an auto-dismiss timer used to live here as a safety net, because
// opening the overlay left the app unresponsive on device. That turned out to
// be a *symptom of the stranded child*, not of the overlay layer itself:
// closing with `[visible]="false"` left the card's content laid out (visible
// in the top-left corner) and evidently still taking touches. Gating the whole
// <overlay> behind @if removes it outright, and the freeze went with it. The
// timer is gone — it was only ever masking that, and a modal that closes
// itself after a couple of seconds is its own bug.

/**
 * Manual test bed for every built-in Lynx element typed by
 * `angular-lynx/elements` — including the 15 added for full "UI Primitives"
 * parity (`docs/18-typed-templates.md`). No `NO_ERRORS_SCHEMA`: every tag
 * used below is known to the template checker.
 *
 * On web-core 0.26.1 nearly all of them render in the web preview too; each
 * section's note says where it was measured (and see the shared note in
 * `runtime/src/elements.ts` above `LynxOverlay`). Run this app both ways:
 *
 *  - `npm run dev` here, open the web preview — check the "✅ web preview"
 *    sections render for real, and everything else at least mounts, wires
 *    events, and doesn't crash.
 *  - Scan the QR code into LynxExplorer (or a custom native host) — every
 *    section should look and behave like its docs page describes.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <!-- [enable-scroll] lets a nested scroller claim a vertical gesture. Same
         fix ui-gallery needed: a native <scroll-view> inside another one
         loses the gesture to its ancestor, and (catchtouchmove) does NOT stop
         that — native gesture recognition isn't gated by JS event bubbling.
         Directly disabling the ancestor while the inner one is touched is
         what actually works. -->
    <scroll-view class="app" scroll-orientation="vertical" [enable-scroll]="pageScrollEnabled()">
      <text class="title">Built-in Primitives</text>
      <text class="subtitle">angular-lynx/elements — full typed coverage</text>

      <!-- ============================== svg ============================== -->
      <view class="section">
        <text class="section-title">&lt;svg&gt;</text>
        <text class="section-note verified">✅ verified working in the web preview</text>
        <svg class="svg-demo" [content]="svgContent()" (load)="bump('svgLoads')"></svg>
        <view class="btn-row svg-radius-controls">
          <view class="btn" (tap)="svgRadius.set(svgRadius() + 4)"><text class="btn-label">Bigger circle</text></view>
          <view class="btn" (tap)="svgRadius.set(8)"><text class="btn-label">Reset</text></view>
        </view>
        <text class="status">radius={{ svgRadius() }} · load fired {{ counts().svgLoads }}×</text>

        <!-- The OTHER svg input: src loads a real .svg file over the
             network, where content above passes markup inline. Different code
             path (a fetch + parse rather than a string), so both are worth
             demonstrating.

             MEASURED ON DEVICE (iOS, Lynx Explorer 4.0.0). Path GEOMETRY
             renders correctly for all three files. Fill colour is where they
             differ — narrowed down to exactly one failure mode, not three:

               lynx-classes.svg        fills come from a <defs><style> block
                                       (.fur { fill: #d9a066 } + class=)
                                       -> ignored; every path falls back to
                                          the SVG default black
               lynx-inline.svg         the same drawing, fills written as
                                       inline fill="#rrggbb" attributes
                                       -> renders correctly, full colour
               mountain-range.svg     inline fill in percentage notation,
                                       fill="rgb(84.3%, 93.1%, 98.1%)"
                                       -> also renders correctly, full colour

             So the real, narrow finding is: presentation-attribute fills
             (hex or percentage rgb()) work fine on iOS; only fills declared
             via a <defs><style> CSS class are ignored. Two earlier notes here
             were each wrong in a different way — one claimed geometry itself
             was missing (it isn't), the next claimed the inline-fill file
             didn't load at all (it does; that was presumably tested before
             this file existed in its current form). Both were corrected by
             re-testing on-device rather than trusting the standing note. -->
        <text class="section-sub">
          …and the same element driven by <text class="mono">src</text> instead.
          ⚠️ On a device (iOS and Android), fills from a &lt;style&gt; CSS
          class don't resolve: &lt;style&gt; isn't among the SVG tags Lynx
          supports. Plain fill="…" attributes (hex or percentage rgb) work
          fine:
        </text>
        <view class="btn-stack">
          <view class="btn" (tap)="svgFile.set('lynx-classes.svg')">
            <text class="btn-label">lynx (CSS classes — renders black)</text>
          </view>
          <view class="btn" (tap)="svgFile.set('lynx-inline.svg')">
            <text class="btn-label">lynx (inline hex)</text>
          </view>
          <view class="btn" (tap)="svgFile.set('mountain-range.svg')">
            <text class="btn-label">mountain (rgb %)</text>
          </view>
        </view>
        <!-- A new <svg> for each src, not a changed src on one element. On iOS a
             download that fails leaves the element stuck: it fires no error,
             keeps the old picture, and ignores every later src. Lynx's
             LynxSVGView clears its "rendering" flag only after a successful
             draw (same on upstream develop, 2026-11-09). See docs/18. -->
        @for (src of [svgFileSrc()]; track src) {
          <svg
            class="svg-file-demo"
            [src]="src"
            (load)="bump('svgFileLoads')"
            (error)="bump('svgFileErrors')"
          ></svg>
        }
        <text class="status">showing {{ svgFile() }}</text>
        <text class="status">
          file load fired {{ counts().svgFileLoads }}× · errors {{ counts().svgFileErrors }}
        </text>
      </view>

      <!-- ============================= video =============================
           The src used to be https://example.com/clip.mp4 — a placeholder
           that can never resolve (example.com is IANA's reserved
           documentation domain; it serves an HTML page, never a video). That
           made this section fail for TWO independent reasons and report a
           misleading "error fired 1x" that looked like the element itself was
           broken, when the URL was simply fake. It now points at a real file
           in this example's own public/media/, through lynxAssetUrl() — a
           relative src has no document to resolve against on a real engine
           (docs/22-http.md), and Lynx's video takes network URLs only.

           muted + autoplay + loop are the Lynx-correct way to make this
           self-demonstrating where video actually runs. Note they do NOT
           make it autoplay in the web preview: web-core renders a real HTML
           <video> and applies these as content attributes after the element
           already exists, and HTML's muted attribute only seeds
           defaultMuted at creation — so the live .muted property stays
           false and the browser's autoplay policy blocks it. Measured, not
           assumed: reading the element back gives muted=false with
           autoplay=true. "controls" is therefore added purely so a human can
           press play in the web preview; it is not part of Lynx's typed
           video API (LynxVideo types src/loop/volume/muted/speed/object-fit/
           mode/timeupdate-interval) and native hosts ignore it. -->
      <view class="section">
        <text class="section-title">&lt;video&gt;</text>
        <text class="section-note native-only">
          ⚠️ Plays in the web preview (web-core backs it with a real HTML
          &lt;video&gt;). On a device it needs engine 4.1+, where the element
          first exists. An older engine throws "video ui not found"
          (LynxCreateUIException, error 9901/990100) the moment it's created,
          so it is mounted on demand rather than on page load. It starts muted:
          the button below turns the sound on.
        </text>
        <!-- No tag name inside the interpolation: Angular tokenizes the
             template as HTML *before* interpolation, so a literal tag in a
             {{ }} string is parsed as a real element and quietly breaks the
             component's AOT compilation (it then fails at runtime with
             "JIT compiler unavailable" rather than a build error). -->
        <view class="btn-row">
          <view class="btn" (tap)="toggleMount('video')">
            <text class="btn-label">{{ isMounted('video') ? 'Unmount' : 'Mount' }} the video element</text>
          </view>
        </view>
        @if (isMounted('video')) {
          <video
            #videoRef
            class="video-demo"
            [src]="videoSrc"
            object-fit="cover"
            [muted]="videoMuted()"
            [loop]="true"
            [autoplay]="true"
            controls
            (playing)="bump('videoPlaying')"
            (paused)="bump('videoPauses')"
            (error)="bump('videoErrors')"
          ></video>
          <!-- Lynx's <video> has no autoplay attribute (only HTML honours
               it): on a device it shows its first frame until play() is
               called. Measured on engine 4.1. -->
          <view class="btn-row">
            <view class="btn" (tap)="videoMethod('play')"><text class="btn-label">play()</text></view>
            <view class="btn btn-muted" (tap)="videoMethod('pause')"><text class="btn-label">pause()</text></view>
            <view class="btn btn-muted" (tap)="videoMuted.set(!videoMuted())">
              <text class="btn-label">{{ videoMuted() ? 'Unmute' : 'Mute' }}</text>
            </view>
          </view>
        }
        <text class="status">
          playing fired {{ counts().videoPlaying }}× · paused fired {{ counts().videoPauses }}× · error fired {{ counts().videoErrors }}×
        </text>
      </view>

      <!-- ============================= frame ============================= -->
      <view class="section">
        <text class="section-title">&lt;frame&gt;</text>
        <text class="section-note verified">✅ works in the web preview — but NOT on device, by design (see below)</text>
        <text class="section-body">
          Embeds the separate "nested" bundle below (its own rspeedy entry —
          not this page, so it can never recurse into itself).
        </text>
        <text class="section-body">
          ⚠️ On a device BOTH buttons appear to do nothing, and that is not a
          bug here: unlike the elements above, &lt;frame&gt; IS registered and
          constructs fine — it just never fetches its own src. iOS stores the
          URL and nothing else; the bundle has to be handed in already-built
          by the host app (setAppBundle: / loadBundle), so the native log
          shows "bundle not loaded" with no network request at all. Stock
          Explorer doesn't do that.
        </text>
        <text class="section-body">
          ⚠️ In the web preview only the .web.bundle loads. The .lynx.bundle is
          the native binary template format, which web-core cannot consume —
          tapping it grows the frame box to its CSS height and then stops:
          empty frame, status stays "not loaded", and (measured) no network
          request is issued for it at all. Both buttons are kept because both
          are what you'd really write per target, but only one can ever
          succeed in a given environment.
        </text>
        <view class="btn-stack">
          <view class="btn" (tap)="frameSrc.set(lynxAssetUrl('nested.web.bundle'))"><text class="btn-label">Load .web.bundle (web preview only)</text></view>
          <view class="btn" (tap)="frameSrc.set(lynxAssetUrl('nested.lynx.bundle'))"><text class="btn-label">Load .lynx.bundle (needs a host app)</text></view>
          <view class="btn btn-muted" (tap)="frameSrc.set(undefined)"><text class="btn-label">Unload</text></view>
        </view>
        @if (frameSrc(); as src) {
          <frame class="frame-demo" [src]="src" (load)="onFrameLoad($event)" (loadmetrics)="bump('frameLoadMetrics')"></frame>
        }
        <text class="status">{{ frameStatus() }}</text>
      </view>

      <!-- ============================ overlay ============================ -->
      <view class="section">
        <text class="section-title">&lt;overlay&gt;</text>
        <text class="section-note verified">
          ✅ Android, iOS and the web preview (web-core's modal dialog). Close
          it with Close, a tap on the dimmed backdrop, or Android's back key.
          Built the way Lynx documents it: the overlay is position: fixed and
          its one child is a full-size backdrop holding the card.
        </text>
        <view class="btn-row">
          <view class="btn" (tap)="showOverlay()"><text class="btn-label">Show overlay</text></view>
        </view>
        <!-- The whole element is gated, not just its child.
             [visible]="false" plus a display:none child was NOT enough on
             device: after closing, the card's text stayed on screen in the
             top-left corner — the layer had gone but its content was still
             laid out, and neither display:none nor the fixed-position
             offsets applied to it in that state. Not rendering the <overlay>
             at all when it's closed leaves nothing behind to strand.

             Gating out here (rather than inside) also keeps the
             one-direct-child rule intact: <overlay> never sees the comment
             anchors the control-flow block introduces. -->
        @if (overlayMounted()) {
          <!-- Lynx's documented shape (lynxjs.org, <overlay>): the overlay
               itself is position: fixed, and its ONE child is a full-size
               backdrop that the dialog sits inside. The card used to be the
               fixed child instead; on Android that left the card out of the
               overlay's hit-testing, so every touch landed on the <overlay>
               and Close could never be tapped.

               visible is off at creation and turned on afterwards (see
               showOverlay): level can only change while the overlay is
               hidden. -->
          <overlay
            class="overlay-demo"
            [level]="2"
            [visible]="overlayShown()"
            (showoverlay)="bump('overlayShows')"
            (dismissoverlay)="onOverlayDismissed()"
            (requestclose)="hideOverlay()"
          >
            <!-- Tapping the dimmed backdrop closes, like Lynx's own example;
                 the card's catchtap keeps a tap on it from reaching here. -->
            <view class="overlay-backdrop" (tap)="hideOverlay()">
              <view class="overlay-card" (catchtap)="keepOverlayOpen()">
                <text class="overlay-card-text">I'm an &lt;overlay&gt; — detached from normal page layout.</text>
                <view class="btn btn-muted" (tap)="hideOverlay()"><text class="btn-label">Close</text></view>
              </view>
            </view>
          </overlay>
        }
        <text class="status">shown {{ counts().overlayShows }}× · dismissed {{ counts().overlayDismisses }}×</text>
      </view>

      <!-- ============================ refresh ============================ -->
      <view class="section">
        <text class="section-title">&lt;refresh&gt; / &lt;refresh-header&gt;</text>
        <text class="section-note verified">✅ renders in the web preview (web-core 0.26) · on a device it needs engine 3.8+, so it is mounted on demand</text>
        <view class="btn-row">
          <view class="btn" (tap)="toggleMount('refresh')">
            <text class="btn-label">{{ isMounted('refresh') ? 'Unmount' : 'Mount' }} the refresh element</text>
          </view>
        </view>
        @if (isMounted('refresh')) {
          <!-- Wrapper exists purely to hand the page scroller off: while a
               finger is inside this box the root <scroll-view> is disabled,
               so the pull-down (and the inner scroller) can claim the
               gesture. Without it the ancestor wins once the inner content
               is long enough to scroll — reported on device as "after a few
               batches load I can't pull down any more, the global app scroll
               takes over". Released on touchend AND touchcancel, so a
               gesture interrupted by the system can't leave the page
               permanently unscrollable. -->
          <view
            class="refresh-wrap"
            (touchstart)="pageScrollEnabled.set(false)"
            (touchend)="pageScrollEnabled.set(true)"
            (touchcancel)="pageScrollEnabled.set(true)"
          >
          <refresh
            #refreshRef
            class="refresh-demo"
            (startrefresh)="onStartRefresh()"
            (refreshstatechange)="bump('refreshStateChanges')"
          >
            <!-- The header is the pull-to-refresh affordance, so it's where
                 the loading state belongs — a status line under the box is
                 easy to miss while your finger is at the top of the list. -->
            <refresh-header
              class="refresh-header-demo"
              [class.refresh-header-loading]="refreshing()"
            >
              <text class="refresh-header-text">
                {{ refreshing() ? '⏳ Loading…' : 'pull down ↓' }}
              </text>
            </refresh-header>
            <!-- Enough rows to actually overflow, and a real (simulated) load
                 behind the gesture: pulling down prepends 3 "fresh item" rows
                 after a delay, so the refreshing state has both a duration and
                 a visible result. A single static line could neither scroll
                 nor show that anything happened. -->
            <scroll-view class="refresh-body" scroll-orientation="vertical">
              @for (row of refreshRows(); track row) {
                <text class="refresh-body-text">{{ row }}</text>
              }
            </scroll-view>
          </refresh>
          </view>
        }
        <view class="btn-row">
          <view class="btn" (tap)="autoStartRefresh()"><text class="btn-label">autoStartRefresh()</text></view>
          <view class="btn btn-muted" (tap)="finishRefresh()"><text class="btn-label">finishRefresh()</text></view>
        </view>
        <text class="status">{{ refreshStatus() }}</text>
      </view>

      <!-- ======================== title-bar-view ========================= -->
      <view class="section">
        <text class="section-title">&lt;title-bar-view&gt;</text>
        <text class="section-note desktop-only">
          🖥️ Clay Windows/macOS only — on mobile it isn't merely inert, it's
          unregistered, so mounting it raises "title-bar-view ui not found"
        </text>
        <view class="btn-row">
          <view class="btn" (tap)="toggleMount('titlebar')">
            <text class="btn-label">{{ isMounted('titlebar') ? 'Unmount' : 'Mount' }} the title-bar element</text>
          </view>
        </view>
        @if (isMounted('titlebar')) {
          <title-bar-view class="titlebar-demo" [moveable]="true">
            <text class="titlebar-text">drag me (desktop only)</text>
          </title-bar-view>
        }
      </view>

      <!-- ========================== viewpager ============================ -->
      <view class="section">
        <text class="section-title">&lt;viewpager&gt; / &lt;viewpager-item&gt;</text>
        <text class="section-note verified">✅ renders in the web preview (web-core 0.26) · on a device it needs engine 3.9+, so it is mounted on demand</text>
        <view class="btn-row">
          <view class="btn" (tap)="toggleMount('viewpager')">
            <text class="btn-label">{{ isMounted('viewpager') ? 'Unmount' : 'Mount' }} the viewpager element</text>
          </view>
        </view>
        @if (isMounted('viewpager')) {
          <viewpager
            #viewpagerRef
            class="viewpager-demo"
            (change)="onVpChange($event)"
            (offsetchange)="onVpOffsetChange($event)"
          >
            @for (color of vpColors; track color; let i = $index) {
              <viewpager-item class="vp-item" [style.background-color]="color">
                <text class="vp-item-text">page {{ i + 1 }}</text>
              </viewpager-item>
            }
          </viewpager>
        }
        <view class="btn-row">
          <view class="btn" (tap)="selectPage(vpIndex() - 1)"><text class="btn-label">◀ prev</text></view>
          <view class="btn" (tap)="selectPage(vpIndex() + 1)"><text class="btn-label">next ▶</text></view>
        </view>
        <text class="status">index={{ vpIndex() }} · offset={{ vpOffset() }}</text>
      </view>

      <!-- ====================== scroll-coordinator ======================= -->
      <view class="section">
        <text class="section-title">&lt;scroll-coordinator&gt; (+ header/slot/toolbar)</text>
        <text class="section-note verified">✅ renders in the web preview (web-core 0.26) · on a device it needs engine 3.9+, so it is mounted on demand</text>
        <view class="btn-row">
          <view class="btn" (tap)="toggleMount('scrollcoordinator')">
            <text class="btn-label">{{ isMounted('scrollcoordinator') ? 'Unmount' : 'Mount' }} the scroll-coordinator</text>
          </view>
        </view>
        @if (isMounted('scrollcoordinator')) {
          <!-- Lynx's documented layout (lynxjs.org, <scroll-coordinator>):
               toolbar first and in flow, the header position: absolute
               under it, the slot flex: 1. The toolbar covers the header's
               top edge by design, so the header's label sits at its bottom;
               centred, the toolbar hid it (Android, Explorer 4.1). A
               scroll-view in the slot needs enable-new-nested to hand the
               scroll over to the header's collapse.
               Inside the page's scroll-view, as here, it needs two more
               things, one per platform. Android needs
               android-nested-scroll-as-child: without it the coordinator only
               acts as a nested-scroll parent, so the page took the drag and
               the header collapsed a few px. iOS needs the page scroller
               switched off while a finger is inside, as for <refresh> above:
               without that the page scrolls instead and the header doesn't
               move. -->
          <scroll-coordinator
            class="sc-demo"
            [android-nested-scroll-as-child]="true"
            (offset)="onScOffset($event)"
            (touchstart)="pageScrollEnabled.set(false)"
            (touchend)="pageScrollEnabled.set(true)"
            (touchcancel)="pageScrollEnabled.set(true)"
          >
            <scroll-coordinator-toolbar class="sc-toolbar">
              <text class="sc-toolbar-text">toolbar (stays pinned)</text>
            </scroll-coordinator-toolbar>
            <scroll-coordinator-header class="sc-header">
              <text class="sc-header-text">header (collapses on scroll)</text>
            </scroll-coordinator-header>
            <scroll-coordinator-slot class="sc-slot">
              <scroll-view class="sc-slot-scroll" scroll-orientation="vertical" enable-new-nested="true">
                @for (n of scRows; track n) {
                  <text class="sc-row">row {{ n }}</text>
                }
              </scroll-view>
            </scroll-coordinator-slot>
          </scroll-coordinator>
        }
        <text class="status">offset={{ scOffset().offset }} height={{ scOffset().height }}</text>
      </view>

      <!-- =========================== blur-view =========================== -->
      <view class="section">
        <text class="section-title">&lt;blur-view&gt;</text>
        <text class="section-note verified">✅ renders in the web preview (web-core 0.26) · on a device it needs engine 4.0+, so it is mounted on demand</text>
        <view class="btn-row">
          <view class="btn" (tap)="toggleMount('blurview')">
            <text class="btn-label">{{ isMounted('blurview') ? 'Unmount' : 'Mount' }} the blur element</text>
          </view>
        </view>
        <!-- flatten off: Android's blur-view blurs a snapshot of its parent's
             native view. Flattened (Lynx's default for a plain view), the
             parent has none, and on Explorer 4.1 the panel only tinted the
             text under it; unflattened, it blurs it. -->
        <view class="blur-backdrop" [flatten]="false">
          <text class="blur-backdrop-text">🌈 colorful content behind the blur</text>
          <text class="blur-backdrop-detail">SHARP · EDGES · UNDER · THE · BLUR</text>
          @if (isMounted('blurview')) {
            <!-- glass-style only applies to glass: "clear" is the see-through one. -->
            <blur-view
              class="blur-demo"
              [blur-radius]="blurRadius()"
              [blur-effect]="blurEffect()"
              glass-style="clear"
            >
              <text class="blur-demo-text">blurred layer</text>
            </blur-view>
          }
        </view>
        <view class="btn-row">
          <view class="btn" (tap)="blurRadius.set('4px')"><text class="btn-label">Light</text></view>
          <view class="btn" (tap)="blurRadius.set('20px')"><text class="btn-label">Heavy</text></view>
          <view class="btn btn-muted" (tap)="blurEffect.set(blurEffect() === 'light' ? 'glass' : 'light')">
            <text class="btn-label">{{ blurEffect() === 'light' ? 'Glass' : 'Blur' }}</text>
          </view>
        </view>
        <text class="status">
          blur-effect={{ blurEffect() }} · blur-radius={{ blurRadius() }} · {{ isMounted('blurview') ? 'mounted' : 'not mounted' }}
        </text>
        <text class="status">
          Light and Heavy set blur-radius, which only a blur uses: iOS 26's glass
          effect has no radius. Android has no glass, so there Glass changes
          nothing. Needs engine 4.0 or newer.
        </text>
      </view>

      <!-- ============================ webview ============================ -->
      <view class="section">
        <text class="section-title">&lt;webview&gt;</text>
        <text class="section-note verified">✅ renders in the web preview (web-core 0.26) · on a device it needs engine 4.0+, so it is mounted on demand</text>
        <view class="btn-row">
          <view class="btn" (tap)="toggleMount('webview')">
            <text class="btn-label">{{ isMounted('webview') ? 'Unmount' : 'Mount' }} the webview element</text>
          </view>
        </view>
        <view class="btn-row">
          <view class="btn" (tap)="webviewSrc.set('https://lynxjs.org')"><text class="btn-label">lynxjs.org</text></view>
          <view class="btn" (tap)="webviewSrc.set('https://example.com')"><text class="btn-label">example.com</text></view>
        </view>
        @if (isMounted('webview')) {
          <webview
            class="webview-demo"
            [src]="webviewSrc()"
            (load)="bump('webviewLoads')"
            (error)="bump('webviewErrors')"
          ></webview>
        }
        <text class="status">src={{ webviewSrc() }} · loaded {{ counts().webviewLoads }}× · errored {{ counts().webviewErrors }}×</text>
      </view>

      <view class="footer">
        <text class="footer-text">End of demo.</text>
      </view>
    </scroll-view>
  `,
})
export class AppComponent {
  /**
   * Exposed for the template. Absolute URLs are still the right thing here —
   * the native engine has no document to resolve a relative one against (see
   * docs/22-http.md) — but note that this is **not** what makes `<frame>`
   * work on-device, and an earlier version of this comment wrongly implied it
   * was.
   *
   * `<frame src>` doesn't load on a stock Lynx Explorer at all, and no URL
   * fixes it: the native `LynxFrameView.setUrl:` merely *stores* the string
   * and fetches nothing, so no request is ever made. The bundle has to be
   * handed in already-built by the host app via `setAppBundle:`
   * (`loadBundle(TemplateBundle)` on Android). Until that happens
   * `propsDidUpdate` bails with "bundle not loaded or render is null", which
   * is exactly what this demo shows on-device. The web preview works because
   * `@lynx-js/web-core` fetches the URL itself. See
   * docs/18-typed-templates.md.
   */
  protected readonly lynxAssetUrl = lynxAssetUrl;

  @ViewChild('refreshRef') refreshRef?: ElementRef;
  @ViewChild('viewpagerRef') viewpagerRef?: ElementRef;
  @ViewChild('videoRef') videoRef?: ElementRef;

  // --- svg ---
  /**
   * A real `.svg` file from this example's `public/` — the `src` code path.
   *
   * Two files, deliberately: they colour their shapes in the two different
   * ways SVG allows, which is the useful comparison for a native renderer.
   * `lynx-classes.svg` uses a `<defs><style>` block with CSS classes
   * (`.fur { fill: … }` + `class="fur"` on each shape); `mountain-range.svg`
   * uses inline `fill="…"` presentation attributes.
   */
  readonly svgFile = signal('lynx-classes.svg');
  readonly svgFileSrc = computed(() => lynxAssetUrl(`media/${this.svgFile()}`));
  readonly svgRadius = signal(8);
  /**
   * `viewBox` (rather than sizing the circle to `.svg-demo`'s actual pixel
   * box) is what keeps this centered regardless of the box's dimensions —
   * SVG's default `preserveAspectRatio="xMidYMid meet"` centers the 100×100
   * content within whatever box it's placed in.
   */
  readonly svgContent = computed(
    () =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="${this.svgRadius()}" fill="#dd0031"/></svg>`,
  );

  // --- video ---
  /** A real clip from this example's own `public/media/` — see the template. */
  readonly videoSrc = lynxAssetUrl('media/earth-from-iss.mp4');
  /**
   * Which native-only sections have been mounted by tapping their button.
   *
   * **Why any of this exists.** On stock Lynx Explorer, simply *creating* an
   * element whose UI class isn't registered throws
   * `LynxCreateUIException: <tag> ui not found when create UI`
   * (`9901`/`990100`) — see docs/18-typed-templates.md for who is supposed to
   * register it (the host app, in native code, at init) and why no JS-side
   * change can. This page covers 11 built-ins, and on that build **seven of
   * them are unregistered**, so rendering them eagerly meant seven native
   * exceptions were raised before the user had touched anything — burying the
   * sections that do work and making the app look broken on launch.
   *
   * Mounting each behind its own tap keeps every element just as testable
   * (tap it, observe the exception or the working element) while letting the
   * page load clean. It mirrors what `<frame>` already did with its
   * Load/Unload buttons. `<overlay>` and `<frame>` are deliberately *not*
   * gated — both are registered on this build and construct fine.
   */
  private readonly mountedSections = signal<ReadonlySet<string>>(new Set<string>());

  protected isMounted(key: string): boolean {
    return this.mountedSections().has(key);
  }

  protected toggleMount(key: string): void {
    this.mountedSections.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  // --- frame ---
  readonly frameSrc = signal<string | undefined>(undefined);
  readonly frameStatus = signal('not loaded');

  // --- overlay ---
  /** Renders the <overlay> at all — closed, it's removed, not just hidden. */
  readonly overlayMounted = signal(false);
  /** Its `visible`: off when it's created, on once that has landed. */
  readonly overlayShown = signal(false);
  private overlayUnmountTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set by hideOverlay until the dismiss it asked for arrives. */
  private overlayClosing = false;

  /**
   * Drives `[enable-scroll]` on the root scroller. Turned off while a finger
   * is inside a nested scrollable so that scroller can claim the gesture —
   * see the template comment on the root `<scroll-view>`.
   */
  readonly pageScrollEnabled = signal(true);

  // --- refresh ---
  readonly refreshStatus = signal('idle');
  /** Rows the pull-to-refresh demo prepends to — see onStartRefresh. */
  readonly refreshRows = signal<string[]>(
    Array.from({ length: 12 }, (_, i) => `row ${i + 1}`),
  );
  /** Drives the header's loading affordance — see the template. */
  readonly refreshing = signal(false);
  private refreshBatch = 0;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  // --- viewpager ---
  readonly videoMuted = signal(true);
  readonly vpColors = ['#dd0031', '#1f2a44', '#3a3f58'];
  readonly vpIndex = signal(0);
  readonly vpOffset = signal(0);

  // --- scroll-coordinator ---
  readonly scRows = Array.from({ length: 20 }, (_, i) => i + 1);
  readonly scOffset = signal({ offset: 0, height: 0 });

  // --- blur-view ---
  readonly blurRadius = signal('10px');
  /** `light` is a real blur that `blur-radius` controls. On iOS 26, `glass` ignores the radius. */
  readonly blurEffect = signal<'light' | 'glass'>('light');

  // --- webview ---
  readonly webviewSrc = signal('https://lynxjs.org');

  // --- shared event counters, keeps the template terse ---
  readonly counts = signal({
    svgLoads: 0,
    svgFileLoads: 0,
    svgFileErrors: 0,
    videoPlaying: 0,
    videoPauses: 0,
    videoErrors: 0,
    frameLoadMetrics: 0,
    overlayShows: 0,
    overlayDismisses: 0,
    refreshStateChanges: 0,
    webviewLoads: 0,
    webviewErrors: 0,
  });

  bump(key: keyof ReturnType<typeof this.counts>): void {
    this.counts.update((c) => ({ ...c, [key]: c[key] + 1 }));
  }

  /**
   * Create the overlay hidden, then show it. Android applies `level` only
   * while the overlay is hidden: created with `visible` already on, the level
   * landed on a showing overlay and Explorer 4.1 raised "Overlay set Level
   * error!" (LynxError 2298) and kept the default level. The timeout lets the
   * render that creates it run first; whenFlushed waits for that batch to
   * reach the Main Thread.
   */
  showOverlay(): void {
    this.overlayClosing = false;
    clearTimeout(this.overlayUnmountTimer);
    this.overlayMounted.set(true);
    setTimeout(() => {
      void whenFlushed().then(() => {
        if (this.overlayMounted()) this.overlayShown.set(true);
      });
    });
  }

  /**
   * Hide it, then remove it once it has said so: unmounting in the same
   * render took the `(dismissoverlay)` listener with it, so the event fired
   * natively and was never counted. The timer covers a platform that
   * doesn't send the event; removal is what keeps nothing stranded on screen.
   */
  hideOverlay(): void {
    if (!this.overlayMounted()) return;
    this.overlayClosing = true;
    this.overlayShown.set(false);
    clearTimeout(this.overlayUnmountTimer);
    this.overlayUnmountTimer = setTimeout(() => this.overlayMounted.set(false), 1000);
  }

  /**
   * Only a dismiss that follows hideOverlay counts: iOS (Explorer 4.1) also
   * reports one for the hidden state the overlay is created in, and acting
   * on that unmounted it before it was ever shown.
   */
  onOverlayDismissed(): void {
    if (!this.overlayClosing) return;
    this.overlayClosing = false;
    this.bump('overlayDismisses');
    clearTimeout(this.overlayUnmountTimer);
    this.overlayMounted.set(false);
  }

  /** The card's catchtap: a tap on the card mustn't reach the backdrop. */
  keepOverlayOpen(): void {}

  onFrameLoad(event: LynxEvent<{ url?: string; statusCode?: number }>): void {
    this.frameStatus.set(`loaded ${event.detail?.url ?? ''} (status ${event.detail?.statusCode ?? '?'})`);
  }

  /**
   * Pull-to-refresh with a real (simulated) load, so the gesture visibly does
   * something. Previously `(startrefresh)` only wrote "refreshing…" and
   * nothing ever arrived, which reads as "pull down does nothing".
   *
   * The delay is what makes the spinner state meaningful: on device the
   * header stays in its refreshing state until `finishRefresh()` is invoked,
   * so returning instantly would give nothing to look at.
   */
  onStartRefresh(): void {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    this.refreshStatus.set('refreshing…');
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshing.set(false);
      const batch = ++this.refreshBatch;
      this.refreshRows.update((rows) => [
        ...Array.from({ length: 3 }, (_, i) => `fresh item ${batch}.${i + 1}`),
        ...rows,
      ]);
      this.refreshStatus.set(`loaded 3 new rows (batch ${batch}) — ${this.refreshRows().length} total`);
      // Tell the native header to stop refreshing. Deliberately does NOT
      // reset the status text, so the result of the load stays readable.
      if (this.refreshRef) {
        asLynxElement(this.refreshRef.nativeElement).invoke({ method: 'finishRefresh' });
      }
    }, REFRESH_LATENCY_MS);
  }

  autoStartRefresh(): void {
    // Drive the same simulated load even where the native element isn't
    // registered, so the button demonstrates the flow regardless.
    this.onStartRefresh();
    if (!this.refreshRef) return;
    asLynxElement(this.refreshRef.nativeElement).invoke({ method: 'autoStartRefresh' });
  }

  finishRefresh(): void {
    clearTimeout(this.refreshTimer);
    this.refreshing.set(false);
    this.refreshStatus.set('idle');
    if (!this.refreshRef) return;
    asLynxElement(this.refreshRef.nativeElement).invoke({ method: 'finishRefresh' });
  }

  onVpChange(event: LynxEvent<{ index: number }>): void {
    this.vpIndex.set(event.detail?.index ?? 0);
  }

  onVpOffsetChange(event: LynxEvent<{ offset: number }>): void {
    this.vpOffset.set(event.detail?.offset ?? 0);
  }

  videoMethod(method: 'play' | 'pause'): void {
    if (!this.videoRef) return;
    asLynxElement(this.videoRef.nativeElement).invoke({ method });
  }

  selectPage(index: number): void {
    if (!this.viewpagerRef) return;
    const target = Math.max(0, Math.min(this.vpColors.length - 1, index));
    asLynxElement(this.viewpagerRef.nativeElement).invoke({
      method: 'selectTab',
      params: { index: target, smooth: true },
      // iOS fails a selectTab still animating when a newer one or a touch interrupts
      // it ("break by next selectTab"). The newer one wins, so that isn't a problem,
      // and without a `fail` a dev build reports it as an error.
      fail: (err) => {
        if (!JSON.stringify(err).includes('break by')) console.warn('[primitives] selectTab failed', err);
      },
    });
  }

  onScOffset(event: LynxEvent<{ offset: number; height: number }>): void {
    this.scOffset.set({ offset: event.detail?.offset ?? 0, height: event.detail?.height ?? 0 });
  }
}
