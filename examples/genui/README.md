# GenUI example — retirement planner

An Angular Lynx app where a real LLM holds the conversation and generates the
UI, and plain TypeScript does the maths.

You describe the retirement you want ("retire at 60, travel twice a year, buy a
small boat"). The assistant replies with **generated screens**: sliders, number
fields and choices pre-filled from what you said. After a few rounds it shows
how big a pot you need and how much to invest every month, under pessimistic,
base and optimistic markets, with live what-if sliders.

Two protocol demos sit alongside it as extra tabs: **A2UI** (JSON messages) and
**OpenUI** (streamed UI language), both on canned agents.

> ⚠️ **Demo only, not a pattern for a production app.** It handles your LLM key in two
> ways that are fine on your own machine but unsafe in a real app:
>
> - **The dev server's proxy is open to your network.** While `npm run dev` runs, anyone
>   on the same Wi-Fi can call `/api/chat` and spend your key. Run it on a network you
>   trust, and stop the server when you're done.
> - **`PLANNER_EMBED_KEY=true` puts the key inside the bundle**, where anyone who gets
>   the bundle can read it. Never share or publish a bundle built with it.
>
> Use a separate key you can revoke, keep it in `.env.local` (gitignored, never commit
> it), and in a real app keep the key on a server you control, behind your own
> authentication.

## Run it

```bash
pnpm install
pnpm --filter angular-lynx build        # the example links the package's dist
cd examples/genui
cp .env.example .env.local              # then paste your key into it
npm run dev
```

- **Web:** `http://localhost:3000/__web_preview?casename=main.web.bundle`
- **Lynx Explorer:** paste the printed `main.lynx.bundle` URL. It uses your LAN
  IP, and the phone reaches the LLM proxy through the same address.

**The key.** Get a free Gemini key at <https://aistudio.google.com/apikey> and
put it in `.env.local` (gitignored) as `GEMINI_API_KEY=…`. The dev server logs
which model it picked. The free tier is Flash-only and the proxy picks the
newest Flash automatically. Pin one with `LLM_MODEL`. Any other
OpenAI-compatible provider (Groq, OpenRouter, a local Ollama) works through
`LLM_BASE_URL` + `LLM_API_KEY`; see `.env.example`.

**Embedding the key for demo builds.** Add `PLANNER_EMBED_KEY=true` to
`.env.local`, and the key, the chosen model and the system prompt are baked
into the bundle. The app then calls Gemini **directly**, with no server
anywhere, so a `npm run build` bundle or a phone without your laptop gets the
real LLM too. The badge then reads "… · in-app key", and the build prints a
warning. Gemini's endpoint allows browser calls (CORS), so this works in the
web preview as well as on device.

> ⚠️ **Anything in a bundle can be read by anyone who has the bundle.** Only do
> this for a demo you control, with a key you're prepared to revoke (AI Studio
> lets you make a separate one). Without the flag, the key never enters the
> bundle; that was verified by building with a fake key and searching the
> output.

**No key? It still works.** Without one (and in production builds, which have
no proxy) the planner runs an **offline demo agent**: the same four rounds of
questions and the same results screen, scripted. The badge at the top says
which agent you're talking to.

> **Free-tier privacy.** Google may use free-tier prompts to improve its
> products. Use made-up numbers, not your real finances, unless you're on a
> paid tier.

## iOS app (Sparkling)

`ios/` is a native iOS app built with
[Sparkling](https://tiktok.github.io/sparkling/), TikTok's Lynx app framework
([Build with an App Framework](https://lynxjs.org/guide/start/build-with-app-framework)).
It hosts the **same** Angular bundle: `app.config.ts` wraps `lynx.config.ts`,
and Sparkling's CLI runs this package's own rspeedy.

**One-time setup** (macOS):

```bash
brew install ruby@3.3                   # Sparkling needs Ruby >= 3.2.6, < 3.4
cd examples/genui/ios && bundle install # CocoaPods into ios/vendor/bundle
```

You also need Xcode 16+ with an iOS Simulator. Run `npm run ios:doctor` to
check the setup.

**Run it:**

```bash
cd examples/genui
npm run ios:dev   # dev server on :5969 (includes the planner's LLM proxy)
npm run ios       # pod install, build, launch on the simulator
```

Set `LANG=en_US.UTF-8` if CocoaPods complains about the terminal encoding.

**On your iPhone** (with `npm run ios:dev` running, and the phone on the
same Wi-Fi as the Mac):

```bash
npm run ios:device   # build with your signing team, install, launch
```

The first time, you need to do four things:

1. Pair the phone: connect it, unlock it, and tap "Trust This Computer".
2. Turn on Settings → Privacy & Security → **Developer Mode**.
3. Add your Apple ID in Xcode → Settings → Accounts. A free account works;
   its apps expire after 7 days, so re-run the command to reinstall.
4. On the phone's first launch, trust the developer in Settings → General →
   VPN & Device Management.

The phone app's bundle ID ends in your team ID, e.g.
`dev.angularlynx.planner.ab12cd34ef`. Apple lets only one team ever register
a given bundle ID, so the plain `dev.angularlynx.planner` works for one Apple
ID only. With a per-team ID, anyone's Apple ID can sign the app. Set
`IOS_BUNDLE_ID_SUFFIX` to pick your own suffix, or set it to empty for the
plain ID if your team owns it. Simulator builds keep the plain ID.

**Your signing team stays out of git.** The committed project has no team.
The project's Debug and Release configurations are based on
`ios/Signing.xcconfig`, which includes `ios/Signing.local.xcconfig`, and that
file is gitignored. `npm run ios:device` writes your team and suffix there.
It takes the team from, in order: `IOS_TEAM_ID`, a team picked in Xcode's
Signing & Capabilities tab, the one already in the local file, and finally
the first account in Xcode → Settings → Accounts. If you pick a team in
Xcode's tab, which writes it into `project.pbxproj`, the next run moves it
into the local file. After one run, Xcode's own Run button signs with your
team too.

A free Apple ID can register only a few devices. If Apple answers "Your
development team has reached the maximum number of registered iPhone
devices", add a second Apple ID in Xcode → Settings → Accounts. Then run
`IOS_TEAM_ID=<its team ID> npm run ios:device`.

If the build stops at signing with `errSecInternalComponent`, macOS couldn't
ask for access to the new certificate's key. That happens when the build runs
somewhere with no Keychain dialog (an agent's sandboxed shell, SSH). Run it
from Terminal, and click **Always Allow** when the Keychain asks.

The phone reaches the Mac over Wi-Fi; the dev server listens on every
interface by default, so nothing needs configuring (Rsbuild's "use --host to
expose" hint is misleading here). The script checks the server is reachable
at the Mac's LAN address before it builds.

- **Debug builds** load the bundle from the dev server, so edits reload
  without a native rebuild, and the planner reaches Gemini through the proxy
  like the web preview does.
- **Release builds** (`npm run ios:bundle`, then build in Xcode) ship the
  bundle inside the app. There's no dev server, so the planner uses the
  **offline agent** unless the key is embedded (`PLANNER_EMBED_KEY=true`, see
  above).

**What it took on top of the Sparkling template.** Each fix below was
found by running the app on the iOS 26.5 simulator; the web preview could
not have shown any of them.

| Symptom | Cause | Fix |
| --- | --- | --- |
| Text fields and the message box render as nothing | `<input>`/`<textarea>` live in the **`XElement`** pod, which the template omits (Lynx Explorer ships it) | `pod 'XElement'` in `ios/Podfile`, in step with `Lynx` |
| Pre-filled fields show empty but still submit their value; the message box keeps its text after Send | Native inputs have **no `value` attribute** — text is set with the `setValue` UI method | angular-lynx's `LynxModel` and the OpenUI `TextField` now call `setValue` too (`runtime/src/input-value.ts`) |
| Debug app always loads the bundled copy, never the dev server | The CLI passes `SPARKLING_DEV_SERVER_HOST/PORT`, but the template only reads a URL saved in its debug dialog | `DebugDevURLSupport.swift` honours the CLI's variables |
| "Could not reach the dev server" on a Debug build | `output.assetPrefix: 'asset:///'` also became the **dev** bundle's public path, so `/api/…` stayed relative | `dev.assetPrefix: true` in `app.config.ts` |
| …and again after every `npm run ios` | `npm run ios` always runs a production build into `dist/`, which the running dev server serves from disk | the dev server writes to `.sparkling/dev-dist` |
| A good model response rendered as "no root" | PrimJS streams `ArrayBuffer` chunks and has no `TextDecoder`; the reader assumed browser `Uint8Array`s | `stream-text.ts` handles every chunk shape (tested against a PrimJS simulation) |
| Offline agent: `e.at is not a function` | PrimJS has no `Array.prototype.at` (it lacks most ES2021+ built-ins) | index instead of `.at(-1)`; the angular-lynx runtime now polyfills `at` and the other built-ins PrimJS lacks (docs/05) |
| A web bundle inside the iOS app | `pluginAngularLynx` configured `web` even when the app declares only `lynx` | the plugin now configures declared environments only |
| On a real iPhone the planner is always offline | The dev server had stopped, and a home-screen launch loads the packaged bundle, which has no proxy. (It was first blamed on the dev server listening on `localhost` only; measured, it listens on every interface.) | `npm run ios:device` checks the server is reachable before building; for the LLM away from the Mac, `PLANNER_EMBED_KEY=true` puts the key in the packaged bundle |

The Xcode build folder (`ios/build`, several GB) and the pods are
gitignored; delete `ios/build` to reclaim space.

**Sparkling's debug inspector** (JS console, GlobalProps, native method
calls) is behind a blue "sparkling" tag that the template shows in every
Debug build. It sits over the UI, so it's off here. To bring it back, launch
with `SIMCTL_CHILD_SPARKLING_DEBUG_TAG=1 xcrun simctl launch booted dev.angularlynx.planner`.

**Which agent you get** depends on how the app was launched:

- **`npm run ios` / `npm run ios:device`:** the Debug app loads from the dev
  server → Gemini through the proxy.
- **Tapping the icon on the home screen, and Release builds:** the copy of
  the bundle packaged inside the app, so it works away from the Mac. With
  `PLANNER_EMBED_KEY=true` (then `npm run ios:device` again) that copy
  calls Gemini itself; without it, it's the offline agent.

**Engine version.** Sparkling 2.1.0-rc pins the iOS app to **Lynx 3.9.0**.
The stable 2.0.1 pins 3.6.0, where `<svg>` (the projection chart) and
streaming `fetch` don't exist yet — both need 3.7. Lynx 4.1 has no iOS pod
yet; the newest is 4.0.3. The bundle's `targetSdkVersion` (3.2) loads on all
of them.

## How it fits together

```
 you ──text / form answers──► planner.component ──► agent.ts ──► /api/chat ──► Gemini
                                   ▲    │                          (dev-server proxy,
                                   │    │                           holds key + prompt)
                                   │    ▼
                   profile.ts ◄── harvestAnswers        OpenUI Lang, streamed
                  (confirmed        (form state)             │
                   answers)                                  ▼
                       │                              <openui-renderer>
                       ▼                              + planner components
             tools.ts: calculate_plan ◄── Query("calculate_plan", {…$sliders})
                       │
                       ▼
                   calc.ts (deterministic, unit-tested)
```

| File | Role |
| --- | --- |
| `src/planner/calc.ts` | The maths: real-terms projection, UK 2026/27 income tax / EU flat rate, gross-up of withdrawals, required pot, required monthly contribution, depletion age, earliest affordable retirement age. |
| `src/planner/profile.ts` | The profile and **the naming contract**: a form input bound to `$retirementAge` fills `retirementAge`. Coercion, range checks, UK/EU defaults. |
| `src/planner/contract.ts` | What app and model share: the `PlanSummary` / `ScenarioTable` / `ProjectionChart` components and the `calculate_plan` tool schema. |
| `src/planner/components.ts` | Angular renderers for those components. They draw the calculator's numbers, never the model's. |
| `src/planner/tools.ts` | `calculate_plan`, run on the device when a generated `Query()` asks. |
| `src/planner/conversation.ts` | The `<planner_state>` block appended to every user turn: confirmed profile, what's missing, next step. |
| `src/planner/agent.ts` | Who answers: the direct client (embedded key), the dev-server proxy, or the offline agent. Streaming, with a whole-body fallback. |
| `src/planner/llm-wire.ts` | The chat-completions wire format both the proxy and the direct client speak: request body, SSE parsing, model pick, errors. |
| `src/planner/scripted.ts` | The offline agent's screens. |
| `server/prompt.ts` | The system prompt: upstream `buildOpenUiSystemPrompt` + planner components, tool and product rules. |
| `server/llm-proxy.ts` | `/api/health` + `/api/chat`, mounted into the rspeedy dev server by a small rsbuild plugin. |
| `server/embed.ts` | Build time: defines `__PLANNER_EMBEDDED__` (key + model + prompt) when `PLANNER_EMBED_KEY=true`, else `null`. |

> Editing anything under `server/`? Restart `npm run dev`. rspeedy restarts
> itself when `lynx.config.ts` changes, but in the same Node process, so
> modules the config imports stay cached at their old version.

### The rules that make it trustworthy

- **The model never does arithmetic.** Every figure on screen comes from
  `calc.ts`, through `calculate_plan`. The model only composes the screen
  (`PlanSummary(plan)`) and may suggest *inputs* ("two long trips ≈ £9,000"),
  which you see and adjust before they count.
- **Only submitted answers change the profile.** Nothing the model *says*
  becomes a fact. `harvestAnswers` reads the form you submitted, rejects
  out-of-range values back to the model, and the "What I know" chips show
  exactly what's been confirmed.
- **The app, not the transcript, is the memory.** Each turn carries
  `<planner_state>`, so the model never has to remember what it asked. That
  keeps smaller and faster models on track too.
- **Broken screens are corrected, once.** A response that doesn't parse gets one
  automatic correction round, following upstream's guidance for bounded
  retries.

## Tests

```bash
npm test
```

58 tests on Node's built-in runner, no key needed:

- **The calculator**, against independent oracles: published UK tax figures,
  closed-form annuities, and "paying the recommended amount exactly funds the
  plan".
- **The answer contract.**
- **Every prompt example and every offline screen** parse with zero validation
  errors against the prompt-side library.
- **The proxy**, end to end against a fake OpenAI-compatible upstream.
- **The embed switch**, including that the key stays out unless you opt in.
- **SSE parsing**, at every possible chunk cut point.

`verify:genui-openui-parity` (in `packages/angular-lynx`) guarantees the
Angular OpenUI library matches the signatures the prompt teaches.

## Assumptions and limits

All amounts are in **today's money**. Inflation defaults to 2.5%. Returns are
illustrative and net of fees; they vary by investment style (see
`RETURN_ASSUMPTIONS`).

- **UK tax:** rest-of-UK 2026/27 bands, held flat in real terms. They're frozen
  in cash terms until April 2031, so this is mildly optimistic for near-term
  retirees; Scotland differs. 25% of each pension withdrawal is tax-free; the
  £268,275 lump-sum cap isn't modelled.
- **UK State Pension:** defaults to the full new rate, £12,547.60/year, from 67
  or 68 depending on birth year.
- **EU:** one effective tax rate you supply, and the state pension from your
  national statement.
- **Not financial advice.**
