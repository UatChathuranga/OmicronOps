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
  deleteMacro,
  getDecryptedConnections,
  getAllSavedQueries,
  createSavedQuery,
  deleteSavedQuery
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Active SSH connection sessions map: tabId -> sshClient
const activeSessions = new Map();

// Active database queries map: tabId -> { pgClient, tunnel, pid, connection, activeDb }
const activeQueries = new Map();

// Active RabbitMQ SSH tunnels map: tabId -> { tunnel, port, username, password }
const activeRmqTunnels = new Map();

// Active HAProxy SSH tunnels map: tabId -> { tunnel, port, username, password }
const activeHaproxyTunnels = new Map();

export function getCredentialsForPort(port) {
  for (const info of activeHaproxyTunnels.values()) {
    if (info.port === Number(port)) {
      return { username: info.username, password: info.password };
    }
  }
  for (const info of activeRmqTunnels.values()) {
    if (info.port === Number(port)) {
      return { username: info.username, password: info.password };
    }
  }
  return null;
}

const app = express();
const port = process.env.PORT || 0;

app.use(cors());
app.use(express.json());

// Serve static UI assets from dist folder if built
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// REST API for PostgreSQL Saved Queries
app.get('/api/db/postgres/queries', (req, res) => {
  try {
    const list = getAllSavedQueries();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/db/postgres/queries', (req, res) => {
  try {
    const { name, query } = req.body;
    if (!name || !query) {
      return res.status(400).json({ error: 'Name and query are required' });
    }
    const newQuery = createSavedQuery({ name, query });
    res.status(201).json(newQuery);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/db/postgres/queries/:id', (req, res) => {
  try {
    const deleted = deleteSavedQuery(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Query not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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

app.get('/api/connections/export', (req, res) => {
  try {
    const list = getDecryptedConnections();
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
  const { tabId, connection, activeDb, query, timeout } = req.body;
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

    const statementTimeoutMs = timeout !== undefined ? timeout * 1000 : 15000;

    // 2. Connect pg.Client to the local endpoint of the tunnel
    pgClient = new pg.Client({
      host: '127.0.0.1',
      port: tunnel.port,
      user: username,
      password: password,
      database: dbName,
      statement_timeout: statementTimeoutMs
    });

    await pgClient.connect();

    // Get the process ID of the database connection
    const pidResult = await pgClient.query('SELECT pg_backend_pid() AS pid');
    const pid = pidResult.rows[0].pid;

    // Save active query information
    activeQueries.set(tabId, { pgClient, tunnel, pid, connection, activeDb });

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
    activeQueries.delete(tabId);
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

// Cancel a running database query
app.post('/api/db/postgres/cancel', async (req, res) => {
  const { tabId } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });

  const activeQuery = activeQueries.get(tabId);
  if (!activeQuery) {
    return res.json({ success: true, message: 'No active query to cancel' });
  }

  const { pgClient, tunnel, pid, connection, activeDb } = activeQuery;
  const client = activeSessions.get(tabId);

  if (!client) {
    try {
      if (pgClient.connection && pgClient.connection.stream) {
        pgClient.connection.stream.destroy();
      } else {
        await pgClient.end();
      }
    } catch (e) {}
    try { await tunnel.close(); } catch (e) {}
    activeQueries.delete(tabId);
    return res.json({ success: true, message: 'SSH session not found, cleaned up local connection' });
  }

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const pgConfig = dbConnection?.services?.postgres || connection?.services?.postgres || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = pgConfig.port || 5432;
  const username = pgConfig.username || 'postgres';
  const password = pgConfig.password && pgConfig.password !== '********' ? pgConfig.password : '';
  const dbName = activeDb || pgConfig.database || 'postgres';

  let cancelTunnel = null;
  let cancelPgClient = null;

  try {
    cancelTunnel = await createSshTunnel(client, host, port);
    cancelPgClient = new pg.Client({
      host: '127.0.0.1',
      port: cancelTunnel.port,
      user: username,
      password: password,
      database: dbName,
      statement_timeout: 5000
    });

    await cancelPgClient.connect();
    await cancelPgClient.query('SELECT pg_cancel_backend($1)', [pid]);

    try {
      if (pgClient.connection && pgClient.connection.stream) {
        pgClient.connection.stream.destroy();
      } else {
        await pgClient.end();
      }
    } catch (err) {
      console.error("Error ending cancelled client:", err);
    }

    res.json({ success: true });
  } catch (err) {
    try {
      if (pgClient.connection && pgClient.connection.stream) {
        pgClient.connection.stream.destroy();
      }
    } catch (e) {}
    res.status(500).json({ error: err.message || 'Failed to cancel query' });
  } finally {
    if (cancelPgClient) {
      try { await cancelPgClient.end(); } catch (e) {}
    }
    if (cancelTunnel) {
      try { await cancelTunnel.close(); } catch (e) {}
    }
    activeQueries.delete(tabId);
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

// Helper for parsing redis-cli --csv output
function parseCsvLines(stdout) {
  const results = [];
  let currentVal = '';
  let inQuotes = false;
  let hasValue = false;
  let i = 0;
  
  while (i < stdout.length) {
    const char = stdout[i];
    if (inQuotes) {
      hasValue = true;
      if (char === '\\') {
        const nextChar = stdout[i + 1];
        if (nextChar === '"') {
          currentVal += '"';
          i += 2;
        } else if (nextChar === '\\') {
          currentVal += '\\';
          i += 2;
        } else if (nextChar === 'n') {
          currentVal += '\n';
          i += 2;
        } else if (nextChar === 'r') {
          currentVal += '\r';
          i += 2;
        } else if (nextChar === 't') {
          currentVal += '\t';
          i += 2;
        } else {
          currentVal += char;
          i++;
        }
      } else if (char === '"') {
        const nextChar = stdout[i + 1];
        if (nextChar === '"') {
          currentVal += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        currentVal += char;
        i++;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        hasValue = true;
        i++;
      } else if (char === ',') {
        results.push(currentVal);
        currentVal = '';
        hasValue = false;
        i++;
      } else if (char === '\n' || char === '\r') {
        if (hasValue) {
          results.push(currentVal);
          currentVal = '';
          hasValue = false;
        }
        i++;
      } else if (char === ' ' || char === '\t') {
        i++;
      } else {
        currentVal += char;
        hasValue = true;
        i++;
      }
    }
  }
  if (hasValue) {
    results.push(currentVal);
  }
  return results;
}

// RabbitMQ Endpoints
app.post('/api/db/rabbitmq/connect', async (req, res) => {
  const { tabId, connection, port } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  try {
    const existing = activeRmqTunnels.get(tabId);
    if (existing) {
      return res.json({ success: true, port: existing.port });
    }

    const rmqPortVal = parseInt(port, 10);
    const managementPort = (!rmqPortVal || rmqPortVal === 5672) ? 15672 : rmqPortVal;

    const tunnel = await createSshTunnel(client, '127.0.0.1', managementPort);
    const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
    const rmqConfig = dbConnection?.services?.rabbitmq || connection?.services?.rabbitmq || {};
    activeRmqTunnels.set(tabId, { 
      tunnel, 
      port: tunnel.port,
      username: rmqConfig.username || '',
      password: rmqConfig.password || ''
    });

    res.json({ success: true, port: tunnel.port });
  } catch (err) {
    console.error('Failed to create RabbitMQ SSH tunnel:', err);
    res.status(500).json({ error: `Failed to create RabbitMQ SSH tunnel: ${err.message}` });
  }
});

app.post('/api/db/rabbitmq/disconnect', async (req, res) => {
  const { tabId } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });

  const rmq = activeRmqTunnels.get(tabId);
  if (rmq) {
    try {
      await rmq.tunnel.close();
    } catch (err) {
      console.error('Error closing RabbitMQ tunnel:', err);
    }
    activeRmqTunnels.delete(tabId);
  }
  res.json({ success: true });
});

function parseHaProxyCsv(csvText) {
  const lines = csvText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { frontends: [], backends: [], servers: [] };

  const headers = lines[0].replace(/^#\s*/, '').split(',');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const rawValues = lines[i].split(',');
    const row = {};
    headers.forEach((h, idx) => {
      if (h) {
        row[h] = rawValues[idx] || '';
      }
    });
    rows.push(row);
  }

  const frontends = [];
  const backends = [];
  const servers = [];

  rows.forEach(r => {
    if (r.svname === 'FRONTEND') {
      frontends.push({
        name: r.pxname,
        scur: parseInt(r.scur, 10) || 0,
        smax: parseInt(r.smax, 10) || 0,
        slim: parseInt(r.slim, 10) || 0,
        stot: parseInt(r.stot, 10) || 0,
        bin: parseInt(r.bin, 10) || 0,
        bout: parseInt(r.bout, 10) || 0,
        ereq: parseInt(r.ereq, 10) || 0,
        status: r.status
      });
    } else if (r.svname === 'BACKEND') {
      backends.push({
        name: r.pxname,
        scur: parseInt(r.scur, 10) || 0,
        smax: parseInt(r.smax, 10) || 0,
        slim: parseInt(r.slim, 10) || 0,
        stot: parseInt(r.stot, 10) || 0,
        bin: parseInt(r.bin, 10) || 0,
        bout: parseInt(r.bout, 10) || 0,
        status: r.status
      });
    } else {
      servers.push({
        backend: r.pxname,
        name: r.svname,
        scur: parseInt(r.scur, 10) || 0,
        smax: parseInt(r.smax, 10) || 0,
        stot: parseInt(r.stot, 10) || 0,
        bin: parseInt(r.bin, 10) || 0,
        bout: parseInt(r.bout, 10) || 0,
        status: r.status,
        weight: parseInt(r.weight, 10) || 0,
        check_duration: r.check_duration ? r.check_duration + 'ms' : '-',
        addr: r.addr || '-'
      });
    }
  });

  return { frontends, backends, servers };
}

// HAProxy Endpoints
app.post('/api/db/haproxy/connect', async (req, res) => {
  const { tabId, connection } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  try {
    const existing = activeHaproxyTunnels.get(tabId);
    if (existing) {
      return res.json({ success: true, port: existing.port });
    }

    const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
    const haproxyConfig = dbConnection?.services?.haproxy || connection?.services?.haproxy || {};
    const statsUrl = haproxyConfig.statsUrl || 'http://localhost:1936/;csv';

    let host = '127.0.0.1';
    let port = 1936;
    try {
      const parsed = new URL(statsUrl);
      host = parsed.hostname || '127.0.0.1';
      port = parsed.port ? parseInt(parsed.port, 10) : 1936;
    } catch (e) {
      const match = statsUrl.match(/https?:\/\/([^:/]+)(?::(\d+))?/);
      if (match) {
        host = match[1];
        port = match[2] ? parseInt(match[2], 10) : 1936;
      }
    }

    const tunnel = await createSshTunnel(client, host, port);
    activeHaproxyTunnels.set(tabId, { 
      tunnel, 
      port: tunnel.port,
      username: haproxyConfig.username || '',
      password: haproxyConfig.password || ''
    });

    res.json({ success: true, port: tunnel.port });
  } catch (err) {
    console.error('Failed to create HAProxy SSH tunnel:', err);
    res.status(500).json({ error: `Failed to create HAProxy SSH tunnel: ${err.message}` });
  }
});

app.post('/api/db/haproxy/disconnect', async (req, res) => {
  const { tabId } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });

  const rmq = activeHaproxyTunnels.get(tabId);
  if (rmq) {
    try {
      await rmq.tunnel.close();
    } catch (err) {
      console.error('Error closing HAProxy tunnel:', err);
    }
    activeHaproxyTunnels.delete(tabId);
  }
  res.json({ success: true });
});

app.post('/api/db/haproxy/stats', async (req, res) => {
  const { tabId, connection } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const haproxyConfig = dbConnection?.services?.haproxy || connection?.services?.haproxy || {};
  const statsUrl = haproxyConfig.statsUrl || 'http://localhost:1936/;csv';
  const username = haproxyConfig.username || '';
  const password = haproxyConfig.password || '';

  let url = statsUrl;
  if (!url.includes(';csv')) {
    if (url.endsWith('/')) {
      url += ';csv';
    } else if (url.includes('?')) {
      url += ';csv';
    } else {
      url += ';csv';
    }
  }

  let curlCmd = `curl -s -f`;
  if (username) {
    curlCmd += ` -u "${username.replace(/"/g, '\\"')}:${password.replace(/"/g, '\\"')}"`;
  }
  curlCmd += ` "${url.replace(/"/g, '\\"')}"`;

  client.exec(curlCmd, (err, stream) => {
    if (err) {
      return res.status(500).json({ error: `SSH command execution failed: ${err.message}` });
    }

    let output = '';
    let stderr = '';
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { stderr += data.toString(); });
    stream.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: `Failed to fetch HAProxy stats (exit code ${code}): ${stderr.trim() || 'Unknown error'}` });
      }

      try {
        const parsed = parseHaProxyCsv(output);
        res.json({ success: true, ...parsed });
      } catch (parseErr) {
        res.status(500).json({ error: `Failed to parse HAProxy CSV: ${parseErr.message}` });
      }
    });
  });
});

app.post('/api/db/haproxy/action', async (req, res) => {
  const { tabId, connection, serverName, backendName, action } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const haproxyConfig = dbConnection?.services?.haproxy || connection?.services?.haproxy || {};
  const statsUrl = haproxyConfig.statsUrl || 'http://localhost:1936/;csv';
  const username = haproxyConfig.username || '';
  const password = haproxyConfig.password || '';

  let baseUrl = statsUrl.replace(/;csv$/, '').replace(/\?stats;csv$/, '').replace(/&csv$/, '');
  
  const actionVal = action === 'ready' ? 'ready' : 'maint';
  let curlCmd = `curl -s -f -X POST`;
  if (username) {
    curlCmd += ` -u "${username.replace(/"/g, '\\"')}:${password.replace(/"/g, '\\"')}"`;
  }
  curlCmd += ` -d "s=${encodeURIComponent(serverName)}"`
          + ` -d "b=${encodeURIComponent(backendName)}"`
          + ` -d "action=${actionVal}"`
          + ` "${baseUrl.replace(/"/g, '\\"')}"`;

  client.exec(curlCmd, (err, stream) => {
    if (err) {
      return res.status(500).json({ error: `SSH command execution failed: ${err.message}` });
    }

    let output = '';
    let stderr = '';
    stream.on('data', (data) => { output += data.toString(); });
    stream.stderr.on('data', (data) => { stderr += data.toString(); });
    stream.on('close', (code) => {
      if (code !== 0) {
        return res.status(500).json({ error: `Failed to execute HAProxy admin action (exit code ${code}): ${stderr.trim() || 'Unknown error'}` });
      }
      res.json({ success: true });
    });
  });
});

// Redis Endpoints
app.post('/api/db/redis/info', (req, res) => {
  const { tabId, connection } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const redisConfig = dbConnection?.services?.redis || connection?.services?.redis || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = redisConfig.port || 6379;
  const password = redisConfig.password && redisConfig.password !== '********' ? redisConfig.password : '';

  let redisCliCmd = `redis-cli -h ${host} -p ${port}`;
  if (password) {
    redisCliCmd += ` -a '${password}'`;
  }

  const cmd = `${redisCliCmd} INFO keyspace`;

  client.exec(cmd, (err, stream) => {
    if (err) return res.status(500).json({ error: `SSH command failed: ${err.message}` });
    let stdout = '';
    let stderr = '';
    stream.on('data', data => stdout += data.toString());
    stream.stderr.on('data', data => stderr += data.toString());
    stream.on('close', () => {
      const errOut = stderr.trim();
      if (errOut && (errOut.includes('NOAUTH') || errOut.includes('invalid password') || errOut.includes('ERR'))) {
        return res.status(400).json({ error: errOut });
      }
      if (stdout.includes('NOAUTH')) {
        return res.status(401).json({ error: 'Redis authentication required' });
      }

      // Parse INFO keyspace (Format: db0:keys=10,expires=1,avg_ttl=17200)
      const counts = {};
      const lines = stdout.split('\n');
      lines.forEach(line => {
        const match = line.match(/^db(\d+):keys=(\d+)/);
        if (match) {
          counts[`db${match[1]}`] = parseInt(match[2], 10);
        }
      });
      res.json({ success: true, keyspace: counts });
    });
  });
});

app.post('/api/db/redis/server-info', (req, res) => {
  const { tabId, connection } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const redisConfig = dbConnection?.services?.redis || connection?.services?.redis || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = redisConfig.port || 6379;
  const password = redisConfig.password && redisConfig.password !== '********' ? redisConfig.password : '';

  let redisCliCmd = `redis-cli -h ${host} -p ${port}`;
  if (password) {
    redisCliCmd += ` -a '${password}'`;
  }

  const cmd = `${redisCliCmd} INFO`;

  client.exec(cmd, (err, stream) => {
    if (err) return res.status(500).json({ error: `SSH command failed: ${err.message}` });
    let stdout = '';
    let stderr = '';
    stream.on('data', data => stdout += data.toString());
    stream.stderr.on('data', data => stderr += data.toString());
    stream.on('close', () => {
      let cleanStderr = stderr.trim();
      if (cleanStderr.includes("Warning: Using a password")) {
        cleanStderr = cleanStderr.split('\n').filter(line => !line.includes("Warning: Using a password")).join('\n').trim();
      }
      if (cleanStderr && (cleanStderr.includes('NOAUTH') || cleanStderr.includes('invalid password') || cleanStderr.includes('ERR'))) {
        return res.status(400).json({ error: cleanStderr });
      }
      if (stdout.includes('NOAUTH')) {
        return res.status(401).json({ error: 'Redis authentication required' });
      }

      const info = {};
      const lines = stdout.split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const parts = trimmed.split(':');
          if (parts.length >= 2) {
            const key = parts[0].trim();
            const value = parts.slice(1).join(':').trim();
            info[key] = value;
          }
        }
      });
      res.json({ success: true, info });
    });
  });
});


app.post('/api/db/redis/keys', (req, res) => {
  const { tabId, connection, dbIndex, filter } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const redisConfig = dbConnection?.services?.redis || connection?.services?.redis || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = redisConfig.port || 6379;
  const password = redisConfig.password && redisConfig.password !== '********' ? redisConfig.password : '';

  let redisCliCmd = `redis-cli -h ${host} -p ${port} -n ${dbIndex}`;
  if (password) {
    redisCliCmd += ` -a '${password}'`;
  }

  const pattern = filter ? `*${filter}*` : '*';
  // Use Lua to fetch key name, type, and ttl in a single run-time JSON structure
  const luaScript = `local keys = redis.call('keys', '${pattern.replace(/'/g, "\\'")}'); local res = {}; for i, k in ipairs(keys) do res[k] = {type = redis.call('type', k).ok, ttl = redis.call('ttl', k)} end; return cjson.encode(res)`;
  const cmd = `${redisCliCmd} EVAL "${luaScript.replace(/"/g, '\\"')}" 0`;

  client.exec(cmd, (err, stream) => {
    if (err) return res.status(500).json({ error: `SSH command failed: ${err.message}` });
    let stdout = '';
    let stderr = '';
    stream.on('data', data => stdout += data.toString());
    stream.stderr.on('data', data => stderr += data.toString());
    stream.on('close', () => {
      const errOut = stderr.trim();
      if (errOut && !stdout.trim()) {
        return res.status(400).json({ error: errOut });
      }
      try {
        let output = stdout.trim();
        const start = output.indexOf('{');
        const end = output.lastIndexOf('}');
        if (start !== -1 && end !== -1) {
          output = output.substring(start, end + 1);
          const parsed = JSON.parse(output);
          return res.json({ success: true, keys: parsed });
        }
        res.json({ success: true, keys: {} });
      } catch (parseErr) {
        res.status(500).json({ error: `Failed to parse keys JSON: ${parseErr.message}`, raw: stdout });
      }
    });
  });
});

app.post('/api/db/redis/get', (req, res) => {
  const { tabId, connection, dbIndex, key, type } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const redisConfig = dbConnection?.services?.redis || connection?.services?.redis || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = redisConfig.port || 6379;
  const password = redisConfig.password && redisConfig.password !== '********' ? redisConfig.password : '';

  let redisCliCmd = `redis-cli --csv -h ${host} -p ${port} -n ${dbIndex}`;
  if (password) {
    redisCliCmd += ` -a '${password}'`;
  }

  let subcmd = '';
  if (type === 'string') {
    subcmd = `GET "${key.replace(/"/g, '\\"')}"`;
  } else if (type === 'hash') {
    subcmd = `HGETALL "${key.replace(/"/g, '\\"')}"`;
  } else if (type === 'list') {
    subcmd = `LRANGE "${key.replace(/"/g, '\\"')}" 0 -1`;
  } else if (type === 'set') {
    subcmd = `SMEMBERS "${key.replace(/"/g, '\\"')}"`;
  } else if (type === 'zset') {
    subcmd = `ZRANGE "${key.replace(/"/g, '\\"')}" 0 -1 WITHSCORES`;
  } else {
    return res.status(400).json({ error: `Unknown key type: ${type}` });
  }

  const cmd = `${redisCliCmd} ${subcmd}`;

  client.exec(cmd, (err, stream) => {
    if (err) return res.status(500).json({ error: `SSH command failed: ${err.message}` });
    let stdout = '';
    let stderr = '';
    stream.on('data', data => stdout += data.toString());
    stream.stderr.on('data', data => stderr += data.toString());
    stream.on('close', () => {
      const errOut = stderr.trim();
      if (errOut && !stdout.trim()) {
        return res.status(400).json({ error: errOut });
      }

      const results = parseCsvLines(stdout);
      let value = null;

      if (type === 'string') {
        value = results[0] || '';
      } else if (type === 'hash') {
        value = {};
        for (let i = 0; i < results.length; i += 2) {
          if (results[i] !== undefined) {
            value[results[i]] = results[i + 1] || '';
          }
        }
      } else if (type === 'list' || type === 'set') {
        value = results;
      } else if (type === 'zset') {
        value = [];
        for (let i = 0; i < results.length; i += 2) {
          if (results[i] !== undefined) {
            value.push({
              member: results[i],
              score: parseFloat(results[i + 1]) || 0
            });
          }
        }
      }

      res.json({ success: true, value });
    });
  });
});

app.post('/api/db/redis/update', (req, res) => {
  const { tabId, connection, dbIndex, action, key, field, value, index, score, ttl } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const redisConfig = dbConnection?.services?.redis || connection?.services?.redis || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = redisConfig.port || 6379;
  const password = redisConfig.password && redisConfig.password !== '********' ? redisConfig.password : '';

  let redisCliCmd = `redis-cli -h ${host} -p ${port} -n ${dbIndex}`;
  if (password) {
    redisCliCmd += ` -a '${password}'`;
  }

  let subcmd = '';
  if (action === 'set-string') {
    subcmd = `SET "${key.replace(/"/g, '\\"')}" "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'set-ttl') {
    if (ttl === -1) {
      subcmd = `PERSIST "${key.replace(/"/g, '\\"')}"`;
    } else {
      subcmd = `EXPIRE "${key.replace(/"/g, '\\"')}" ${ttl}`;
    }
  } else if (action === 'hash-set') {
    subcmd = `HSET "${key.replace(/"/g, '\\"')}" "${field.replace(/"/g, '\\"')}" "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'hash-del') {
    subcmd = `HDEL "${key.replace(/"/g, '\\"')}" "${field.replace(/"/g, '\\"')}"`;
  } else if (action === 'list-push') {
    subcmd = `RPUSH "${key.replace(/"/g, '\\"')}" "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'list-set') {
    subcmd = `LSET "${key.replace(/"/g, '\\"')}" ${index} "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'list-del') {
    subcmd = `EVAL "local val = redis.call('LINDEX', KEYS[1], ARGV[1]); redis.call('LREM', KEYS[1], 1, val)" 1 "${key.replace(/"/g, '\\"')}" ${index}`;
  } else if (action === 'set-add') {
    subcmd = `SADD "${key.replace(/"/g, '\\"')}" "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'set-rem') {
    subcmd = `SREM "${key.replace(/"/g, '\\"')}" "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'zset-add') {
    subcmd = `ZADD "${key.replace(/"/g, '\\"')}" ${score} "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'zset-rem') {
    subcmd = `ZREM "${key.replace(/"/g, '\\"')}" "${value.replace(/"/g, '\\"')}"`;
  } else if (action === 'delete-key') {
    subcmd = `DEL "${key.replace(/"/g, '\\"')}"`;
  } else if (action === 'flush-db') {
    subcmd = `FLUSHDB`;
  } else {
    return res.status(400).json({ error: `Unknown action: ${action}` });
  }

  const cmd = `${redisCliCmd} ${subcmd}`;

  client.exec(cmd, (err, stream) => {
    if (err) return res.status(500).json({ error: `SSH command failed: ${err.message}` });
    let stdout = '';
    let stderr = '';
    stream.on('data', data => stdout += data.toString());
    stream.stderr.on('data', data => stderr += data.toString());
    stream.on('close', () => {
      const errOut = stderr.trim();
      if (errOut && !stdout.trim()) {
        return res.status(400).json({ error: errOut });
      }
      res.json({ success: true, output: stdout.trim() });
    });
  });
});

app.post('/api/db/redis/cli', (req, res) => {
  const { tabId, connection, dbIndex, command } = req.body;
  if (!tabId) return res.status(400).json({ error: 'tabId is required' });
  const client = activeSessions.get(tabId);
  if (!client) return res.status(400).json({ error: 'Active SSH session not found' });

  const dbConnection = connection?.id ? getConnectionById(connection.id, true) : null;
  const redisConfig = dbConnection?.services?.redis || connection?.services?.redis || {};
  const host = dbConnection?.host || connection?.host || '127.0.0.1';
  const port = redisConfig.port || 6379;
  const password = redisConfig.password && redisConfig.password !== '********' ? redisConfig.password : '';

  let redisCliCmd = `redis-cli -h ${host} -p ${port} -n ${dbIndex}`;
  if (password) {
    redisCliCmd += ` -a '${password}'`;
  }

  const cmd = `${redisCliCmd} ${command}`;

  client.exec(cmd, (err, stream) => {
    if (err) return res.status(500).json({ error: `SSH command failed: ${err.message}` });
    let stdout = '';
    let stderr = '';
    stream.on('data', data => stdout += data.toString());
    stream.stderr.on('data', data => stderr += data.toString());
    stream.on('close', () => {
      res.json({ 
        success: true, 
        stdout: stdout,
        stderr: stderr
      });
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
      const rmq = activeRmqTunnels.get(sessionTabId);
      if (rmq) {
        rmq.tunnel.close().catch(() => {});
        activeRmqTunnels.delete(sessionTabId);
      }
      const haproxy = activeHaproxyTunnels.get(sessionTabId);
      if (haproxy) {
        haproxy.tunnel.close().catch(() => {});
        activeHaproxyTunnels.delete(sessionTabId);
      }
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
