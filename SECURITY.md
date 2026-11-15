# Security

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub instead: on the
repository's **Security** tab, choose **Report a vulnerability**. You'll get a reply
within a week, and a fix or a plan within 30 days. Once a fix is released, the
advisory is published with credit to you, unless you'd rather stay anonymous.

## Supported versions

Security fixes go into the latest release only. Before 1.0, that's the newest
`0.x` version, including its release candidates.

## What's in scope

- The `ng-lynx` and `create-ng-lynx` packages: the runtime, the build plugin, the
  schematics, the starter templates and their command-line tools.

Out of scope:

- The examples. They're demos. In particular, the genui example's development
  proxy is open to your local network, and its `PLANNER_EMBED_KEY` option puts an
  API key inside the app bundle; both are documented as unsafe for real apps.
- The development server's hot reload, which runs code from the dev server on your
  network by design, as rsbuild's does.
- Bugs in Lynx, Angular or rspeedy themselves. Please report those to their projects.
