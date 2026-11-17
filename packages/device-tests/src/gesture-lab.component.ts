import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { bindWorklet, LynxGesture, type LynxGestures } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';
import { endOnUpdate, failOnStart, recordPhase, recordUpdate } from './worklets.js';

/** `onBegin` etc. for each phase, each reporting `<box>:<prefix><phase>`. */
const phases = (label: string, names: string[], prefix = '') =>
  Object.fromEntries(
    names.map((phase) => [
      `on${phase[0]!.toUpperCase()}${phase.slice(1)}`,
      bindWorklet(recordPhase, { label, phase: prefix + phase }),
    ]),
  );

/** Every phase, with `onUpdate` also reporting the event's params. Used by fling. */
const phased = (label: string) => ({
  ...phases(label, ['begin', 'start', 'end']),
  onUpdate: bindWorklet(recordUpdate, { label, phase: 'update' }),
});

/**
 * Gesture types beyond pan, a relation, and `ctx.gesture.fail()` / `end()`. Each box
 * logs the phases its detectors fire, with repeats collapsed (`update×5`), so a flow
 * can check the order.
 */
@Component({
  selector: 'app-gesture-lab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS, LynxGesture],
  // Five boxes and their logs outgrow the CI emulator's screen: the page scrolls, and
  // the flow scrolls each box into view before it touches it.
  host: { class: 'fill' },
  template: `
    <scroll-view class="fill" scroll-orientation="vertical">
    <view class="page">
      <app-back-button></app-back-button>
      @for (box of boxes; track box.key) {
        <view
          class="lab-box"
          [lynxGesture]="box.gestures"
          [attr.accessibility-label]="box.key + ' box'"
          (mainThreadCallback)="record($event)"
        >
          <text class="button-label">{{ box.key }}</text>
        </view>
        <text class="lab-log" [flatten]="false">{{ box.key }}: {{ logs()[box.key] || '-' }}</text>
        @if (params()[box.key]; as last) {
          <text class="lab-params" [flatten]="false">{{ box.key }} params: {{ last }}</text>
        }
      }
      <view class="button" accessibility-label="Clear log" (bindtap)="logs.set({}); params.set({})">
        <text class="button-label">Clear log</text>
      </view>
    </view>
    </scroll-view>
  `,
})
export class GestureLabComponent {
  protected readonly boxes: { key: string; gestures: LynxGestures }[] = [
    { key: 'tap', gestures: { tap: { type: 'tap', callbacks: phases('tap', ['begin', 'start', 'end']) } } },
    {
      key: 'longpress',
      gestures: { longpress: { type: 'longpress', callbacks: phases('longpress', ['begin', 'start', 'end']) } },
    },
    {
      // A tap that waits for the long press to fail: a quick tap is a tap, a hold only a long press.
      key: 'race',
      gestures: {
        tap: { type: 'tap', callbacks: phases('race', ['start'], 'tap-'), waitFor: ['hold'] },
        hold: { type: 'longpress', callbacks: phases('race', ['start'], 'hold-') },
      },
    },
    {
      key: 'fail',
      gestures: {
        pan: {
          type: 'pan',
          callbacks: {
            ...phases('fail', ['update', 'end']),
            onStart: bindWorklet(failOnStart, { label: 'fail', phase: 'start' }),
          },
        },
      },
    },
    {
      key: 'end',
      gestures: {
        pan: {
          type: 'pan',
          callbacks: {
            ...phases('end', ['start', 'end']),
            onUpdate: bindWorklet(endOnUpdate, { label: 'end', phase: 'update' }),
          },
        },
      },
    },
    {
      // A fast swipe. A fling only follows a touch the element won, and a fling detector
      // alone never wins one: it sits out while the finger is down. The pan claims the
      // touch, and the two must be simultaneous or the pan's win shuts the fling out.
      key: 'fling',
      gestures: {
        pan: { type: 'pan', callbacks: phases('fling', ['start'], 'pan-'), simultaneousWith: ['fling'] },
        fling: { type: 'fling', callbacks: phased('fling'), simultaneousWith: ['pan'] },
      },
    },
  ];

  protected readonly logs = signal<Record<string, string>>({});
  /** The last `onUpdate` params per box: what a fling's event carries. */
  protected readonly params = signal<Record<string, string>>({});

  /** `"<box>:<phase>"` from any box's worklets, or `"<box>~<params json>"`. */
  protected record(message: unknown): void {
    const text = String(message);
    const tilde = text.indexOf('~');
    if (tilde > 0 && !text.slice(0, tilde).includes(':')) {
      this.params.set({ ...this.params(), [text.slice(0, tilde)]: text.slice(tilde + 1) });
      return;
    }
    const [box, entry] = String(message).split(':') as [string, string];
    const log = (this.logs()[box] ?? '').split(',').filter(Boolean);
    const last = log.at(-1);
    if (last?.replace(/×\d+$/, '') === entry) {
      log[log.length - 1] = `${entry}×${Number(last.split('×')[1] ?? 1) + 1}`;
    } else {
      log.push(entry);
    }
    this.logs.set({ ...this.logs(), [box]: log.join(',') });
  }
}
