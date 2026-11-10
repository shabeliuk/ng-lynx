import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

/**
 * Styled entirely with Tailwind utility classes — no `.css`/`.scss` of our own,
 * only the generated utility stylesheet from `tailwind.css`. Tailwind scans
 * this file (see tailwind.config.ts `content`) and emits exactly the classes
 * it finds: in the template, and in the string literals below, which is why
 * classes picked at runtime are written out in full rather than built up
 * from pieces (`'bg-' + colour` would never be generated).
 *
 * Every utility here is in `@lynx-js/tailwind-preset`'s Lynx-supported subset.
 * Each card covers one family, so a missing or wrong one is easy to spot. The
 * preset has no `uppercase` (Lynx has no text-transform), so the card labels
 * are typed in capitals.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <scroll-view class="h-full bg-slate-900" scroll-orientation="vertical">
      <view class="flex flex-col gap-4 px-6 pb-10 pt-[56px]">
        <view class="flex flex-col gap-2 p-4 bg-slate-800 rounded-xl">
          <text class="text-2xl font-bold text-white">Styled with Tailwind</text>
          <text class="text-sm text-slate-400">
            Every card below is one family of utility classes, restricted to what Lynx supports by
            &#64;lynx-js/tailwind-preset. No CSS of our own.
          </text>
        </view>

        <!-- Colours: the palette, as background and as text. -->
        <view class="flex flex-col gap-3 p-4 bg-slate-800 rounded-xl">
          <text class="text-xs font-semibold tracking-widest text-slate-400">COLOURS</text>
          <view class="flex flex-row flex-wrap gap-2">
            @for (c of swatches; track c.name) {
              <view class="flex flex-col items-center justify-center w-16 h-16 rounded-lg {{ c.bg }}">
                <text class="text-xs font-semibold text-white">{{ c.name }}</text>
              </view>
            }
          </view>
          <view class="flex flex-row flex-wrap gap-3">
            <text class="text-base font-semibold text-rose-400">rose</text>
            <text class="text-base font-semibold text-amber-300">amber</text>
            <text class="text-base font-semibold text-emerald-400">emerald</text>
            <text class="text-base font-semibold text-sky-400">sky</text>
            <text class="text-base font-semibold text-violet-400">violet</text>
          </view>
        </view>

        <!-- Typography: sizes, weights, style, case, spacing, alignment. -->
        <view class="flex flex-col gap-1 p-4 bg-slate-800 rounded-xl">
          <text class="text-xs font-semibold tracking-widest text-slate-400">TYPOGRAPHY</text>
          <text class="text-xs text-white">text-xs</text>
          <text class="text-sm text-white">text-sm</text>
          <text class="text-base text-white">text-base</text>
          <text class="text-lg text-white">text-lg</text>
          <text class="text-xl text-white">text-xl</text>
          <text class="text-3xl text-white">text-3xl</text>
          <view class="flex flex-row flex-wrap gap-3 mt-2">
            <text class="text-base font-light text-white">light</text>
            <text class="text-base font-normal text-white">normal</text>
            <text class="text-base font-semibold text-white">semibold</text>
            <text class="text-base font-black text-white">black</text>
            <text class="text-base italic text-white">italic</text>
            <text class="text-base underline text-white">underline</text>
            <text class="text-base line-through text-white">line-through</text>
          </view>
          <text class="mt-2 text-sm tracking-widest text-sky-300">tracking-widest</text>
          <text class="text-sm text-center text-slate-300">text-center</text>
          <text class="text-sm text-right text-slate-300">text-right</text>
        </view>

        <!-- Borders, rounding, shadows, opacity. -->
        <view class="flex flex-col gap-3 p-4 bg-slate-800 rounded-xl">
          <text class="text-xs font-semibold tracking-widest text-slate-400">SHAPE</text>
          <view class="flex flex-row flex-wrap gap-3">
            <view class="w-16 h-16 bg-sky-500 rounded-none"></view>
            <view class="w-16 h-16 bg-sky-500 rounded-md"></view>
            <view class="w-16 h-16 bg-sky-500 rounded-2xl"></view>
            <view class="w-16 h-16 bg-sky-500 rounded-full"></view>
          </view>
          <view class="flex flex-row flex-wrap gap-3">
            <view class="w-16 h-16 rounded-lg border border-white"></view>
            <view class="w-16 h-16 rounded-lg border-2 border-amber-400"></view>
            <view class="w-16 h-16 rounded-lg border-4 border-emerald-400"></view>
            <view class="w-16 h-16 rounded-lg border-4 border-dashed border-rose-400"></view>
          </view>
          <view class="flex flex-row flex-wrap gap-3">
            <view class="w-16 h-16 rounded-lg bg-violet-500 opacity-100"></view>
            <view class="w-16 h-16 rounded-lg bg-violet-500 opacity-75"></view>
            <view class="w-16 h-16 rounded-lg bg-violet-500 opacity-50"></view>
            <view class="w-16 h-16 rounded-lg bg-violet-500 opacity-25"></view>
          </view>
          <view class="flex flex-row gap-4 p-3 bg-slate-100 rounded-lg">
            <view class="w-14 h-14 bg-white rounded-lg shadow-sm"></view>
            <view class="w-14 h-14 bg-white rounded-lg shadow-md"></view>
            <view class="w-14 h-14 bg-white rounded-lg shadow-xl"></view>
          </view>
        </view>

        <!-- Flex layout: distribution, alignment, growth, wrapping. -->
        <view class="flex flex-col gap-3 p-4 bg-slate-800 rounded-xl">
          <text class="text-xs font-semibold tracking-widest text-slate-400">LAYOUT</text>
          <view class="flex flex-row justify-between p-2 bg-slate-700 rounded-lg">
            <view class="w-10 h-10 bg-rose-400 rounded"></view>
            <view class="w-10 h-10 bg-amber-400 rounded"></view>
            <view class="w-10 h-10 bg-emerald-400 rounded"></view>
          </view>
          <view class="flex flex-row justify-center gap-2 p-2 bg-slate-700 rounded-lg">
            <view class="w-10 h-10 bg-rose-400 rounded"></view>
            <view class="w-10 h-10 bg-amber-400 rounded"></view>
            <view class="w-10 h-10 bg-emerald-400 rounded"></view>
          </view>
          <view class="flex flex-row items-end gap-2 h-20 p-2 bg-slate-700 rounded-lg">
            <view class="w-10 h-6 bg-sky-400 rounded"></view>
            <view class="w-10 h-10 bg-sky-400 rounded"></view>
            <view class="w-10 h-14 bg-sky-400 rounded"></view>
          </view>
          <view class="flex flex-row gap-2 p-2 bg-slate-700 rounded-lg">
            <view class="w-10 h-10 bg-violet-400 rounded"></view>
            <view class="flex-1 flex flex-col justify-center h-10 px-2 bg-violet-600 rounded">
              <text class="text-xs text-white">flex-1 takes the rest</text>
            </view>
            <view class="w-10 h-10 bg-violet-400 rounded"></view>
          </view>
        </view>

        <!-- Transforms. -->
        <view class="flex flex-col gap-3 p-4 bg-slate-800 rounded-xl">
          <text class="text-xs font-semibold tracking-widest text-slate-400">TRANSFORMS</text>
          <view class="flex flex-row justify-around items-center h-20">
            <view class="w-12 h-12 bg-amber-400 rounded-md rotate-12"></view>
            <view class="w-12 h-12 bg-amber-400 rounded-md -rotate-45"></view>
            <view class="w-12 h-12 bg-amber-400 rounded-md scale-75"></view>
            <view class="w-12 h-12 bg-amber-400 rounded-md scale-125"></view>
            <view class="w-12 h-12 bg-amber-400 rounded-md translate-y-3"></view>
          </view>
        </view>

        <!-- Classes that change at runtime. -->
        <view class="flex flex-col gap-3 p-4 bg-slate-800 rounded-xl">
          <text class="text-xs font-semibold tracking-widest text-slate-400">STATE</text>
          <view class="flex flex-col items-center py-3 px-4 bg-red-500 rounded-full" (tap)="taps.set(taps() + 1)">
            <text class="text-base font-semibold text-white">Tapped {{ taps() }}×</text>
          </view>
          <view
            class="flex flex-row items-center gap-3 p-3 rounded-lg transition-colors duration-300"
            [class]="on() ? 'bg-emerald-600' : 'bg-slate-700'"
            (tap)="on.set(!on())"
          >
            <view class="w-5 h-5 rounded-full" [class]="on() ? 'bg-white' : 'bg-slate-400'"></view>
            <text class="text-base text-white">{{ on() ? 'On: bg-emerald-600' : 'Off: bg-slate-700' }}</text>
          </view>
          <view class="h-3 bg-slate-700 rounded-full overflow-hidden">
            <view class="h-3 bg-sky-400 rounded-full" [class]="progressWidth()"></view>
          </view>
          <view class="flex flex-row gap-2">
            @for (step of steps; track step) {
              <view
                class="flex-1 flex flex-col items-center py-2 rounded-md"
                [class]="progress() === step ? 'bg-sky-500' : 'bg-slate-700'"
                (tap)="progress.set(step)"
              >
                <text class="text-sm text-white">{{ step }}/4</text>
              </view>
            }
          </view>
        </view>
      </view>
    </scroll-view>
  `,
})
export class AppComponent {
  readonly taps = signal(0);
  readonly on = signal(true);
  readonly progress = signal(2);
  readonly steps = [1, 2, 3, 4];

  /** Whole class names, so Tailwind's scan of this file generates each one. */
  private readonly widths = ['w-1/4', 'w-2/4', 'w-3/4', 'w-full'];
  readonly progressWidth = computed(() => this.widths[this.progress() - 1]);

  readonly swatches = [
    { name: 'red', bg: 'bg-red-500' },
    { name: 'orange', bg: 'bg-orange-500' },
    { name: 'amber', bg: 'bg-amber-500' },
    { name: 'green', bg: 'bg-green-500' },
    { name: 'teal', bg: 'bg-teal-500' },
    { name: 'sky', bg: 'bg-sky-500' },
    { name: 'indigo', bg: 'bg-indigo-500' },
    { name: 'pink', bg: 'bg-pink-500' },
  ];
}
