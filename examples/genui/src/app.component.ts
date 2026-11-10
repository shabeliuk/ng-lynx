/**
 * GenUI example — a retirement planner driven by a real LLM, plus the two
 * protocol demos it grew out of:
 *
 *  - **Planner** tab: describe the retirement you want; the model (Gemini
 *    through the dev server's `/api/chat` proxy, or a scripted offline agent)
 *    asks questions as generated OpenUI forms, and a deterministic calculator
 *    works out the pot and the monthly investment. See `src/planner/`.
 *  - **A2UI** tab: agent-driven JSON messages → `<a2ui-surface>` (protocol
 *    machinery from `@lynx-js/genui/a2ui/store`, Angular basic catalog).
 *  - **OpenUI** tab: streamed OpenUI-language text → `<openui-renderer>`
 *    (parser/evaluator from `@openuidev/lang-core`, Angular library).
 *
 * The A2UI and OpenUI demos run canned in-process agents — no network, no
 * keys — so the full loop (render → interact → action → new UI) works
 * offline. So does the planner, on its offline agent.
 */
import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { A2uiDemoComponent } from './a2ui-demo.component.js';
import { OpenuiDemoComponent } from './openui-demo.component.js';
import { PlannerComponent } from './planner/planner.component.js';

type Tab = 'planner' | 'a2ui' | 'openui';

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiDemoComponent, OpenuiDemoComponent, PlannerComponent],
  template: `
    <view class="app">
      <text class="title">{{ tab() === 'planner' ? 'Retirement planner' : 'GenUI × Angular Lynx' }}</text>
      <view class="tabs">
        @for (item of tabs; track item.id) {
          <view class="tab" [class.tab-active]="tab() === item.id" (tap)="tab.set(item.id)">
            <text class="tab-label">{{ item.label }}</text>
          </view>
        }
      </view>
      @switch (tab()) {
        @case ('planner') {
          <retirement-planner />
        }
        @case ('a2ui') {
          <a2ui-demo />
        }
        @case ('openui') {
          <openui-demo />
        }
      }
    </view>
  `,
})
export class AppComponent {
  readonly tabs: readonly { id: Tab; label: string }[] = [
    { id: 'planner', label: 'Planner' },
    { id: 'a2ui', label: 'A2UI demo' },
    { id: 'openui', label: 'OpenUI demo' },
  ];
  readonly tab = signal<Tab>('planner');
}
