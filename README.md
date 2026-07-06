# OmicronOps

OmicronOps is a premium, lightweight, glassmorphic desktop DevOps, remote management, and database client built on Electron and React. Designed to bring a modern terminal experience, visual file explorers, database managers, and system monitors to Linux desktops.

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
* **HAProxy Server Client/Manager**:
  * Live stats proxy monitoring with real-time stats parsing.
  * In-place controls to enable/disable backends and proxy servers instantly.
* **RabbitMQ Monitor**:
  * Visual queues and exchanges health tracking.
  * Node health diagnostics and message/connection stats.
* **PostgreSQL Database Client**:
  * Tree-structured database schema, tables, and views explorer.
  * Full data table browsing with sorting, filtering, and server-side pagination.
  * Custom SQL Query Execution Console with interactive, tabular result sets.
* **MongoDB Document Client**:
  * Tree-structured database, collection, and document explorer with UI-driven database and collection creation.
  * Real-time document querying, updates, deletion, and insertion.
  * Advanced query execution with built-in query cancellation support (via `AbortController`) for long-running operations.
* **Redis Client Browser**:
  * Namespace-delimited hierarchical key explorer tree view.
  * Collapsible Interactive CLI Terminal with stderr security warnings filtration.
  * Collapsible Live Redis Server Overview telemetry (replication states, active clients, uptime, memory, and CPU metrics).
  * Rich inline values editor supporting Strings, Hashes, Lists, Sets, and Sorted Sets (ZSets).
* **Clipboard Interoperability**:
  * **Highlight-to-Copy**: Highlighted terminal output is automatically copied to your system clipboard.
  * **Right-Click Paste**: Right-click paste support to transfer text from your clipboard directly into active PTY commands.
* **Encrypted Credential Storage**: Encrypts connection profiles locally using AES-256-CBC with a secure host key. Profiles are stored in compliance with Linux desktop standards under `~/.config/OmicronOps/`.
* **Automatic Window Resize**: Synchronizes PTY terminal rows/columns automatically via WebSocket whenever the window size changes.

---

## Tech Stack

* **Frontend**: React, Vite, Vanilla CSS (Glassmorphism layout system), `xterm.js` for canvas-based shell rendering.
* **Backend**: Node.js, Express, `ws` (WebSockets), `ssh2` (Pure Javascript SSH & SFTP fallback tunnel client), `pg` (PostgreSQL client).
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
   * **`release/omicron-ops_1.0.4_amd64.deb`**: Standard Debian/Ubuntu installer.
   * **`release/OmicronOps-1.0.4.AppImage`**: Portable, self-contained standalone executable.

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
│   ├── HaProxyClientTab.jsx # HAProxy statistics & server toggle controls
│   ├── RabbitMqClientTab.jsx # RabbitMQ queues & exchange monitoring
│   ├── PostgresClientTab.jsx # PostgreSQL schema explorer & SQL client
│   ├── MongoClientTab.jsx # MongoDB database explorer, collection manager, & query canceler
│   ├── RedisClientTab.jsx  # Redis namespace browser, CLI terminal, and server stats
│   ├── App.css            # Styles and color variables
│   └── main.jsx           # App entry point
├── electron.js            # Electron main process entry
├── package.json           # Scripts and dependency definitions
└── vite.config.js         # Client bundler configuration
```

---

## License

This project is open-source and available under the [MIT License](LICENSE).
