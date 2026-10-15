# Releases and updates

How a version of the editor gets from a tag to the people who use it, and how installed copies update themselves.

## Making a release

1. Set the new version everywhere it is written and commit ("Release 0.8.0", 7a6e288, touched all of them): every
   `package.json` and `package-lock.json`, `packages/core/src/version.ts` (`UFSM_VERSION`),
   `apps/editor/src-tauri/tauri.conf.json` (the version the updater compares), `Cargo.toml` and `Cargo.lock`, and
   `apps/editor/src/fsm/editor-fsm.ts` (`npm run gen:editor-fsm`).
2. Tag it `v<version>` and push the tag. CI builds the installers on Windows, macOS and Linux and the `release` job
   collects them into a **draft** GitHub release with generated notes. A tag that does not match `package.json` fails.
3. Look at the draft, edit the notes, publish it.

Nothing reaches installed copies before step 3: they read `releases/latest/download/latest.json`, which GitHub serves
from the newest **published** release that is not a pre-release. Mark a test release as a pre-release, and publish an old
branch's fix with "Set as the latest release" unticked, or installed copies would be offered it.

## How the editor updates itself

The editor works like VS Code here:

- With `"updates": "auto"` in `settings.json` (the default; Settings › Updates › Automatically) it checks 10 seconds
  after it starts and then every 6 hours. A newer version is downloaded in the background; the status bar then shows
  **Restart to Update**, as does the Help menu. `"manual"` (When asked) only checks on Help › Check for Updates.
- Restart to Update asks first when a machine has unsaved changes, as quitting does. On Windows the installer then runs
  in its passive mode (a progress bar, no questions; the `.msi`, which installs for all users, asks for administrator
  rights) and starts the new version; on macOS and Linux the app replaces itself and restarts.
- Each copy updates from the kind of installer it came from: the NSIS `.exe`, the `.msi`, the macOS app, the AppImage
  or the `.deb` (which asks for an administrator password through `pkexec`). `.rpm` packages are not published.
- A development build (`npm run dev`) never checks by itself; Help › Check for Updates works there too.
- The browser build (`npm run dev:web`) does not update itself.

`latest.json` lists one download per platform key (`windows-x86_64-nsis`, `darwin-aarch64-app`,
`linux-x86_64-deb`, ...) with its signature; the updater ([tauri-plugin-updater](https://v2.tauri.app/plugin/updater/))
looks for `<os>-<arch>-<installer>` first and falls back to `<os>-<arch>` (NSIS, the macOS app, the AppImage).
`apps/editor/scripts/release-assets.ts` writes it in CI from what each OS build produced.

### Signatures

Every update package is signed with a minisign key, separately from any Windows or Apple code signing (the installers
are not code-signed yet). The app has the public key built in (`plugins.updater.pubkey` in `tauri.conf.json`) and
installs nothing whose signature does not match. `requireSignedVersion` is on: the signature also covers the version
it was released as, so a tampered `latest.json` cannot pass an older release off as a newer one.

A build without a public key (an empty `pubkey`) does not update itself; Settings › Updates says so. A tag build signs
only when the repository has the private key as a secret; without it the release has installers but no
`latest.json`, and installed copies stay where they are.

## Setting up the signing key (once)

1. Generate the key pair on your own machine, with a password:

   ```sh
   npm run tauri -w @ufsm/editor -- signer generate -w ~/.tauri/ufsm.key
   ```

   This writes the private key to `~/.tauri/ufsm.key` and the public key to `~/.tauri/ufsm.key.pub`.
2. Put the contents of `ufsm.key.pub` (one line of base64) into `plugins.updater.pubkey` in
   `apps/editor/src-tauri/tauri.conf.json` and commit it.
3. In the repository's Settings › Secrets and variables › Actions, add `TAURI_SIGNING_PRIVATE_KEY` (the contents of
   `ufsm.key`) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Keep `ufsm.key` and its password somewhere safe besides GitHub. **If the key is lost, installed copies can never
   be updated again**: a new key means a new public key in the app, so users would have to install a new version by
   hand once.

CI refuses to build a tag with the secret but no public key in `tauri.conf.json`.

## Trying an update before a release

Build two versions locally with the key, serve a `latest.json` and point a build at it:

1. `export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/ufsm.key)"` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, set the
   version in `tauri.conf.json` to, say, 0.9.0-test.1, and
   `npm run build -- --config src-tauri/tauri.updater.conf.json`.
2. Stage what it made: `node apps/editor/scripts/release-assets.ts stage apps/editor/src-tauri/target/release/bundle
   build/release --version 0.9.0-test.1`, then
   `node apps/editor/scripts/release-assets.ts manifest build/release --tag v0.9.0-test.1 --repo jonasblixt/ufsm` and
   edit the URLs in `build/release/latest.json` to `http://localhost:8000/<file>`; serve `build/release` there.
3. Set the version back (to 0.8.0, say) in `tauri.conf.json`, set `endpoints` to `http://localhost:8000/latest.json` and
   `"dangerousInsecureTransportProtocol": true` under `plugins.updater` (never commit those two), build, install,
   start it and use Help › Check for Updates.
