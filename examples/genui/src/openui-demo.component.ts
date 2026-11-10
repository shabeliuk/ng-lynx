/**
 * OpenUI demo: a canned LLM response in the OpenUI language, replayed
 * chunk-by-chunk to show streaming rendering. `<openui-renderer>` parses
 * whatever has arrived so far, renders it from the Angular library, and
 * fires structured actions (`@ToAssistant`) once streaming ends.
 *
 * Also demonstrates the *runtime* mode: once the plan finishes streaming,
 * `slotsQuery` calls the (mock) `check_availability` tool through
 * `toolProvider` — a real async round-trip through `@openuidev/lang-core`'s
 * `createQueryManager`, not a canned value. "Refresh availability" fires
 * `@Run(slotsQuery)` to force a refetch.
 *
 * The "Must-see" card is genui 0.7's `@Append`: the list renders from
 * `$stops` with `@Each`, and "Add a stop" appends to it.
 */
import {
  ChangeDetectionStrategy,
  Component,
  NO_ERRORS_SCHEMA,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';

import type { ActionEvent } from '@openuidev/lang-core';
import { createOpenUiLibrary, OpenuiRenderer } from 'angular-lynx/genui';

const LLM_RESPONSE = [
  '$notes = ""',
  '$stops = ["Kinkaku-ji"]',
  'root = Stack([hero, planCard, stopsCard, notesField, availability, actions], "column", false, "l")',
  'hero = Text("Trip planner", "h2")',
  'planCard = Card([header, day1, day2, tags], "card")',
  'header = CardHeader("Kyoto, 2 days", "walking-friendly")',
  'day1 = Text("Day 1 — Fushimi Inari at sunrise, Gion in the evening")',
  'day2 = Text("Day 2 — Arashiyama bamboo grove, tea by the river")',
  'tags = Row([Tag("temples"), Tag("food"), Tag("scenic")])',
  'stopsCard = Card([CardHeader("Must-see", "Stops: " + @Count($stops)), stopList, addStop], "card")',
  'stopList = Stack(@Each($stops, "stop", Text(stop)))',
  'addStop = Button("Add a stop", Action([@Set($stops, @Append($stops, "Nishiki Market"))]), "tertiary")',
  'notesField = TextField("Anything to add?", "", null, null, null, "$notes")',
  'slotsQuery = Query("check_availability", { notes: $notes }, { slots: [] })',
  'availability = Text("Available slots: " + @Count(slotsQuery.slots))',
  'actions = Buttons([Button("Refresh availability", Action([@Run(slotsQuery)]), "secondary"), Button("Looks great", Action([@ToAssistant("plan approved")]), "primary")])',
].join('\n');

/** Mock backend for the `slotsQuery` Query() above — a real async round-trip, just not a real network call. */
const toolProvider = {
  async check_availability(args: { notes?: string }): Promise<{ slots: string[] }> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const base = ['9:00 AM', '2:00 PM', '4:30 PM'];
    return { slots: args.notes ? base.slice(0, 2) : base };
  },
};

const CHUNK_SIZE = 24;
const CHUNK_DELAY_MS = 80;

@Component({
  selector: 'openui-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiRenderer],
  template: `
    <view class="demo">
      <openui-renderer
        [response]="response()"
        [library]="library"
        [streaming]="streaming()"
        [toolProvider]="toolProvider"
        (action)="onAction($event)"
      />
      <text class="event-log">{{ lastEvent() }}</text>
    </view>
  `,
})
export class OpenuiDemoComponent implements OnInit, OnDestroy {
  readonly library = createOpenUiLibrary();
  readonly response = signal('');
  readonly streaming = signal(true);
  readonly toolProvider = toolProvider;
  readonly lastEvent = signal('streaming canned LLM output…');

  private timer: ReturnType<typeof setInterval> | undefined;

  ngOnInit(): void {
    let offset = 0;
    this.timer = setInterval(() => {
      offset += CHUNK_SIZE;
      this.response.set(LLM_RESPONSE.slice(0, offset));
      if (offset >= LLM_RESPONSE.length) {
        clearInterval(this.timer!);
        this.timer = undefined;
        this.streaming.set(false);
        this.lastEvent.set('stream complete — actions live, checking availability…');
      }
    }, CHUNK_DELAY_MS);
  }

  ngOnDestroy(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
  }

  onAction(event: ActionEvent): void {
    const state = (event as { formState?: Record<string, { value?: unknown }> }).formState;
    const notes = state?.['$notes']?.value;
    this.lastEvent.set(
      `→ agent: ${event.type} "${event.humanFriendlyMessage}"${notes ? ` (notes: ${String(notes)})` : ''}`,
    );
  }
}
