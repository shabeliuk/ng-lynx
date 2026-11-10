# __APP_NAME__

An [angular-lynx](https://github.com/shabeliuk/ng-lynx) app — standalone,
zoneless Angular rendered as native UI on the [Lynx](https://lynxjs.org/)
engine.

## Develop

```bash
npm install
npm run dev
```

- **Web preview:** open
  `http://localhost:3000/__web_preview?casename=main.web.bundle`
- **Device / simulator:** scan the printed QR code with
  [Lynx Explorer](https://lynxjs.org/guide/start/quick-start).

## Build

```bash
npm run build   # dist/main.lynx.bundle + dist/main.web.bundle
```

## Notes

- Templates use Lynx tags (`view`, `text`, `image`, …) with the typed
  directives from `angular-lynx/elements` — full `strictTemplates` checking,
  no `NO_ERRORS_SCHEMA`.
- Styling lives in CSS files imported from `src/index.ts` (component
  `styles: [...]` are not projected on Lynx).
- Assets can be imported (`import logo from './logo.png'`); `src/rspeedy-env.d.ts`
  has the types.
- Headless component tests: `angular-lynx/testing`.
