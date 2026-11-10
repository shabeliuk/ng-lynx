import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

/** The tutorial's page dots: the Background Thread's view of the swiper. */
@Component({
  selector: 'app-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="indicator">
      @for (dot of dots(); track dot) {
        <view class="indicator-dot" [class.active]="dot === current()" (tap)="select.emit(dot)"></view>
      }
    </view>
  `,
})
export class IndicatorComponent {
  readonly total = input.required<number>();
  readonly current = input.required<number>();
  readonly select = output<number>();
  readonly dots = computed(() => Array.from({ length: this.total() }, (_, i) => i));
}
