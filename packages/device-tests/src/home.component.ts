import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { lynxGlobalProps, lynxInitData } from 'angular-lynx';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

/** First paint, tap handling, and the way to every other screen. */
@Component({
  selector: 'app-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="page">
      <text class="title" [flatten]="false">Count: {{ count() }}</text>
      <text class="line" [flatten]="false">{{ parity() }}</text>
      <text class="line" [flatten]="false">Init data: {{ initData().mockData }}</text>
      <text class="line" [flatten]="false">Processor: {{ initData().processed }}</text>
      <!-- Only a native host fills these: see examples/genui/ios, HostDataTestHooks. -->
      @if (initData().named) {
        <text class="line" [flatten]="false">Named: {{ initData().named }}</text>
      }
      @if (globalProps().hostNote) {
        <text class="line" [flatten]="false">Global: {{ globalProps().hostNote }}</text>
      }
      <view class="button" [flatten]="false" accessibility-label="Increment" (tap)="count.set(count() + 1)">
        <text class="button-label">Increment</text>
      </view>
      @for (link of links; track link.path) {
        <view class="button" [flatten]="false" [accessibility-label]="link.label" (tap)="router.navigateByUrl(link.path)">
          <text class="button-label">{{ link.label }}</text>
        </view>
      }
    </view>
  `,
})
export class HomeComponent {
  protected readonly router = inject(Router);
  protected readonly count = signal(0);
  protected readonly parity = computed(() => (this.count() % 2 === 0 ? 'Even' : 'Odd'));
  protected readonly initData = lynxInitData<{ mockData?: string; processed?: string; named?: string }>();
  protected readonly globalProps = lynxGlobalProps<{ hostNote?: string }>();
  protected readonly links = [
    { label: 'Open lazy page', path: '/lazy' },
    { label: 'Open user 7', path: '/users/7' },
    { label: 'Open list', path: '/list' },
    { label: 'Open input', path: '/input' },
    { label: 'Open main thread', path: '/main-thread' },
    { label: 'Open gesture', path: '/gesture' },
    { label: 'Open gesture lab', path: '/gesture-lab' },
    { label: 'Open attributes', path: '/attributes' },
    { label: 'Open platform', path: '/platform' },
  ];
}
