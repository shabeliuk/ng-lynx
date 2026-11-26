/**
 * The **host** app: loads `remote-card.component.ts` — which lives in a
 * completely separate bundle, built by `lynx.config.producer.ts` — at
 * runtime, and mounts it into its own view tree.
 */
import {
  ChangeDetectionStrategy,
  Component,
  signal,
  type Type,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';

import { injectSystemInfo, loadDynamicComponent, lynxAssetUrl } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import './app.css';

/**
 * Where the dynamic bundle is served from: the same origin as this app (see
 * `lynx.config.ts`). A real host would take it from `lynxInitData()` or its
 * own config, since the point of a dynamic component is that the host doesn't
 * know it at build time.
 *
 * Absolute, because the native engine has no document to resolve a relative
 * path against (docs/22-http.md). And per platform: the web preview decodes
 * only the web packaging, and rejects `remote.lynx.bundle` with "Invalid
 * Magic Header".
 */
function remoteSource(platform: string | undefined, fetcher: Fetcher): string {
  const name = fetcher === 'fetch-bundle' ? 'remote-fetch' : 'remote';
  return lynxAssetUrl(`${name}.${platform === 'web' ? 'web' : 'lynx'}.bundle`);
}

/** The two packagings of the same card: see the two `lynx.config.producer*.ts`. */
type Fetcher = 'query-component' | 'fetch-bundle';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="page">
      <text class="title">Dynamic component host</text>
      <text class="subtitle">{{ status() }}</text>

      <view class="load-button" (tap)="load('query-component')">
        <text class="load-label">Load the remote card</text>
      </view>
      <view class="load-button" (tap)="load('fetch-bundle')">
        <text class="load-label">Load it with fetchBundle</text>
      </view>

      <!-- The loaded component is mounted here. -->
      <view #slot class="slot"></view>
    </view>
  `,
})
export class AppComponent {
  @ViewChild('slot', { read: ViewContainerRef }) slot!: ViewContainerRef;

  readonly status = signal('Not loaded yet — tap the button.');

  private readonly platform = injectSystemInfo().platform;

  async load(fetcher: Fetcher): Promise<void> {
    if (this.slot.length > 0) {
      this.status.set('Already loaded.');
      return;
    }
    this.status.set('Loading…');
    try {
      const mod = await loadDynamicComponent<Type<unknown>>(remoteSource(this.platform, fetcher), { fetcher });
      this.slot.createComponent(mod.default);
      this.status.set('Loaded — the card below came from another bundle.');
    } catch (err) {
      this.status.set(`Failed: ${(err as Error).message}`);
    }
  }
}
