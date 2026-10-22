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
  after it starts and then every 6 hours. A newer version is downloaded in the background (the title bar shows its
  progress right of the search field); then a **Restart to Update** button takes its place, and the Help menu offers it
  too. `"manual"` (When asked) only checks on Help › Check for Updates.
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

Build two versions locally, serve the newer one's `latest.json` from your machine and let the older one update to it.
This does not need the release key: a throwaway key and two config overlays under `build/trial/` (ignored by git)
leave `tauri.conf.json` as it is. In Git Bash on Windows (the NSIS installer only, which is quickest):

1. A throwaway key and an overlay per version (the old and the new one; any two will do):

   ```sh
   mkdir -p build/trial
   npm run tauri -w @ufsm/editor -- signer generate --ci -p trial -w "$PWD/build/trial/trial.key"
   for v in 0.9.0 0.9.1; do cat > build/trial/$v.json <<EOF
   { "version": "$v", "bundle": { "createUpdaterArtifacts": true },
     "plugins": { "updater": { "pubkey": "$(cat build/trial/trial.key.pub)",
       "endpoints": ["http://localhost:8000/latest.json"], "dangerousInsecureTransportProtocol": true } } }
   EOF
   done
   export TAURI_SIGNING_PRIVATE_KEY="$(cat build/trial/trial.key)" TAURI_SIGNING_PRIVATE_KEY_PASSWORD=trial
   ```

2. Build the new version, stage it as CI does, point its URLs at localhost and serve it:

   ```sh
   npm run build -- --bundles nsis --config "$PWD/build/trial/0.9.1.json"
   node apps/editor/scripts/release-assets.ts stage apps/editor/src-tauri/target/release/bundle build/trial/release \
     --version 0.9.1
   node apps/editor/scripts/release-assets.ts manifest build/trial/release --tag v0.9.1 --repo jonasblixt/ufsm
   sed -i 's#https://github.com/jonasblixt/ufsm/releases/download/v0.9.1/#http://localhost:8000/#' \
     build/trial/release/latest.json
   python -m http.server 8000 -d build/trial/release --bind 127.0.0.1
   ```

3. In another shell (with the two variables of step 1), build the old version with
   `npm run build -- --bundles nsis --config "$PWD/build/trial/0.9.0.json"`, install
   `apps/editor/src-tauri/target/release/bundle/nsis/uFSM_0.9.0_x64-setup.exe`, start it and use Help › Check for
   Updates. It downloads 0.9.1, the title bar offers Restart to Update, the installer runs and starts 0.9.1 (Settings ›
   Updates shows the version running; Help › About shows the frontend's `UFSM_VERSION`, the same in both). Install the real release again afterwards: the trial builds trust only the throwaway key.

A version with a pre-release part must be numeric there (`0.9.1-1`, not `0.9.1-test.1`) when the MSI is built: WiX
refuses anything else.
