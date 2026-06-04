import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as SSHClient } from 'ssh2';
import {
  getAllConnections,
  getConnectionById,
  createConnection,
  updateConnection,
  deleteConnection,
  bulkCreateConnections,
  renameGroup,
  deleteGroup
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Active SSH connection sessions map: tabId -> sshClient
const activeSessions = new Map();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static UI assets from dist folder if built
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// REST API for SSH Connection Manager
app.get('/api/connections', (req, res) => {
  try {
    const list = getAllConnections(true);
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/connections/:id', (req, res) => {
  try {
    const conn = getConnectionById(req.params.id, false);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    res.json(conn);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/connections', (req, res) => {
  try {
    const newConn = createConnection(req.body);
    res.status(201).json(newConn);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/connections/bulk', (req, res) => {
  try {
    const { group, connections } = req.body;
    if (!connections || !Array.isArray(connections)) {
      return res.status(400).json({ error: 'connections array is required' });
    }
    const createdList = bulkCreateConnections(connections, group);
    res.status(201).json(createdList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/connections/:id', (req, res) => {
  try {
    const updated = updateConnection(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Connection not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/connections/:id', (req, res) => {
  try {
    const success = deleteConnection(req.params.id);
    if (!success) return res.status(404).json({ error: 'Connection not found' });
    res.json({ message: 'Connection deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/groups/rename', (req, res) => {
  try {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) {
      return res.status(400).json({ error: 'oldName and newName are required' });
    }
    const updatedCount = renameGroup(oldName, newName);
    res.json({ message: `Successfully renamed group. ${updatedCount} connections updated.`, updatedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/groups', (req, res) => {
  try {
    const { name } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Group name is required' });
    }
    const deletedCount = deleteGroup(name);
    res.json({ message: `Successfully deleted group. ${deletedCount} connections removed.`, deletedCount });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// SFTP File Manager API endpoints
app.get('/api/sftp/list', (req, res) => {
  const { tabId, path: remotePath } = req.query;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active connection session not found. Please reconnect.' });

  client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: `SFTP subsystem initiation failed: ${err.message}` });

    const targetPath = remotePath || '.';
    sftp.readdir(targetPath, (err, list) => {
      if (err) return res.status(500).json({ error: `Failed to read directory: ${err.message}` });

      const files = list.map(item => {
        const mode = item.attrs.mode;
        const isDir = (mode & 0o170000) === 0o040000;
        return {
          name: item.filename,
          isDir,
          size: item.attrs.size,
          mtime: item.attrs.mtime * 1000
        };
      });

      sftp.realpath(targetPath, (err, absPath) => {
        res.json({
          currentPath: err ? targetPath : absPath,
          files
        });
      });
    });
  });
});

app.get('/api/sftp/download', (req, res) => {
  const { tabId, path: remotePath } = req.query;
  if (!tabId || !remotePath) return res.status(400).json({ error: 'tabId and path are required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Session not found' });

  client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });

    sftp.stat(remotePath, (statErr, stats) => {
      if (statErr) return res.status(500).json({ error: `Failed to stat file: ${statErr.message}` });

      const filename = path.basename(remotePath);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', stats.size);

      const readStream = sftp.createReadStream(remotePath);
      readStream.on('error', (streamErr) => {
        console.error('SFTP download stream error:', streamErr);
        if (!res.headersSent) {
          res.status(500).json({ error: `Download failed: ${streamErr.message}` });
        }
      });
      readStream.pipe(res);
    });
  });
});

app.post('/api/sftp/upload', (req, res) => {
  const { tabId, path: remotePath } = req.query;
  if (!tabId || !remotePath) return res.status(400).json({ error: 'tabId and path are required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Session not found' });

  client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });

    const writeStream = sftp.createWriteStream(remotePath);
    
    writeStream.on('close', () => {
      res.json({ success: true });
    });

    writeStream.on('error', (streamErr) => {
      console.error('SFTP upload stream error:', streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: `Upload failed: ${streamErr.message}` });
      }
    });

    req.pipe(writeStream);
  });
});

app.post('/api/sftp/mkdir', (req, res) => {
  const { tabId, path: remotePath } = req.body;
  if (!tabId || !remotePath) return res.status(400).json({ error: 'tabId and path are required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Session not found' });

  client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });

    sftp.mkdir(remotePath, (err) => {
      if (err) return res.status(500).json({ error: `Failed to create folder: ${err.message}` });
      res.json({ success: true });
    });
  });
});

app.post('/api/sftp/delete', (req, res) => {
  const { tabId, path: remotePath, isDir } = req.body;
  if (!tabId || !remotePath) return res.status(400).json({ error: 'tabId and path are required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Session not found' });

  client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });

    const deleteFn = isDir ? sftp.rmdir.bind(sftp) : sftp.unlink.bind(sftp);
    deleteFn(remotePath, (err) => {
      if (err) return res.status(500).json({ error: `Deletion failed: ${err.message}` });
      res.json({ success: true });
    });
  });
});

app.post('/api/sftp/rename', (req, res) => {
  const { tabId, path: remotePath, newPath } = req.body;
  if (!tabId || !remotePath || !newPath) return res.status(400).json({ error: 'tabId, path, and newPath are required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Session not found' });

  client.sftp((err, sftp) => {
    if (err) return res.status(500).json({ error: err.message });

    sftp.rename(remotePath, newPath, (err) => {
      if (err) return res.status(500).json({ error: `Rename failed: ${err.message}` });
      res.json({ success: true });
    });
  });
});

// Fallback for single-page application routing (history API fallback)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      // In dev mode or if frontend is not built yet
      res.status(200).send('OmicronSSH Backend Running. UI is available in development mode (port 5173) or after running npm run build.');
    }
  });
});

// Create HTTP server
const server = createServer(app);

// Attach WebSocket server
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  if (pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  let sshClient = null;
  let sshStream = null;
  let connectionEstablished = false;
  let sessionTabId = null;

  const sendStatus = (status, error = null) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'status', status, error }));
    }
  };

  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'init') {
        if (connectionEstablished) return;

        sessionTabId = msg.tabId;

        let config = {};

        // Load connection from db or use raw quick connect credentials
        if (msg.connectionId) {
          const dbConn = getConnectionById(msg.connectionId, true);
          if (!dbConn) {
            sendStatus('disconnected', 'Saved connection details not found.');
            ws.close();
            return;
          }
          config = dbConn;
        } else {
          // Quick Connect
          config = msg;
        }

        const sshConfig = {
          host: config.host,
          port: config.port ? parseInt(config.port, 10) : 22,
          username: config.username,
          readyTimeout: 20000,
          keepaliveInterval: 10000,
          keepaliveCountMax: 3
        };

        if (config.authMethod === 'password') {
          sshConfig.password = config.password;
        } else if (config.authMethod === 'key') {
          sshConfig.privateKey = config.privateKey;
        } else {
          sendStatus('disconnected', 'Invalid authentication method.');
          ws.close();
          return;
        }

        sendStatus('connecting');

        sshClient = new SSHClient();

        sshClient.on('ready', () => {
          // Request interactive shell (PTY)
          const cols = msg.cols || 80;
          const rows = msg.rows || 24;

          sshClient.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
            if (err) {
              sendStatus('disconnected', `Failed to open shell: ${err.message}`);
              sshClient.end();
              ws.close();
              return;
            }

            sshStream = stream;
            connectionEstablished = true;
            if (sessionTabId) {
              activeSessions.set(sessionTabId, sshClient);
            }
            sendStatus('connected');

            // Pipe SSH stream output to WebSocket
            stream.on('data', (data) => {
              if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify({ type: 'data', data: data.toString('utf-8') }));
              }
            });

            stream.on('close', () => {
              sendStatus('disconnected', 'Session closed by remote host.');
              sshClient.end();
              ws.close();
            });
          });
        });

        sshClient.on('error', (err) => {
          sendStatus('disconnected', `SSH Connection error: ${err.message}`);
          ws.close();
        });

        sshClient.on('close', () => {
          if (connectionEstablished) {
            sendStatus('disconnected', 'Connection closed.');
          }
        });

        sshClient.connect(sshConfig);

      } else if (msg.type === 'data') {
        if (sshStream) {
          sshStream.write(msg.data);
        }
      } else if (msg.type === 'resize') {
        if (sshStream) {
          sshStream.setWindow(msg.rows, msg.cols, 0, 0);
        }
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    // Cleanup SSH connection on socket closure
    if (sessionTabId) {
      activeSessions.delete(sessionTabId);
    }
    if (sshStream) {
      sshStream.end();
    }
    if (sshClient) {
      sshClient.end();
    }
  });
});

export const serverStarted = new Promise((resolve) => {
  let currentPort = parseInt(port, 10) || 3000;
  
  function tryListen() {
    const tempServer = server.listen(currentPort);
    
    tempServer.once('listening', () => {
      const actualPort = server.address().port;
      global.serverPort = actualPort;
      console.log(`====================================================`);
      console.log(`OmicronSSH Server is running on port ${actualPort}`);
      console.log(`Open http://localhost:${actualPort} in your browser`);
      console.log(`====================================================`);
      resolve(actualPort);
    });
    
    tempServer.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${currentPort} is busy, trying port ${currentPort + 1}...`);
        currentPort++;
        tryListen();
      } else {
        console.error('Server listen error:', err);
      }
    });
  }
  
  tryListen();
});
