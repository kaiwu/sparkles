# Sparkles npm releases

Sparkles has two stable, host-specific npm identities built from
[`github.com/kaiwu/sparkles`](https://github.com/kaiwu/sparkles):
`@pi-sparkles/pi-sparkles` for Pi and `@dsh-sparkles/dsh-sparkles` for
DeepSeek Harness. They reuse functional cores but retain independent host
entrypoints, presentation, locks, verification, and release maturity.

## Pi release — @pi-sparkles/pi-sparkles

The selected aggregate target is recorded separately in `package.json`,
`release-lock.json`, and `aggregate-lock.json`.

## Build and inspect

T6 is the current ProductUseful release default and always means the cumulative
T1-through-T6 inventory. Select T5 explicitly only to reproduce the prior 0.1.4
release boundary:

```sh
bun run npm:pack
bun run npm:pack -- T5
```

Outputs are written below `dist/npm/t5/` or `dist/npm/t6/`:

- `package/` is the exact unpacked npm package;
- `pi-sparkles-pi-sparkles-<version>.tgz` is the npm tarball;
- `npm-pack.json` records npm's integrity, sizes, and file inventory; and
- `RELEASE_SHA256SUMS` locks the tarball and pack record.

Use existing aggregate artifacts without rebuilding every plugin:

```sh
bun run aggregate:build -- --no-build
bun run npm:pack -- --no-build
bun run npm:pack -- --verify-only
```

Before a release, run the dedicated all-in-one gate. It exercises only the npm
product boundary: focused aggregate/package laws, a fresh T6 build, one exact
tarball, a clean install, one plain-Pi aggregate entrypoint load, npm's publish
dry-run, and exact name/version availability:

```sh
bun run npm:release:verify
```

The repository has no per-plugin Pi-load matrix. Development, promotion, and
release verification load the T6 all-in-one aggregate entrypoint once so all
135 plugin registrations are exercised at the actual distribution boundary.
The loader rejects earlier-tier and per-plugin target overrides.

The T5 selection remains the historical 0.1.4 boundary. T6 is ProductUseful
with zero omissions, partials, or blockers and is selected for version 0.1.10.

## Local consumer verification

The `--install-smoke` gate installs the exact tarball into a clean temporary npm
prefix with lifecycle scripts disabled, verifies the installed package and the
exact `pdfjs-dist`/`@napi-rs/canvas` versions, imports its default extension
without permitting eager PDF canvas initialization, removes every declared
provider variable from the child environment, and asks plain Pi to load and
register the entrypoint through an offline, sessionless RPC request. Both
startup processes have a 15-second hard limit. For a manual equivalent:

```sh
npm install ./dist/npm/t6/pi-sparkles-pi-sparkles-0.1.10.tgz
printf '%s\n' '{"id":"startup","type":"get_state"}' | pi --no-extensions \
  --extension ./node_modules/@pi-sparkles/pi-sparkles/index.js \
  --mode rpc --no-session --offline
```

The package pins `pdfjs-dist` because the CN PDF path resolves its CMap assets
at runtime, and pins `@napi-rs/canvas@1.0.3` because Pi runs on Bun and later
floating native canvas builds can block extension import. Neither dependency is
initialized until a PDF operation invokes the parser. Pi host code is not
bundled and is declared with the Pi-required `"*"` peer ranges. The manifest
still exposes exactly one small Pi entrypoint; it passes Pi's host-owned TUI
helpers to the separately checksummed `runtime.js`, which is loaded with Bun's
native module loader so Pi's Jiti compatibility loader never transpiles the
full generated aggregate. There are no npm lifecycle scripts, and packaging
never reads credential values.

Futu OpenD, Alpaca, IBKR, their SDKs or gateways, credentials, entitlements,
login state, and live certification are external caller-owned dependencies.
They are not npm dependencies or package assets. T6 accepts only explicitly
selected, bounded capability packets and receipts and provides no order-mutation
surface or silent provider fallback.

## Version and publish procedure

An npm name/version is immutable. Before preparing another release:

1. update the root `package.json` version using Semantic Versioning;
2. update `CHANGELOG.md`;
3. commit, create the matching `v<version>` tag, and rebuild from that tag;
4. run `bun run npm:release:verify`; and
5. publish the exact content-locked tarball, never the repository root; and
6. explicitly move that package's `latest` dist-tag to the published version
   and verify the tag from the registry.

The first registry publication must be performed by an authenticated maintainer
because a trusted-publisher relationship cannot be attached until the package
exists. The explicit command is:

```sh
npm publish ./dist/npm/t6/pi-sparkles-pi-sparkles-0.1.10.tgz --tag latest --access public
bun run npm:release:latest -- pi
```

Publishing changes external state and is never performed by builds, tests, or
packaging commands. After the first publication, configure the npm package's
trusted publisher for `.github/workflows/npm-publish.yml`, then prefer that
manual, tag-bound OIDC workflow over a long-lived automation token. The
workflow always publishes both packages with `--tag latest` and finishes with a
registry assertion for both tags; it has no alternate dist-tag input. Configure
a protected GitHub `npm` environment if review approval is required.

After publication, verify the registry artifact and install through Pi:

```sh
npm view @pi-sparkles/pi-sparkles@0.1.10 \
  name version dist.integrity repository --json
npm view @pi-sparkles/pi-sparkles dist-tags.latest
pi install npm:@pi-sparkles/pi-sparkles@0.1.10
```

`npm:release:latest` is an authenticated, registry-mutating command. It first
proves that the exact root-package version exists, runs `npm dist-tag add`, and
then requires `@latest` to resolve to that version. `--check` performs only the
final read-only assertions.

---

# DeepSeek Harness release — @dsh-sparkles/dsh-sparkles

The DeepSeek Harness distribution is a separate npm identity and release gate.
It reuses compatible T1–T6 functional cores/effect shells, declares
`dsh.bundle.patch`, and is installed with `dsh plugin`:

```sh
bun run dsh:bundle                      # dist/dsh/dsh-sparkles (all-in-one plugin)
bun run dsh:npm:pack                    # content-lock and pack the tarball, never publish
bun run dsh:verify                      # real schema + generated ToolRuntime execution
bun run dsh:npm:preview:verify          # allowed private-preview gate
dsh plugin --profile <name> add ./dist/dsh/dsh-sparkles
```

The packed package has one self-contained server entrypoint registering tools
through `ctx.tools` and finance commands through `ctx.commands`, plus one DSH
browser entrypoint for `shell.overlay`. All 135 ledger components are covered:
131 global-safe Pi shells and four `scoped_pi` counterparts instantiated once
per DSH agent. DSH-only Cordis entries remain in the isolated `dsh/plugins/`
lane. The exact excluded/scoped/extra lists are recorded in `dsh-lock.json` and
the manifest's `dshSparkles` section. It declares the exact
`@deepseek-ai/dsh@0.1.1-rc.2` host peer and pins the tested agent, tool, command,
system-prompt, session-projection, client-runtime, and UI-layout service peers
to `0.1.1-rc.2`. It also pins `pdfjs-dist` and the shared
`@napi-rs/canvas@1.0.3` runtime without initializing either during entrypoint
registration, requires Node 22.19+, and carries the
`dsh.bundle.patch` manifest and a content lock (`dsh-lock.json` +
`release-lock.json` + inner/outer `SHA256SUMS`), and has no lifecycle scripts
or credential values. The install smoke installs the exact tarball into a clean
npm prefix, imports the entrypoint to verify its Cordis plugin shape, and
composes it in an isolated `DSH_HOME` profile with the real `dsh` CLI.

The DSH manifest is independently `product_useful` for T6. The four global
exclusions have per-agent counterparts, and the inline chart has completed
installed-profile discovery, resize/interaction, persistence, and visual
browser acceptance. T5 remains outside the selected DSH release boundary.
Packaging and verification never publish.

```sh
bun run dsh:npm:release:verify
```

That gate builds the exact 0.1.10 tarball, installs it without synthesizing a
standalone DSH host, composes it in an isolated profile using the installed
tested `0.1.1-rc.2` runtime, runs `npm publish --dry-run`, and confirms that the
version is unused. The reviewed artifact is:

```text
dist/dsh/npm/t6/dsh-sparkles-dsh-sparkles-0.1.10.tgz
```

After explicit publication authorization, publish that exact tarball and then
verify it through DSH:

```sh
npm publish ./dist/dsh/npm/t6/dsh-sparkles-dsh-sparkles-0.1.10.tgz --tag latest --access public
bun run npm:release:latest -- dsh
npm view @dsh-sparkles/dsh-sparkles@0.1.10 \
  name version dist.integrity repository --json
npm view @dsh-sparkles/dsh-sparkles dist-tags.latest
dsh plugin --profile <name> add @dsh-sparkles/dsh-sparkles@0.1.10
```

The Pi `0.1.10` and DSH `0.1.10` maintenance releases remain independent. Move
each package's `latest` tag only after its own exact tarball has been explicitly
published:

```sh
bun run npm:release:latest -- pi
bun run npm:release:latest -- dsh
```

The `all` mode first requires the Pi and DSH manifests to declare the same
version, then preflights both exact package versions before changing either
tag, updates the tags separately, and verifies both registry values. It is
never called by build, package, or verification gates because those commands
must not mutate the registry.
