import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { LynxObject, lynxAssetUrl, lynxSelectRoot, lynxSelectUniqueID } from 'angular-lynx';
import { LYNX_ELEMENTS, type LynxTouchEvent } from 'angular-lynx/elements';
import { lynxEventSource } from 'angular-lynx/http';
import type { Subscription } from 'rxjs';

import { BackButtonComponent } from './back-button.component.js';

/**
 * The platform APIs that have no element of their own: a query on the page root, a query
 * by an event's uid, server-sent events, and lynx.reload. Each shows its result on screen.
 */
@Component({
  selector: 'app-platform',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <text class="title" [flatten]="false">Platform APIs</text>

      <view class="button" [flatten]="false" accessibility-label="Toggle grayscale" (tap)="toggleGrayscale()">
        <text class="button-label">{{ grayscale() ? 'Colour page' : 'Grayscale page' }}</text>
      </view>

      <view class="boxes" [flatten]="false" (tap)="paintTapped($event)">
        <view class="box" [flatten]="false" accessibility-label="Box 1"></view>
        <view class="box" [flatten]="false" accessibility-label="Box 2"></view>
        <view class="box" [flatten]="false" accessibility-label="Box 3"></view>
      </view>
      <text class="line" [flatten]="false">Painted uid: {{ paintedUid() }}</text>

      <view class="button" [flatten]="false" accessibility-label="Connect SSE" (tap)="connect()">
        <text class="button-label">Connect SSE</text>
      </view>
      <text class="line" [flatten]="false">SSE: {{ sse() }}</text>

      <view class="button" [flatten]="false" accessibility-label="Reload with data" (tap)="reload()">
        <text class="button-label">Reload with data</text>
      </view>
    </view>
  `,
})
export class PlatformComponent {
  private readonly lynxObject = inject(LynxObject);
  protected readonly grayscale = signal(false);
  protected readonly paintedUid = signal('none');
  protected readonly sse = signal('not connected');
  private subscription?: Subscription;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subscription?.unsubscribe());
  }

  protected toggleGrayscale(): void {
    this.grayscale.update((on) => !on);
    lynxSelectRoot().setNativeProps({ filter: this.grayscale() ? 'grayscale(100%)' : 'none' });
  }

  /** One handler on the row; the tapped child arrives as event.target. */
  protected paintTapped(event: LynxTouchEvent): void {
    if (event.target.uid === event.currentTarget.uid) return;
    lynxSelectUniqueID(event.target.uid).setNativeProps({ 'background-color': '#e5484d' });
    this.paintedUid.set(String(event.target.uid));
  }

  protected connect(): void {
    this.subscription?.unsubscribe();
    let count = 0;
    this.sse.set('connecting');
    // The test server's /sse sends three events, named and unnamed, then holds the line open.
    this.subscription = lynxEventSource(lynxAssetUrl('sse'), { events: ['tick'] }).subscribe({
      next: (event) => this.sse.set(`${++count} events, last ${event.type}: ${event.data}`),
      error: () => this.sse.set(`error after ${count} events`),
    });
  }

  protected reload(): void {
    void this.lynxObject.reload({ mockData: 'Reloaded' });
  }
}
