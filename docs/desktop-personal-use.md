# Build and install the Windows desktop for personal use

This runbook builds the Tauri shell for a Windows machine that already has Node.js 20+ and the
OnniCode checkout. The shell does not install Node.js or download the engine. Use the current
checkout as the engine by building it and linking it before installing the desktop shell.

## 1. Build the engine

From the repository root, confirm Node.js is version 20 or newer, then install the root workspaces
and build the engine and cockpit:

```powershell
node --version
npm install
npm run build
```

The clean build writes the engine to `packages/work/dist/` and the cockpit to
`packages/work/web/dist/`.

## 2. Link this checkout for the desktop

Still at the repository root, make this checkout the current local engine:

```powershell
node packages/work/dist/index.js link . --use
```

If `onni` is already on `PATH`, the equivalent command is `onni link . --use`. Keep this checkout
in place while it is linked; the desktop uses its built files directly.

## 3. Build the NSIS installer

The desktop package has its own dependencies and lockfile. Install them and build the Windows
installer:

```powershell
cd packages/desktop
npm install
npm run build:windows
```

The command prints the installer path and keeps a copy under
`.tmp/desktop-artifacts/<version>-<commit>-<timestamp>/`. The build uses an isolated ignored target
directory, so it can run while another desktop executable is open.

## 4. Install and smoke-test

Run the printed `OnniCode_<version>_x64-setup.exe` and complete the NSIS install. Launch OnniCode
and confirm the cockpit opens and reaches the local engine. For a personal smoke check, create and
cancel a `mock:slow` task, quit the app, reopen it, and confirm the cancelled task remains visible.

The installer contains the desktop shell; the engine stays at the linked checkout and Node.js stays
as installed on this machine. This workflow does not install or update either dependency.
