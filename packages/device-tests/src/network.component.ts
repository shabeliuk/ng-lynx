import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { NavigationError, NavigationStart, Router } from '@angular/router';
import { lynxAssetUrl } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/**
 * A lazy route on a bad network. run.mjs's server slows the lazy chunk down, or cuts
 * its connection, when this screen asks (`/__network/<mode>`). Navigation shows what
 * the router did, and how long it took.
 */
@Component({
  selector: 'app-network',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <text class="title" [flatten]="false">Network</text>
      <text class="line" [flatten]="false">Network: {{ network() }}</text>
      @for (mode of modes; track mode.value) {
        <view class="button" [flatten]="false" [accessibility-label]="mode.label" (tap)="setNetwork(mode.value)">
          <text class="button-label">{{ mode.label }}</text>
        </view>
      }
      <view class="button" [flatten]="false" accessibility-label="Open lazy page" (tap)="openLazy()">
        <text class="button-label">Open lazy page</text>
      </view>
      <text class="line" [flatten]="false">Navigation: {{ navigation() }}</text>
    </view>
  `,
})
export class NetworkComponent {
  private readonly router = inject(Router);
  protected readonly network = signal('normal');
  protected readonly navigation = signal('none');
  protected readonly modes = [
    { value: 'dropped', label: 'Drop network' },
    { value: 'slow', label: 'Slow network' },
    { value: 'normal', label: 'Restore network' },
  ];
  private started = 0;

  constructor() {
    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.started = Date.now();
        this.navigation.set('loading');
      } else if (event instanceof NavigationError) {
        const message = event.error instanceof Error ? event.error.message : String(event.error);
        this.navigation.set(`failed after ${Date.now() - this.started} ms: ${message}`);
      }
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  protected setNetwork(mode: string): void {
    fetch(lynxAssetUrl(`__network/${mode}`)).then(
      (response) => this.network.set(response.ok ? mode : `not set (${response.status})`),
      () => this.network.set('not set: run this screen under run.mjs'),
    );
  }

  protected openLazy(): void {
    // A failed navigation rejects too; NavigationError above already shows it.
    this.router.navigateByUrl('/lazy').catch(() => undefined);
  }
}
