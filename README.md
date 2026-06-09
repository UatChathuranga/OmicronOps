# OmicronOps

OmicronOps is a premium, lightweight, glassmorphic desktop DevOps & remote management client built on Electron and React. Designed to bring a modern terminal experience and WinSCP-like visual file explorer to Linux desktops.

![OmicronOps App Icon](build/icon.png)

---

## Key Features

* **Multi-Tab Workspace**: Open and manage multiple concurrent SSH shell terminal sessions in a tabbed workspace.
* **Console Output Colorizer**: Real-time log parsing highlights critical keywords like `error`, `fail`, and `critical` (Red), `warning` and `warn` (Orange), and `success` / `ok` (Green) automatically across compound and standalone words.
* **SFTP File Explorer (WinSCP-like)**:
  * Dual-mode session: Switch between **Console** and **Files (SFTP)** tabs on the fly.
  * Graphical file explorer with navigation, parent directories, breadcrumb paths, and folders sorted first.
  * Full file operations: create folders, rename files/directories, and delete items.
  * Drag-and-Drop files directly from your desktop file manager to upload.
  * Real-time transfer progress bars with speed ratios and active transfer cancellation.
* **Clipboard Interoperability**:
  * **Highlight-to-Copy**: Highlighted terminal output is automatically copied to your system clipboard.
  * **Right-Click Paste**: Right-click paste support to transfer text from your clipboard directly into active PTY commands.
* **Encrypted Credential Storage**: Encrypts connection profiles locally using AES-256-CBC with a secure host key. Profiles are stored in compliance with Linux desktop standards under `~/.config/OmicronOps/`.
* **Automatic Window Resize**: Synchronizes PTY terminal rows/columns automatically via WebSocket whenever the window size changes.

---

## Tech Stack

* **Frontend**: React, Vite, Vanilla CSS (Glassmorphism layout system), `xterm.js` for canvas-based shell rendering.
* **Backend**: Node.js, Express, `ws` (WebSockets), `ssh2` (Pure Javascript SSH & SFTP fallback tunnel client).
* **Desktop Wrapper**: Electron (packaged into AppImage and Debian formats).

---

## Development and Setup

### Prerequisites

* Node.js (v18+)
* npm (v9+)

### Installation

1. Clone this repository and open the project directory.
2. Install package dependencies:
   ```bash
   npm install
   ```

### Running the App

#### Local Dev Server (Hot-Reloading)
Run client and server concurrently:
```bash
npm run dev
```
* React Client: `http://localhost:5173`
* Express WS Server: `http://localhost:3000`

#### Run Standalone Desktop App
Launch the desktop client window:
```bash
npm run build
npm run app
```

---

## Packaging & Building Installers

To package OmicronOps for distribution to other Linux systems:

1. Build client assets and compile installer packages:
   ```bash
   npm run build
   npm run dist
   ```
2. Locate the compiled binaries in the `release/` directory:
   * **`release/omicron-ops_1.0.0_amd64.deb`**: Standard Debian/Ubuntu installer.
   * **`release/OmicronOps-1.0.0.AppImage`**: Portable, self-contained standalone executable.

---

## Project Structure

```text
├── build/                 # Icons and packaging resources
├── server/
│   ├── server.js          # Express & WebSocket bridge
│   └── db.js              # Encrypted connection store
├── src/
│   ├── App.jsx            # Sidebar, tabs, and modals
│   ├── TerminalTab.jsx    # Terminal component, colorizer
│   ├── SftpExplorer.jsx   # SFTP UI, progress, CRUD
│   ├── App.css            # Styles and color variables
│   └── main.jsx           # App entry point
├── electron.js            # Electron main process entry
├── package.json           # Scripts and dependency definitions
└── vite.config.js         # Client bundler configuration
```

---

## License

This project is open-source and available under the [MIT License](LICENSE).
