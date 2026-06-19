import { app, BrowserWindow, Menu } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import and start our Express/WebSocket server
let getCredentialsForPort = null;
let serverPromise = import('./server/server.js')
  .then(module => {
    getCredentialsForPort = module.getCredentialsForPort;
    return module.serverStarted;
  })
  .catch(err => {
    console.error('Failed to start OmicronOps server:', err);
  });

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: 'OmicronOps',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true
    }
  });

  // Remove the default window menu bar for a premium standalone feel
  mainWindow.setMenuBarVisibility(false);

  // Wait for Express server to start up and bind to a port
  serverPromise.then(actualPort => {
    if (!actualPort || !mainWindow) return;
    mainWindow.loadURL(`http://localhost:${actualPort}`).catch(err => {
      console.error(`Failed to load local server URL http://localhost:${actualPort}:`, err);
    });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Handle Basic Authentication events natively inside Electron guest frames/webviews
  app.on('login', (event, webContents, request, authInfo, callback) => {
    if (getCredentialsForPort) {
      const creds = getCredentialsForPort(authInfo.port);
      if (creds && creds.username) {
        event.preventDefault();
        callback(creds.username, creds.password);
      }
    }
  });
});

app.on('window-all-closed', () => {
  // Gracefully terminate the Express server process when the window is closed
  app.quit();
});
