import { ChangeDetectionStrategy, Component, signal, type Type, ViewChild, ViewContainerRef } from '@angular/core';
import { fetchBundle, loadDynamicComponent, LynxBundleError, lynxAssetUrl } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/** The remote card, packaged twice by lynx.config.producer.ts: run.mjs builds both next to the app. */
const CARD = lynxAssetUrl('remote/remote-fetch.lynx.bundle');
const QUERY_CARD = lynxAssetUrl('remote/remote-query.lynx.bundle');

/**
 * `fetchBundle` on a real engine: a component loaded from a bundle of its own
 * through `loadDynamicComponent(…, { fetcher: 'fetch-bundle' })`, a synchronous
 * fetch that reads the bundle's section, and a fetch of a bundle that isn't there.
 */
@Component({
  selector: 'app-bundle',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <!-- Above the buttons, so the card stays on a small screen. -->
      <view #slot></view>
      <view class="button" [flatten]="false" accessibility-label="Fetch card" (tap)="loadCard()">
        <text class="button-label">Fetch card</text>
      </view>
      <view class="button" [flatten]="false" accessibility-label="Query card" (tap)="loadQueryCard()">
        <text class="button-label">Query card</text>
      </view>
      <view class="button" [flatten]="false" accessibility-label="Fetch sync" (tap)="fetchSync()">
        <text class="button-label">Fetch sync</text>
      </view>
      <view class="button" [flatten]="false" accessibility-label="Fetch missing" (tap)="fetchMissing()">
        <text class="button-label">Fetch missing</text>
      </view>
      <text class="line" [flatten]="false">Card: {{ card() }}</text>
      <text class="line" [flatten]="false">Query: {{ query() }}</text>
      <text class="line" [flatten]="false">Sync: {{ sync() }}</text>
      <text class="line" [flatten]="false">Missing: {{ missing() }}</text>
    </view>
  `,
})
export class BundleComponent {
  @ViewChild('slot', { read: ViewContainerRef }) slot!: ViewContainerRef;

  protected readonly card = signal('not loaded');
  protected readonly query = signal('not loaded');
  protected readonly sync = signal('not run');
  protected readonly missing = signal('not run');

  async loadCard(): Promise<void> {
    this.card.set('loading');
    try {
      const mod = await loadDynamicComponent<Type<unknown>>(CARD, { fetcher: 'fetch-bundle' });
      this.slot.clear();
      this.slot.createComponent(mod.default);
      this.card.set('loaded');
    } catch (error) {
      this.card.set(`failed ${(error as Error).message}`);
    }
  }

  /** The default packaging, through lynx.QueryComponent. */
  async loadQueryCard(): Promise<void> {
    this.query.set('loading');
    try {
      const mod = await loadDynamicComponent<Type<unknown>>(QUERY_CARD);
      this.slot.clear();
      this.slot.createComponent(mod.default);
      this.query.set('loaded');
    } catch (error) {
      this.query.set(`failed ${(error as Error).message}`);
    }
  }

  /** A different URL for the same file: the engine keys its cache by URL. */
  async fetchSync(): Promise<void> {
    try {
      const bundle = await fetchBundle(`${CARD}?sync=1`, { sync: true });
      const exports = bundle.loadScript<Record<string, unknown>>('background');
      this.sync.set(`ok ${Object.keys(exports).sort().join(',')}`);
    } catch (error) {
      this.sync.set(`failed ${(error as Error).message}`);
    }
  }

  async fetchMissing(): Promise<void> {
    try {
      // Android's engine never answers for a 404, so the limit is what ends this.
      await fetchBundle(lynxAssetUrl('remote/nothing-here.lynx.bundle'), { timeout: 5 });
      this.missing.set('unexpectedly ok');
    } catch (error) {
      const code = error instanceof LynxBundleError ? error.code : 'no code';
      this.missing.set(`failed, code ${code}`);
    }
  }
}
