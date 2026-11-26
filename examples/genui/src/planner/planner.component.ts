/**
 * The retirement planner screen: a conversation where the assistant answers
 * with generated UI.
 *
 *   user text / form answers ─► composeUserMessage (+ <planner_state>)
 *        ─► agent (Gemini via /api/chat, or the offline script)
 *        ─► OpenUI Lang, streamed ─► <openui-renderer> with the planner library
 *        ─► user fills the form, taps Continue ─► (action) with form state
 *        ─► harvestAnswers ─► profile ─► next turn
 *
 * The results screen's `Query("calculate_plan", …)` runs `tools.ts` against
 * the profile on the device — no model round-trip for a what-if slider.
 *
 * Only the latest assistant screen is live; earlier turns collapse into the
 * transcript as one line each (what the user said or confirmed), and the
 * "What I know" chips show the confirmed profile at all times.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  NO_ERRORS_SCHEMA,
  type OnDestroy,
  type OnInit,
  signal,
} from '@angular/core';

import { LynxGlobalEvents, LynxModel } from 'ng-lynx';
import { type ActionEvent, createOpenUiLibrary, createParser, OpenuiRenderer } from 'ng-lynx/genui';

import { type Agent, AgentError, type AgentInfo, connectAgent, ScriptedAgent } from './agent.js';
import { PLANNER_LIBRARY_COMPONENTS } from './components.js';
import {
  type ChatMessage,
  composeUserMessage,
  describeAnswers,
  describeProblems,
  isSevereError,
} from './conversation.js';
import {
  changedFields,
  formatField,
  harvestAnswers,
  mergeProfile,
  PROFILE_FIELDS,
  type PlannerProfile,
} from './profile.js';
import { createPlannerTools } from './tools.js';

interface TranscriptEntry {
  text: string;
  detail?: string;
}

const SUGGESTIONS = [
  'Retire at 60, travel twice a year and buy a small boat',
  'Move to Portugal at 58 and live simply by the sea',
  'Keep working part-time until 67, then garden and see the grandkids',
];

/** `$field` → value for every confirmed field, so generated forms pre-fill and Queries start from it. */
function stateFromProfile(profile: PlannerProfile): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const spec of PROFILE_FIELDS) {
    const value = profile[spec.key];
    if (value !== undefined) state[`$${spec.key}`] = value;
  }
  for (const goal of profile.goals ?? []) {
    const name = goal.label.replace(/(^|\s)(\w)/g, (_, _space: string, letter: string) => letter.toUpperCase());
    state[`$goal${name}Amount`] = goal.amount;
    state[`$goal${name}Age`] = goal.age;
  }
  return state;
}

@Component({
  selector: 'retirement-planner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [OpenuiRenderer, LynxModel],
  // The host element becomes a plain view in the Lynx tree, between `.app`
  // and `.planner` — it has to grow too, or `.planner`'s `flex: 1` has nothing
  // to fill and the composer floats mid-screen instead of pinning to the bottom.
  host: { class: 'planner-host' },
  template: `
    <view class="planner" [style.padding-bottom]="keyboardInset()">
      <view class="planner-bar">
        <text [class]="'agent-badge agent-' + agentInfo().kind">{{ agentInfo().label }}</text>
        @if (transcript().length > 0) {
          <view class="planner-reset" (tap)="reset()"><text class="planner-reset-text">Start over</text></view>
        }
      </view>

      <scroll-view class="planner-scroll" scroll-orientation="vertical">
        @if (facts().length > 0) {
          <view class="facts">
            <text class="facts-title">What I know</text>
            <view class="facts-chips">
              @for (fact of facts(); track fact) {
                <view class="fact"><text class="fact-text">{{ fact }}</text></view>
              }
            </view>
          </view>
        }

        @if (transcript().length === 0 && !response()) {
          <view class="welcome">
            <text class="welcome-title">What does your retirement look like?</text>
            <text class="welcome-body">
              Describe it in your own words — where, when, how you want to spend your days. I'll ask a few questions
              and work out how much you need to invest from today.
            </text>
            @for (suggestion of suggestions; track suggestion) {
              <view class="suggestion" (tap)="send(suggestion)">
                <text class="suggestion-text">{{ suggestion }}</text>
              </view>
            }
            @if (agentInfo().reason; as reason) {
              <text class="welcome-note">{{ reason }} — using scripted questions.</text>
            }
          </view>
        }

        @for (entry of transcript(); track $index) {
          <view class="bubble">
            <text class="bubble-text">{{ entry.text }}</text>
            @if (entry.detail; as detail) {
              <text class="bubble-detail">{{ detail }}</text>
            }
          </view>
        }

        @if (thinking()) {
          <view class="thinking"><text class="thinking-text">Thinking…</text></view>
        }

        @if (response()) {
          <view class="assistant-screen">
            <openui-renderer
              [response]="response()"
              [library]="library"
              [streaming]="streaming()"
              [toolProvider]="tools"
              [initialState]="initialState()"
              (action)="onAction($event)"
            />
          </view>
        }

        @if (renderWarning(); as warning) {
          <view class="planner-error">
            <text class="planner-error-text">{{ warning }}</text>
            <view class="planner-error-actions">
              <view class="planner-error-button" (tap)="retryScreen()"><text class="planner-error-button-text">Try again</text></view>
            </view>
          </view>
        }

        @if (error(); as message) {
          <view class="planner-error">
            <text class="planner-error-text">{{ message }}</text>
            <view class="planner-error-actions">
              @if (failedTurn) {
                <view class="planner-error-button" (tap)="retry()"><text class="planner-error-button-text">Try again</text></view>
              }
              @if (agentInfo().kind === 'llm') {
                <view class="planner-error-button" (tap)="useOffline()">
                  <text class="planner-error-button-text">Use offline demo</text>
                </view>
              }
            </view>
          </view>
        }
      </scroll-view>

      <view class="composer">
        <input
          class="composer-input"
          placeholder="Describe your plans, or ask a question…"
          [lynxModel]="draft()"
          (lynxModelChange)="draft.set($event)"
          (confirm)="send(draft())"
        />
        <view [class]="canSend() ? 'composer-send' : 'composer-send composer-send-disabled'" (tap)="send(draft())">
          <text class="composer-send-text">Send</text>
        </view>
      </view>
    </view>
  `,
})
export class PlannerComponent implements OnInit, OnDestroy {
  readonly library = createOpenUiLibrary({ components: PLANNER_LIBRARY_COMPONENTS });
  readonly suggestions = SUGGESTIONS;

  readonly profile = signal<PlannerProfile>({});
  readonly tools = createPlannerTools(() => this.profile());
  readonly initialState = computed(() => stateFromProfile(this.profile()));

  readonly agentInfo = signal<AgentInfo>({ kind: 'offline', label: 'Connecting…' });
  readonly transcript = signal<TranscriptEntry[]>([]);
  readonly response = signal('');
  readonly streaming = signal(false);
  readonly waiting = signal(false);
  readonly error = signal<string | undefined>(undefined);
  /** Set when a screen still has problems after its one correction round. */
  readonly renderWarning = signal<string | undefined>(undefined);
  readonly draft = signal('');

  /**
   * Lynx's `<input>` doesn't move out of the keyboard's way, and the composer sits
   * at the bottom of the screen, under it. While the keyboard is open, pad the
   * planner by its height (`keyboardstatuschanged`, sent by the engine): the
   * conversation shrinks and the composer sits just above the keyboard. The
   * composer's own 28px bottom padding is for the home indicator, which the
   * keyboard covers, so most of it comes off.
   */
  private readonly keyboard = inject(LynxGlobalEvents).latest<[status: string, height: number, compatHeight: number]>(
    'keyboardstatuschanged',
  );
  readonly keyboardInset = computed(() => {
    const keyboard = this.keyboard();
    return keyboard?.[0] === 'on' ? `${Math.max(0, keyboard[1] - 20)}px` : '0px';
  });

  readonly thinking = computed(() => this.waiting() && !this.response());
  readonly canSend = computed(() => !this.waiting() && this.draft().trim().length > 0);
  readonly facts = computed(() => {
    const profile = this.profile();
    const currency = profile.currency ?? (profile.country === 'EU' ? 'EUR' : 'GBP');
    const facts = PROFILE_FIELDS.filter((spec) => profile[spec.key] !== undefined).map(
      (spec) => `${spec.label}: ${formatField(spec, profile[spec.key], currency)}`,
    );
    for (const goal of profile.goals ?? []) {
      facts.push(`${goal.label}: ${formatField(PROFILE_FIELDS.find((s) => s.key === 'legacy')!, goal.amount, currency)} at ${goal.age}`);
    }
    return facts;
  });

  /** The last turn that failed, kept for "Try again" / "Use offline demo". */
  protected failedTurn: string | undefined;
  private agent: Agent | undefined;
  private messages: ChatMessage[] = [];
  private readonly parser = createParser(this.library.toJSONSchema(), this.library.root);
  private readonly signatures = this.library.toSpec().components;
  private correctedThisTurn = false;
  /** Where the current user turn starts in `messages`, and its content — for "Try again". */
  private turnStart = 0;
  private turnContent: string | undefined;
  private destroyed = false;

  ngOnInit(): void {
    void connectAgent().then((agent) => {
      if (this.destroyed) return;
      this.agent = agent;
      this.agentInfo.set(agent.info);
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
  }

  send(text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.waiting()) return;
    this.draft.set('');
    this.transcript.update((entries) => [...entries, { text: trimmed }]);
    this.beginTurn(composeUserMessage({ text: trimmed }, this.profile()));
  }

  onAction(event: ActionEvent): void {
    if (this.waiting() || event.type !== 'continue_conversation') return;
    const harvested = harvestAnswers((event as { formState?: Record<string, unknown> }).formState);
    const before = this.profile();
    const harvest = { ...harvested, updates: changedFields(before, harvested.updates) };
    const profile = mergeProfile(before, harvest.updates);
    this.profile.set(profile);
    const answered = Object.keys(harvest.updates).length > 0;
    this.transcript.update((entries) => [
      ...entries,
      { text: event.humanFriendlyMessage || 'Continue', detail: answered ? describeAnswers(harvest, profile) : undefined },
    ]);
    this.beginTurn(composeUserMessage({ form: { message: event.humanFriendlyMessage || 'Continue', harvest } }, profile));
  }

  reset(): void {
    if (this.waiting()) return;
    this.profile.set({});
    this.transcript.set([]);
    this.response.set('');
    this.error.set(undefined);
    this.renderWarning.set(undefined);
    this.messages = [];
    this.failedTurn = undefined;
  }

  /** Re-ask the last user turn from scratch, dropping the broken screen and its correction. */
  retryScreen(): void {
    if (this.waiting() || this.turnContent === undefined) return;
    this.messages.length = this.turnStart;
    this.beginTurn(this.turnContent);
  }

  private beginTurn(content: string): void {
    this.correctedThisTurn = false;
    this.turnStart = this.messages.length;
    this.turnContent = content;
    void this.runTurn(content);
  }

  retry(): void {
    const turn = this.failedTurn;
    if (turn) void this.runTurn(turn);
  }

  useOffline(): void {
    this.agent = new ScriptedAgent('Switched to the offline demo');
    this.agentInfo.set(this.agent.info);
    this.retry();
  }

  private async runTurn(content: string): Promise<void> {
    const agent = this.agent ?? (this.agent = await connectAgent());
    this.agentInfo.set(agent.info);
    this.error.set(undefined);
    this.renderWarning.set(undefined);
    this.failedTurn = undefined;
    this.messages.push({ role: 'user', content });
    this.waiting.set(true);
    this.streaming.set(true);
    this.response.set('');
    try {
      const text = await agent.respond(this.messages, this.profile(), (partial) => {
        if (!this.destroyed) this.response.set(partial);
      });
      if (this.destroyed) return;
      this.messages.push({ role: 'assistant', content: text });
      this.response.set(text);
      this.streaming.set(false);
      this.waiting.set(false);
      this.checkResponse(text);
    } catch (error) {
      if (this.destroyed) return;
      this.messages.pop();
      this.failedTurn = content;
      this.streaming.set(false);
      this.waiting.set(false);
      this.error.set(
        error instanceof AgentError || error instanceof Error ? error.message : 'Something went wrong talking to the planner.',
      );
    }
  }

  /**
   * A screen that doesn't parse cleanly gets one automatic, bounded
   * correction round (upstream's guidance: send a compact error description
   * back, never retry forever). If the corrected screen still has problems,
   * say so on screen and offer "Try again" rather than silently showing
   * whatever part of it rendered.
   */
  private checkResponse(text: string): void {
    const result = this.parser.parse(text);
    const cosmetic = result.meta.errors.filter((error) => !isSevereError(error));
    if (cosmetic.length > 0) {
      console.warn('[planner] rendering despite cosmetic prop errors:', cosmetic.map((error) => error.message));
    }
    const severe = { ...result, meta: { ...result.meta, errors: result.meta.errors.filter(isSevereError) } };
    const problems = describeProblems(text, severe, this.signatures);
    if (problems.length === 0) return;
    if (this.correctedThisTurn) {
      console.warn('[planner] screen still has problems after one correction:', problems);
      this.renderWarning.set('Part of this screen could not be rendered — the model made a mistake it could not fix.');
      return;
    }
    this.correctedThisTurn = true;
    console.warn('[planner] asking the model to fix its screen:', problems);
    void this.runTurn(
      composeUserMessage(
        { correction: `Your last screen could not be rendered: ${problems.slice(0, 6).join('; ')}. Re-send the complete screen, fixed.` },
        this.profile(),
      ),
    );
  }
}
