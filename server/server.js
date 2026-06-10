import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as SSHClient } from 'ssh2';
import pg from 'pg';
import net from 'net';
import fs from 'fs';
import {
  getAllConnections,
  getConnectionById,
  createConnection,
  updateConnection,
  deleteConnection,
  bulkCreateConnections,
  renameGroup,
  deleteGroup,
  getAllMacros,
  createMacro,
  updateMacro,
  deleteMacro
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Active SSH connection sessions map: tabId -> sshClient
const activeSessions = new Map();

const app = express();
const port = process.env.PORT || 0;

app.use(cors());
app.use(express.json());

// Serve static UI assets from dist folder if built
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// REST API for Terminal Macros
app.get('/api/macros', (req, res) => {
  try {
    const list = getAllMacros();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/macros', (req, res) => {
  try {
    const newMacro = createMacro(req.body);
    res.status(201).json(newMacro);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/macros/:id', (req, res) => {
  try {
    const updated = updateMacro(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Macro not found' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/macros/:id', (req, res) => {
  try {
    const success = deleteMacro(req.params.id);
    if (!success) return res.status(404).json({ error: 'Macro not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
      if (err) {
        sftp.end();
        return res.status(500).json({ error: `Failed to read directory: ${err.message}` });
      }

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
        sftp.end();
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
      if (statErr) {
        sftp.end();
        return res.status(500).json({ error: `Failed to stat file: ${statErr.message}` });
      }

      const filename = path.basename(remotePath);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', stats.size);

      const readStream = sftp.createReadStream(remotePath);
      readStream.on('error', (streamErr) => {
        console.error('SFTP download stream error:', streamErr);
        sftp.end();
        if (!res.headersSent) {
          res.status(500).json({ error: `Download failed: ${streamErr.message}` });
        }
      });
      readStream.on('close', () => {
        sftp.end();
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
      sftp.end();
      res.json({ success: true });
    });

    writeStream.on('error', (streamErr) => {
      console.error('SFTP upload stream error:', streamErr);
      sftp.end();
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
      sftp.end();
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
      sftp.end();
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
      sftp.end();
      if (err) return res.status(500).json({ error: `Rename failed: ${err.message}` });
      res.json({ success: true });
    });
  });
});

// Helper to escape values for shell arguments safely in POSIX environments
function escapeShellArg(arg) {
  if (arg === undefined || arg === null) return "''";
  return "'" + String(arg).replace(/'/g, "'\\''") + "'";
}

// Creates a local TCP forwarding tunnel to target host:port through SSH connection
function createSshTunnel(sshClient, remoteHost, remotePort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      sshClient.forwardOut('127.0.0.1', socket.remotePort, remoteHost, remotePort, (err, stream) => {
        if (err) {
          socket.end();
          return;
        }
        socket.pipe(stream).pipe(socket);
      });
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((res) => server.close(res))
      });
    });
  });
}

// Database Client API for executing real queries on remote host via SSH
app.post('/api/db/postgres/query', async (req, res) => {
  const { tabId, connection, activeDb, query } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  // Load connection details from the DB to get decrypted credentials
  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const pgConfig = dbConnection?.services?.postgres || connection?.services?.postgres || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = pgConfig.port || 5432;
  const username = pgConfig.username || 'postgres';
  const password = pgConfig.password && pgConfig.password !== '********' ? pgConfig.password : '';
  const dbName = activeDb || pgConfig.database || 'postgres';

  let tunnel = null;
  let pgClient = null;

  try {
    // 1. Establish SSH Port Forwarding Tunnel
    tunnel = await createSshTunnel(client, host, port);

    // 2. Connect pg.Client to the local endpoint of the tunnel
    pgClient = new pg.Client({
      host: '127.0.0.1',
      port: tunnel.port,
      user: username,
      password: password,
      database: dbName,
      statement_timeout: 15000 // 15 seconds query timeout
    });

    await pgClient.connect();

    // 3. Execute query
    const result = await pgClient.query({
      text: query
    });

    const columns = result.fields ? result.fields.map(f => f.name) : ['command', 'rows_affected'];
    const rows = result.fields ? (Array.isArray(result.rows) ? result.rows : []) : [{ command: result.command, rows_affected: result.rowCount }];

    // Build a column → pg type name map using OID → type lookup
    let columnTypes = {};
    if (result.fields && result.fields.length > 0) {
      const oids = [...new Set(result.fields.map(f => f.dataTypeID))];
      const typeQuery = `SELECT oid, typname FROM pg_type WHERE oid = ANY($1)`;
      const typeResult = await pgClient.query(typeQuery, [oids]);
      const oidMap = {};
      typeResult.rows.forEach(r => { oidMap[r.oid] = r.typname; });
      result.fields.forEach(f => {
        columnTypes[f.name] = oidMap[f.dataTypeID] || 'text';
      });
    }

    res.json({
      success: true,
      columns,
      columnTypes,
      rows
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Database query error' });
  } finally {
    if (pgClient) {
      try {
        await pgClient.end();
      } catch (e) {
        console.error("Error ending pgClient:", e);
      }
    }
    if (tunnel) {
      try {
        await tunnel.close();
      } catch (e) {
        console.error("Error closing SSH tunnel:", e);
      }
    }
  }
});

// Update a single cell value in a table row via SSH tunnel
app.post('/api/db/postgres/update', async (req, res) => {
  const { tabId, connection, activeDb, schema, tableName, primaryKeyCol, primaryKeyVal, columnName, value } = req.body;
  if (!tabId || !tableName || !primaryKeyCol || primaryKeyVal === undefined || !columnName)
    return res.status(400).json({ error: 'tabId, tableName, primaryKeyCol, primaryKeyVal, columnName are required' });

  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const pgConfig = dbConnection?.services?.postgres || connection?.services?.postgres || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = pgConfig.port || 5432;
  const username = pgConfig.username || 'postgres';
  const password = pgConfig.password && pgConfig.password !== '********' ? pgConfig.password : '';
  const dbName = activeDb || pgConfig.database || 'postgres';

  let tunnel = null;
  let pgClient = null;

  try {
    tunnel = await createSshTunnel(client, host, port);

    pgClient = new pg.Client({
      host: '127.0.0.1',
      port: tunnel.port,
      user: username,
      password: password,
      database: dbName,
      statement_timeout: 15000
    });

    await pgClient.connect();

    const schemaName = schema || 'public';
    const updateQuery = `UPDATE "${schemaName}"."${tableName}" SET "${columnName}" = $1 WHERE "${primaryKeyCol}" = $2`;
    const result = await pgClient.query(updateQuery, [value === '' ? null : value, primaryKeyVal]);

    res.json({ success: true, rowsAffected: result.rowCount });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Update failed' });
  } finally {
    if (pgClient) {
      try { await pgClient.end(); } catch (e) { console.error("Error ending pgClient:", e); }
    }
    if (tunnel) {
      try { await tunnel.close(); } catch (e) { console.error("Error closing SSH tunnel:", e); }
    }
  }
});

// Insert a new row into a table via SSH tunnel
app.post('/api/db/postgres/insert', async (req, res) => {
  const { tabId, connection, activeDb, schema, tableName, row } = req.body;
  if (!tabId || !tableName || !row || typeof row !== 'object')
    return res.status(400).json({ error: 'tabId, tableName, and row are required' });

  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const pgConfig = dbConnection?.services?.postgres || connection?.services?.postgres || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = pgConfig.port || 5432;
  const username = pgConfig.username || 'postgres';
  const password = pgConfig.password && pgConfig.password !== '********' ? pgConfig.password : '';
  const dbName = activeDb || pgConfig.database || 'postgres';

  let tunnel = null;
  let pgClient = null;

  try {
    tunnel = await createSshTunnel(client, host, port);
    pgClient = new pg.Client({
      host: '127.0.0.1', port: tunnel.port, user: username,
      password, database: dbName, statement_timeout: 15000
    });
    await pgClient.connect();

    // Filter out empty-string values (treat as omit — let DB use defaults)
    const entries = Object.entries(row).filter(([, v]) => v !== '' && v !== undefined);
    if (entries.length === 0) return res.status(400).json({ error: 'At least one column value is required' });

    const cols = entries.map(([k]) => `"${k}"`).join(', ');
    const placeholders = entries.map((_, i) => `$${i + 1}`).join(', ');
    const values = entries.map(([, v]) => v);
    const schemaName = schema || 'public';

    const insertQuery = `INSERT INTO "${schemaName}"."${tableName}" (${cols}) VALUES (${placeholders}) RETURNING *`;
    const result = await pgClient.query(insertQuery, values);

    res.json({ success: true, insertedRow: result.rows[0] || null });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Insert failed' });
  } finally {
    if (pgClient) { try { await pgClient.end(); } catch (e) { console.error(e); } }
    if (tunnel) { try { await tunnel.close(); } catch (e) { console.error(e); } }
  }
});

// Delete a row from a table via SSH tunnel
app.post('/api/db/postgres/delete-row', async (req, res) => {
  const { tabId, connection, activeDb, schema, tableName, primaryKeyCol, primaryKeyVal } = req.body;
  if (!tabId || !tableName || !primaryKeyCol || primaryKeyVal === undefined)
    return res.status(400).json({ error: 'tabId, tableName, primaryKeyCol, primaryKeyVal are required' });

  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const pgConfig = dbConnection?.services?.postgres || connection?.services?.postgres || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = pgConfig.port || 5432;
  const username = pgConfig.username || 'postgres';
  const password = pgConfig.password && pgConfig.password !== '********' ? pgConfig.password : '';
  const dbName = activeDb || pgConfig.database || 'postgres';

  let tunnel = null;
  let pgClient = null;

  try {
    tunnel = await createSshTunnel(client, host, port);
    pgClient = new pg.Client({
      host: '127.0.0.1', port: tunnel.port, user: username,
      password, database: dbName, statement_timeout: 15000
    });
    await pgClient.connect();

    const schemaName = schema || 'public';
    const deleteQuery = `DELETE FROM "${schemaName}"."${tableName}" WHERE "${primaryKeyCol}" = $1`;
    const result = await pgClient.query(deleteQuery, [primaryKeyVal]);

    res.json({ success: true, rowsAffected: result.rowCount });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Delete failed' });
  } finally {
    if (pgClient) { try { await pgClient.end(); } catch (e) { console.error(e); } }
    if (tunnel) { try { await tunnel.close(); } catch (e) { console.error(e); } }
  }
});

app.post('/api/db/mongo/query', (req, res) => {
  const { tabId, connection, activeDb, collection, filter } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  // Load connection details from the DB to get decrypted credentials
  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const mongoConfig = dbConnection?.services?.mongo || connection?.services?.mongo || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = mongoConfig.port || 27017;
  const username = mongoConfig.username || '';
  const password = mongoConfig.password && mongoConfig.password !== '********' ? mongoConfig.password : '';
  const dbName = activeDb || mongoConfig.database || 'admin';

  let uri = 'mongodb://';
  if (username) {
    uri += `${username}:${password}@`;
  }
  uri += `${host}:${port}/${dbName}`;
  if (username) {
    uri += '?authSource=admin';
  }

  const filterStr = filter ? JSON.stringify(filter).replace(/"/g, '\\"') : '{}';

  // Attempt using mongosh, fall back to mongo
  const cmd = `if command -v mongosh &>/dev/null; then
    mongosh --quiet "${uri}" --eval "JSON.stringify(db.${collection}.find(${filterStr}).limit(100).toArray())"
  else
    mongo --quiet "${uri}" --eval "printjson(db.${collection}.find(${filterStr}).limit(100).toArray())"
  fi`;

  client.exec(cmd, (err, stream) => {
    if (err) return res.status(500).json({ error: `Failed to execute SSH query: ${err.message}` });

    let stdout = '';
    let stderr = '';

    stream.on('data', (data) => { stdout += data.toString(); });
    stream.stderr.on('data', (data) => { stderr += data.toString(); });
    stream.on('close', () => {
      const errOutput = stderr.trim();
      if (errOutput && !stdout.trim()) {
        return res.status(400).json({ error: errOutput });
      }

      try {
        let cleanOutput = stdout.trim();
        const jsonStart = cleanOutput.indexOf('[');
        const jsonEnd = cleanOutput.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          cleanOutput = cleanOutput.substring(jsonStart, jsonEnd + 1);
        }
        const parsed = JSON.parse(cleanOutput);
        res.json({ success: true, documents: parsed });
      } catch (parseErr) {
        res.status(500).json({ error: `Failed to parse query output: ${parseErr.message}`, rawOutput: stdout });
      }
    });
  });
});

// Helper RFC-4180 CSV Parser
function parseCSV(csvText) {
  const lines = [];
  let row = [];
  let inQuotes = false;
  let currentVal = '';
  
  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i+1];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      row.push(currentVal.trim());
      if (row.length > 0 && row.some(val => val !== '')) {
        lines.push(row);
      }
      row = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }
  if (currentVal !== '' || row.length > 0) {
    row.push(currentVal.trim());
    lines.push(row);
  }
  
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = lines[0];
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const r = {};
    columns.forEach((col, idx) => {
      let val = lines[i][idx];
      if (val && val.startsWith('"') && val.endsWith('"')) {
        val = val.substring(1, val.length - 1);
      }
      r[col] = val !== undefined ? val : null;
    });
    rows.push(r);
  }
  return { columns, rows };
}

// Fallback for single-page application routing (history API fallback)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'), (err) => {
    if (err) {
      // In dev mode or if frontend is not built yet
      res.status(200).send('OmicronOps Backend Running. UI is available in development mode (port 5173) or after running npm run build.');
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
  let statsInterval = null;

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

            // Start periodic VM stats monitoring
            if (!msg.hideStats) {
              statsInterval = setInterval(() => {
                if (!connectionEstablished || !sshClient || ws.readyState !== ws.OPEN) {
                  clearInterval(statsInterval);
                  return;
                }
                
                sshClient.exec('ram=$(free -m 2>/dev/null | awk \'/Mem:/ {print $2,$3}\'); [ -z "$ram" ] && ram="0 0"; disk=$(df -m / 2>/dev/null | awk \'NR==2 {print $2,$3}\'); [ -z "$disk" ] && disk="0 0"; load=$(cat /proc/loadavg 2>/dev/null | awk \'{print $1,$2,$3}\'); [ -z "$load" ] && load="0 0 0"; net=$(cat /proc/net/dev 2>/dev/null | awk \'NR>2 {rx+=$2; tx+=$10} END {print rx,tx}\'); [ -z "$net" ] && net="0 0"; echo "METRICS|$ram|$disk|$load|$net"', (err, execStream) => {
                  if (err) return;
                  
                  let output = '';
                  execStream.on('data', (data) => {
                    output += data.toString();
                  });
                  execStream.on('close', () => {
                    if (output.startsWith('METRICS|')) {
                      const parts = output.trim().split('|');
                      if (parts.length >= 5) {
                        const [memTotal, memUsed] = parts[1].split(' ').map(Number);
                        const [diskTotal, diskUsed] = parts[2].split(' ').map(Number);
                        const [load1, load5, load15] = parts[3].split(' ').map(Number);
                        const [rxBytes, txBytes] = parts[4].split(' ').map(Number);
                        
                        if (ws.readyState === ws.OPEN) {
                          ws.send(JSON.stringify({
                            type: 'stats',
                            stats: {
                              memory: { total: memTotal, used: memUsed },
                              disk: { total: diskTotal, used: diskUsed },
                              load: { load1, load5, load15 },
                              network: { rx: rxBytes, tx: txBytes }
                            }
                          }));
                        }
                      }
                    }
                  });
                });
              }, 3000);
            }

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
    if (statsInterval) {
      clearInterval(statsInterval);
    }
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
  let currentPort = parseInt(port, 10);
  if (isNaN(currentPort)) currentPort = 0;
  
  function tryListen() {
    const tempServer = server.listen(currentPort);
    
    tempServer.once('listening', () => {
      const actualPort = server.address().port;
      global.serverPort = actualPort;
      try {
        fs.writeFileSync(path.join(__dirname, '.port'), String(actualPort));
      } catch (err) {
        console.error('Failed to write port file:', err);
      }
      console.log(`====================================================`);
      console.log(`OmicronOps Server is running on port ${actualPort}`);
      console.log(`Open http://localhost:${actualPort} in your browser`);
      console.log(`====================================================`);
      resolve(actualPort);
    });
    
    tempServer.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && currentPort !== 0) {
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
