# Sparkles npm releases

Sparkles has two stable, host-specific npm identities built from
[`github.com/kaiwu/sparkles`](https://github.com/kaiwu/sparkles):
`@pi-sparkles/pi-sparkles` for Pi and `@dsh-sparkles/dsh-sparkles` for
DeepSeek Harness. They reuse functional cores but retain independent host
entrypoints, presentation, locks, verification, and release maturity.
Each package increments its own version sequence. Releasing Pi must not
automatically bump, publish, or retag DSH, and vice versa. A shared core fix may
require both packages to release together, each with its own next version.

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
with zero omissions, partials, or blockers and is selected for version 0.1.11.

## Local consumer verification

The `--install-smoke` gate installs the exact tarball into a clean temporary npm
prefix with lifecycle scripts disabled, verifies the installed package and the
exact `pdfjs-dist`/`@napi-rs/canvas` versions, imports its default extension
without permitting eager PDF canvas initialization, removes every declared
provider variable from the child environment, and asks plain Pi to load and
register the entrypoint through an offline, sessionless RPC request. Both
startup processes have a 15-second hard limit. For a manual equivalent:

```sh
npm install ./dist/npm/t6/pi-sparkles-pi-sparkles-0.1.11.tgz
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

## Version selection and publication (both channels)

**Never assume the next version of either package.** Pi and DSH have independent
published histories, manifests, candidate builds, and release decisions:

| Channel | npm package | Version source | CI tag |
| --- | --- | --- | --- |
| Pi | `@pi-sparkles/pi-sparkles` | root `package.json` | `pi-v<version>` |
| DSH | `@dsh-sparkles/dsh-sparkles` | `dsh/bundle.json` → `dsh_release.version` | `dsh-v<version>` |

The required DSH host version is compatibility metadata, not a Sparkles release
version. Neither the other channel's version nor an unqualified repository tag
is evidence for the selected package's next release. Building, packing, local
installation, and manual checks do not consume a version.

1. Inspect the selected package **before editing its version**:

   ```sh
   bun run npm:release:preflight -- pi
   # Or, for a DSH release:
   bun run npm:release:preflight -- dsh
   ```

   This read-only command queries that exact npm identity's `versions` and
   `dist-tags`. It reports the highest published stable baseline, current local
   candidate, whether that candidate is published, and the next patch for review.
   It never selects a version, edits files, or publishes. A stale `latest` tag
   does not erase versions already published. Registry errors fail closed.

2. State the package, published baseline, local candidate/publication status,
   exact chosen version, and reason in the release update. Validate a user-given
   version; otherwise select the smallest appropriate SemVer increment from
   this package's history. Reuse an unpublished candidate when it is the intended
   next version. Do not bump it again after manual testing. Record a specific
   reason for a skipped patch or a minor/major change; no automatic cross-channel
   alignment is allowed.
3. Update only that channel's version source and changelog. Set `release_lane`,
   `release_base`, and `release_version` to the reviewed values, then validate:

   ```sh
   bun run npm:release:preflight -- "$release_lane" --base "$release_base" --version "$release_version"
   ```

   A non-patch decision also requires `--reason "<reviewed reason>"`. The guard
   rejects a stale/wrong baseline, an already published version, a backward
   version, an unexplained skip, or a source-version mismatch. This procedure
   covers stable package releases; prerelease/initial publication needs its own
   explicit reviewed procedure.
4. Run `bun run npm:release:procedure:test`, then the selected lane's
   `npm:release:verify` or `dsh:npm:release:verify` gate. Complete requested local
   installation and manual checks on that candidate. If checks lead to fixes,
   rebuild/reverify under the same unused version. Retain the final exact tarball
   and checksums. These commands never publish.
5. For CI, commit the reviewed source and create the selected lane's immutable
   tag, `pi-v<version>` or `dsh-v<version>`. Dispatch
   `.github/workflows/npm-publish.yml` with explicit `lane`, `base`, `version`,
   optional non-patch `reason`, and publication confirmation. The workflow
   validates tag/source/registry agreement, runs only that lane's release gate,
   and revalidates the locked tarball before publishing **one package**.
6. For an explicitly authorized local publication, set `release_directory` to
   `dist/npm/t6` (Pi) or `dist/dsh/npm/t6` (DSH), and repeat preflight immediately
   before publishing, preserving its output:

   ```sh
   bun run npm:release:preflight -- "$release_lane" --base "$release_base" --version "$release_version" --artifact "$release_directory" > "release-preflight-${release_lane}.json"
   ```

   Include the same `--reason` for a non-patch choice. This verifies the tarball's
   lock/checksums, maturity, package name, and exact selected version. Publish
   only the `tarball` path in that evidence with
   `npm publish <verified-tarball> --tag latest --access public --ignore-scripts`.
   Do not publish the repository root or bypass the preflight with an ad hoc
   guessed version. Packaging and verification never publish; registry mutation
   requires explicit authorization.
7. Verify that exact registry artifact's integrity against the tarball, and run:

   ```sh
   bun run npm:release:latest -- "$release_lane" --version "$release_version" --check
   ```

   Update the website only from each channel's confirmed publication and exact
   required host metadata. If both packages are requested, repeat the procedure
   independently; equal versions are neither required nor assumed.

`npm:release:latest` has no default or `all` mode. Read-only `pi --check` or
`dsh --check` may use that lane's source version. Authenticated tag mutation
requires an explicit lane **and** `--version`; it verifies the exact publication,
changes only that package's tag, then verifies `latest`. Do not mutate the other
channel while repairing one lane.

Configure each npm identity's trusted publisher for the manual workflow after
its authenticated first publication. A protected GitHub `npm` environment may
supply the repository's approval policy.

### Coordinated releases for a shared core fix

A fix in a core Gleam package can affect both hosts and require both npm
packages to release in the same batch. Review the impact and check both host
legs. When both releases are in scope:

1. Inspect both npm histories and record two explicit baseline/version choices.
   Each advances from its own published version; a shared fix does not imply
   matching package versions.
2. Update each channel's version source and changelog. Build two tarballs and
   complete both independent release/install gates and requested manual checks
   before publishing either package.
3. The same reviewed source commit may carry `pi-v<pi-version>` and
   `dsh-v<dsh-version>`. Dispatch the workflow separately for each tag with that
   channel's own baseline/version, or publish each verified tarball through its
   own authorized local procedure. Keep separate preflight evidence files.
4. Verify each exact registry artifact and `latest` tag independently. Record
   both outcomes and update the website from those actual publications.

This is one coordinated delivery batch containing two independent npm releases.
Publication is not atomic: if one succeeds and the other fails, retain the
successful publication, report the remaining failure, and resume only the
unfinished channel after a fresh registry check. Do not bump the successful
package again, align version numbers, or claim both completed.

### Numbering incident: 2026-09-07

Published DSH was `0.1.10`; `0.1.11` was only a local manual-check candidate.
The receipt-fix release should have reused **DSH Sparkles `0.1.11`**. Publishing
`0.1.12` was a mistake, not a required bump after local testing or a consequence
of Pi's `0.1.11` release. Keep published DSH `0.1.12` and its tag unchanged.
Do not backfill the gap, relabel it, or synchronize Pi to conceal it. Inspect
fresh registry history for every subsequent release; this incident does not
preselect a future version.

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
`@deepseek-ai/dsh@0.1.2-rc.1` host peer and pins the tested agent, tool, command,
system-prompt, session-projection, client-ui-session, and UI-layout service peers
to `0.1.2-rc.1`. It also pins `pdfjs-dist` and the shared
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

That gate builds the version explicitly recorded in `dsh/bundle.json`, installs
it in a clean prefix/profile through the tested DSH `0.1.2-rc.1` CLI, verifies
receipt consumption/isolation/resume and authenticated web client assets, runs
`npm publish --dry-run`, and checks version availability. DSH 0.1.1 is unsupported.
The current published release is `0.1.12`; its historical tarball is:

```text
dist/dsh/npm/t6/dsh-sparkles-dsh-sparkles-0.1.12.tgz
```

It is already published and must not be published again. The independent Pi
release remains `0.1.11`. These are current records, not instructions for choosing
or bumping a future release. Follow the common procedure above for every release.
