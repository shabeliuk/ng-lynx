/**
 * Inline 'main thread' functions in every form the transform takes, for
 * harness-inline-main-thread.ts. verify/build.mjs applies pluginAngularLynx's two
 * transforms to this file: the Background form when it's imported, and the
 * Main-Thread half for `app.component.ts?ng-lynx-main-thread`.
 */
import { Component, Input, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { backgroundFunction, LynxGesture, type LynxGestures, LynxMainThread, mainThreadRef } from 'ng-lynx';
import { runOnBackground, type WorkletContext } from 'ng-lynx/worklet';

import { percent } from './helpers.mt.js';

const STEP = 2;
const LIMIT = 5;

/** A module-level 'main thread' function: captured by the others, callable there. */
export function clamp(value: number, max: number): number {
  'main thread';
  return Math.min(value, max);
}

/** Two of these: each binding captures its own instance's fields. */
@Component({
  selector: 'app-counter',
  standalone: true,
  imports: [LynxMainThread],
  template: `<view class="counter" [lynxMainThread]="{ tap: onTap }"></view>`,
})
export class CounterComponent {
  /** Every instance, in creation order, for the harness. */
  static readonly instances: CounterComponent[] = [];

  @Input() start = 0;
  readonly seen = signal(-1);
  readonly report = backgroundFunction((value: number) => this.seen.set(value));

  readonly onTap = (_ctx: WorkletContext) => {
    'main thread';
    void runOnBackground(this.report)(this.start + 1);
  };

  constructor() {
    CounterComponent.instances.push(this);
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [CounterComponent, LynxGesture, LynxMainThread],
  template: `
    <view class="tapper" [lynxMainThread]="{ tap: onTap }"></view>
    <view class="gesture" [lynxGesture]="gestures"></view>
    <view class="leaky" [lynxMainThread]="{ tap: leaky }"></view>
    <app-counter [start]="100"></app-counter>
    <app-counter [start]="200"></app-counter>
  `,
})
export class AppComponent {
  // Declared before the fields it reads: what it captures is read when it's bound.
  readonly onTap = (ctx: WorkletContext) => {
    'main thread';
    this.count.current = clamp(this.count.current + STEP, LIMIT);
    ctx.setStyle(`opacity: ${percent(this.count.current / LIMIT)}`);
    void runOnBackground(this.report)(this.count.current);
  };

  readonly count = mainThreadRef(0);
  readonly reported = signal(-1);
  readonly report = backgroundFunction((value: number) => this.reported.set(value));
  readonly factor = 3;
  readonly gestureMarks = mainThreadRef<string[]>([]);

  readonly gestures: LynxGestures = {
    pan: {
      type: 'pan',
      callbacks: {
        onStart: (ctx: WorkletContext) => {
          'main thread';
          this.gestureMarks.current = [...this.gestureMarks.current, `start:${ctx.params ? 'params' : 'none'}`];
        },
      },
    },
  };

  /** A method: becomes a field holding the stand-in. */
  triple(value: number): number {
    'main thread';
    return value * this.factor;
  }

  /** Calls a 'main thread' function it's handed. */
  readonly applyPlusOne = (fn: (value: number) => number, value: number) => {
    'main thread';
    return fn(value) + 1;
  };

  readonly readCount = () => {
    'main thread';
    return this.count.current;
  };

  readonly readGestureMarks = () => {
    'main thread';
    return this.gestureMarks.current.join(',');
  };

  /** Captures a signal, which can't cross: a dev build says so. */
  readonly leaky = () => {
    'main thread';
    return this.reported;
  };
}
