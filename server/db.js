import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve standard Linux user configuration folder path (~/.config/OmicronOps)
const xdgConfig = process.env.XDG_CONFIG_HOME;
const DATA_DIR = xdgConfig 
  ? path.join(xdgConfig, 'OmicronOps') 
  : path.join(os.homedir(), '.config', 'OmicronOps');

const DB_FILE = path.join(DATA_DIR, 'connections.json');
const KEY_FILE = path.join(DATA_DIR, 'secret.key');
const MACROS_FILE = path.join(DATA_DIR, 'macros.json');
const SAVED_QUERIES_FILE = path.join(DATA_DIR, 'saved_queries.json');

// Ensure new configuration directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Automatically migrate database files from the old OmicronSSH directory or local directory if they exist
const SSH_DATA_DIR = xdgConfig 
  ? path.join(xdgConfig, 'OmicronSSH') 
  : path.join(os.homedir(), '.config', 'OmicronSSH');

const SSH_DB_FILE = path.join(SSH_DATA_DIR, 'connections.json');
const SSH_KEY_FILE = path.join(SSH_DATA_DIR, 'secret.key');

if (fs.existsSync(SSH_DATA_DIR)) {
  try {
    if (fs.existsSync(SSH_KEY_FILE) && !fs.existsSync(KEY_FILE)) {
      fs.copyFileSync(SSH_KEY_FILE, KEY_FILE);
    }
    if (fs.existsSync(SSH_DB_FILE) && !fs.existsSync(DB_FILE)) {
      fs.copyFileSync(SSH_DB_FILE, DB_FILE);
    }
  } catch (err) {
    console.error('OmicronOps: automatic migration of OmicronSSH config files failed:', err);
  }
}

const OLD_DATA_DIR = path.join(__dirname, '..', 'data');
const OLD_DB_FILE = path.join(OLD_DATA_DIR, 'connections.json');
const OLD_KEY_FILE = path.join(OLD_DATA_DIR, 'secret.key');

if (fs.existsSync(OLD_DATA_DIR)) {
  try {
    if (fs.existsSync(OLD_KEY_FILE) && !fs.existsSync(KEY_FILE)) {
      fs.copyFileSync(OLD_KEY_FILE, KEY_FILE);
    }
    if (fs.existsSync(OLD_DB_FILE) && !fs.existsSync(DB_FILE)) {
      fs.copyFileSync(OLD_DB_FILE, DB_FILE);
    }
  } catch (err) {
    console.error('OmicronOps: automatic migration of local config files failed:', err);
  }
}

// Get or create secret key
let secretKey;
if (fs.existsSync(KEY_FILE)) {
  secretKey = fs.readFileSync(KEY_FILE);
} else {
  // Generate a random 32-byte key
  secretKey = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, secretKey);
}

// Encryption helpers
const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

export function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, secretKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

export function decrypt(encryptedText) {
  if (!encryptedText) return '';
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 2) return '';
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(ALGORITHM, secretKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption failed:', error.message);
    return '';
  }
}

// Database operations
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database file:', error);
    return [];
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing database file:', error);
    return false;
  }
}

function getDefaultPort(srv) {
  switch(srv) {
    case 'postgres': return 5432;
    case 'mongo': return 27017;
    case 'redis': return 6379;
    case 'rabbitmq': return 5672;
    case 'haproxy': return 1936;
    default: return 0;
  }
}

export function getAllConnections(maskCredentials = true) {
  const connections = readDB();
  return connections.map(conn => {
    const masked = { ...conn };
    if (maskCredentials) {
      if (masked.password) masked.password = '********';
      if (masked.privateKey) masked.privateKey = '********';
      if (masked.passphrase) masked.passphrase = '********';
      if (masked.services) {
        masked.services = JSON.parse(JSON.stringify(masked.services));
        Object.keys(masked.services).forEach(srv => {
          if (masked.services[srv] && masked.services[srv].password) {
            masked.services[srv].password = '********';
          }
        });
      }
    }
    return masked;
  });
}

export function getConnectionById(id, decryptCredentials = false) {
  const connections = readDB();
  const conn = connections.find(c => c.id === id);
  if (!conn) return null;

  const result = { ...conn };
  if (result.services) {
    result.services = JSON.parse(JSON.stringify(result.services));
    if (decryptCredentials) {
      Object.keys(result.services).forEach(srv => {
        if (result.services[srv] && result.services[srv].password) {
          result.services[srv].password = decrypt(result.services[srv].password);
        }
      });
    } else {
      Object.keys(result.services).forEach(srv => {
        if (result.services[srv] && result.services[srv].password) {
          result.services[srv].password = '********';
        }
      });
    }
  }
  if (decryptCredentials) {
    if (result.password) result.password = decrypt(result.password);
    if (result.privateKey) result.privateKey = decrypt(result.privateKey);
    if (result.passphrase) result.passphrase = decrypt(result.passphrase);
  } else {
    if (result.passphrase) result.passphrase = '********';
  }
  return result;
}

export function createConnection(connData) {
  const connections = readDB();
  const newConn = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    name: connData.name || 'New Connection',
    host: connData.host || 'localhost',
    port: parseInt(connData.port, 10) || 22,
    username: connData.username || 'root',
    authMethod: connData.authMethod || 'password', // 'password' or 'key'
    group: connData.group || 'Default',
    created: new Date().toISOString(),
    services: {
      postgres: {
        enabled: !!connData.services?.postgres?.enabled,
        port: parseInt(connData.services?.postgres?.port, 10) || 5432,
        database: connData.services?.postgres?.database || '',
        username: connData.services?.postgres?.username || '',
        password: connData.services?.postgres?.password ? encrypt(connData.services.postgres.password) : ''
      },
      mongo: {
        enabled: !!connData.services?.mongo?.enabled,
        port: parseInt(connData.services?.mongo?.port, 10) || 27017,
        database: connData.services?.mongo?.database || '',
        username: connData.services?.mongo?.username || '',
        password: connData.services?.mongo?.password ? encrypt(connData.services.mongo.password) : ''
      },
      redis: {
        enabled: !!connData.services?.redis?.enabled,
        port: parseInt(connData.services?.redis?.port, 10) || 6379,
        password: connData.services?.redis?.password ? encrypt(connData.services.redis.password) : ''
      },
      rabbitmq: {
        enabled: !!connData.services?.rabbitmq?.enabled,
        port: parseInt(connData.services?.rabbitmq?.port, 10) || 5672,
        username: connData.services?.rabbitmq?.username || '',
        password: connData.services?.rabbitmq?.password ? encrypt(connData.services.rabbitmq.password) : ''
      },
      haproxy: {
        enabled: !!connData.services?.haproxy?.enabled,
        port: parseInt(connData.services?.haproxy?.port, 10) || 1936,
        statsUrl: connData.services?.haproxy?.statsUrl || '',
        username: connData.services?.haproxy?.username || '',
        password: connData.services?.haproxy?.password ? encrypt(connData.services.haproxy.password) : ''
      }
    }
  };

  if (newConn.authMethod === 'password' && connData.password) {
    newConn.password = encrypt(connData.password);
  } else if (newConn.authMethod === 'key') {
    if (connData.privateKey) {
      newConn.privateKey = encrypt(connData.privateKey);
    }
    if (connData.passphrase) {
      newConn.passphrase = encrypt(connData.passphrase);
    }
  }

  connections.push(newConn);
  writeDB(connections);
  return newConn;
}

export function bulkCreateConnections(connectionsList, groupName) {
  const connections = readDB();
  const createdList = [];
  
  const existingGroupNames = Array.from(
    new Set(connections.map(c => c.group || 'Default'))
  );
  
  for (const connData of connectionsList) {
    const rawGroup = (connData.group || groupName || 'Default').trim();
    const matchedGroup = existingGroupNames.find(
      g => g.toLowerCase() === rawGroup.toLowerCase()
    ) || rawGroup;

    const newConn = {
      id: crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString() + Math.random().toString().substring(2, 6)),
      name: connData.name || 'New Connection',
      host: connData.host || 'localhost',
      port: parseInt(connData.port, 10) || 22,
      username: connData.username || 'root',
      authMethod: connData.authMethod || 'password',
      group: matchedGroup,
      created: new Date().toISOString(),
      services: {
        postgres: {
          enabled: !!connData.services?.postgres?.enabled,
          port: parseInt(connData.services?.postgres?.port, 10) || 5432,
          database: connData.services?.postgres?.database || '',
          username: connData.services?.postgres?.username || '',
          password: connData.services?.postgres?.password ? encrypt(connData.services.postgres.password) : ''
        },
        mongo: {
          enabled: !!connData.services?.mongo?.enabled,
          port: parseInt(connData.services?.mongo?.port, 10) || 27017,
          database: connData.services?.mongo?.database || '',
          username: connData.services?.mongo?.username || '',
          password: connData.services?.mongo?.password ? encrypt(connData.services.mongo.password) : ''
        },
        redis: {
          enabled: !!connData.services?.redis?.enabled,
          port: parseInt(connData.services?.redis?.port, 10) || 6379,
          password: connData.services?.redis?.password ? encrypt(connData.services.redis.password) : ''
        },
        rabbitmq: {
          enabled: !!connData.services?.rabbitmq?.enabled,
          port: parseInt(connData.services?.rabbitmq?.port, 10) || 5672,
          username: connData.services?.rabbitmq?.username || '',
          password: connData.services?.rabbitmq?.password ? encrypt(connData.services.rabbitmq.password) : ''
        },
        haproxy: {
          enabled: !!connData.services?.haproxy?.enabled,
          port: parseInt(connData.services?.haproxy?.port, 10) || 1936,
          statsUrl: connData.services?.haproxy?.statsUrl || '',
          username: connData.services?.haproxy?.username || '',
          password: connData.services?.haproxy?.password ? encrypt(connData.services.haproxy.password) : ''
        }
      }
    };

    if (newConn.authMethod === 'password' && connData.password) {
      newConn.password = encrypt(connData.password);
    } else if (newConn.authMethod === 'key') {
      if (connData.privateKey) {
        newConn.privateKey = encrypt(connData.privateKey);
      }
      if (connData.passphrase) {
        newConn.passphrase = encrypt(connData.passphrase);
      }
    }

    connections.push(newConn);
    createdList.push(newConn);

    if (!existingGroupNames.some(g => g.toLowerCase() === matchedGroup.toLowerCase())) {
      existingGroupNames.push(matchedGroup);
    }
  }
  
  writeDB(connections);
  return createdList;
}

export function updateConnection(id, connUpdate) {
  const connections = readDB();
  const index = connections.findIndex(c => c.id === id);
  if (index === -1) return null;

  const existing = connections[index];
  
  // Basic properties
  existing.name = connUpdate.name ?? existing.name;
  existing.host = connUpdate.host ?? existing.host;
  existing.port = connUpdate.port ? parseInt(connUpdate.port, 10) : existing.port;
  existing.username = connUpdate.username ?? existing.username;
  existing.authMethod = connUpdate.authMethod ?? existing.authMethod;
  existing.group = connUpdate.group ?? existing.group;
  existing.updated = new Date().toISOString();

  // For services: merge updates
  if (connUpdate.services) {
    existing.services = existing.services || {};
    const servicesList = ['postgres', 'mongo', 'redis', 'rabbitmq', 'haproxy'];
    
    servicesList.forEach(srv => {
      const updateSrv = connUpdate.services[srv] || {};
      const existingSrv = existing.services[srv] || {};
      
      existing.services[srv] = {
        enabled: updateSrv.enabled !== undefined ? !!updateSrv.enabled : !!existingSrv.enabled,
        port: updateSrv.port !== undefined ? parseInt(updateSrv.port, 10) : (existingSrv.port || getDefaultPort(srv)),
        database: updateSrv.database !== undefined ? updateSrv.database : (existingSrv.database || ''),
        username: updateSrv.username !== undefined ? updateSrv.username : (existingSrv.username || ''),
        statsUrl: updateSrv.statsUrl !== undefined ? updateSrv.statsUrl : (existingSrv.statsUrl || ''),
        password: existingSrv.password || ''
      };
      
      // Manage password: encrypt if updated and not masked '********'
      if (updateSrv.password !== undefined) {
        if (updateSrv.password === '') {
          existing.services[srv].password = '';
        } else if (updateSrv.password !== '********') {
          existing.services[srv].password = encrypt(updateSrv.password);
        }
      }
    });
  }

  // Manage sensitive fields: only encrypt if updated and not the mask placeholder '********'
  if (existing.authMethod === 'password') {
    if (connUpdate.password && connUpdate.password !== '********') {
      existing.password = encrypt(connUpdate.password);
      existing.privateKey = ''; // Clear key if switching auth
      existing.passphrase = ''; // Clear passphrase
    }
  } else if (existing.authMethod === 'key') {
    if (connUpdate.privateKey && connUpdate.privateKey !== '********') {
      existing.privateKey = encrypt(connUpdate.privateKey);
      existing.password = ''; // Clear password if switching auth
    }
    if (connUpdate.passphrase !== undefined) {
      if (connUpdate.passphrase === '') {
        existing.passphrase = '';
      } else if (connUpdate.passphrase !== '********') {
        existing.passphrase = encrypt(connUpdate.passphrase);
      }
    }
  }

  connections[index] = existing;
  writeDB(connections);
  return existing;
}

export function deleteConnection(id) {
  const connections = readDB();
  const filtered = connections.filter(c => c.id !== id);
  if (filtered.length === connections.length) return false;
  writeDB(filtered);
  return true;
}

export function renameGroup(oldName, newName) {
  const connections = readDB();
  let updatedCount = 0;
  const updated = connections.map(conn => {
    if ((conn.group || 'Default') === oldName) {
      updatedCount++;
      return { ...conn, group: newName || 'Default' };
    }
    return conn;
  });
  if (updatedCount > 0) {
    writeDB(updated);
  }
  return updatedCount;
}

export function deleteGroup(groupName) {
  const connections = readDB();
  const filtered = connections.filter(conn => (conn.group || 'Default') !== groupName);
  const deletedCount = connections.length - filtered.length;
  if (deletedCount > 0) {
    writeDB(filtered);
  }
  return deletedCount;
}

function readMacros() {
  if (!fs.existsSync(MACROS_FILE)) {
    fs.writeFileSync(MACROS_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const data = fs.readFileSync(MACROS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading macros database file:', error);
    return [];
  }
}

function writeMacros(data) {
  try {
    fs.writeFileSync(MACROS_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing macros database file:', error);
    return false;
  }
}

export function getAllMacros() {
  return readMacros();
}

export function createMacro(macroData) {
  const macros = readMacros();
  const newMacro = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    name: macroData.name || 'Unnamed Macro',
    command: macroData.command || '',
    delay: macroData.delay !== undefined ? Number(macroData.delay) : 1,
    delays: Array.isArray(macroData.delays) ? macroData.delays.map(Number) : null,
    useSleepTiming: macroData.useSleepTiming !== false,
    stepMode: macroData.stepMode === true,
    created: new Date().toISOString()
  };
  macros.push(newMacro);
  writeMacros(macros);
  return newMacro;
}

export function updateMacro(id, macroUpdate) {
  const macros = readMacros();
  const index = macros.findIndex(m => m.id === id);
  if (index === -1) return null;

  const existing = macros[index];
  existing.name = macroUpdate.name ?? existing.name;
  existing.command = macroUpdate.command ?? existing.command;
  if (macroUpdate.delay !== undefined) existing.delay = Number(macroUpdate.delay);
  if (macroUpdate.delays !== undefined) {
    existing.delays = Array.isArray(macroUpdate.delays) ? macroUpdate.delays.map(Number) : null;
  }
  if (macroUpdate.useSleepTiming !== undefined) {
    existing.useSleepTiming = macroUpdate.useSleepTiming === true;
  }
  if (macroUpdate.stepMode !== undefined) existing.stepMode = macroUpdate.stepMode === true;
  existing.updated = new Date().toISOString();

  macros[index] = existing;
  writeMacros(macros);
  return existing;
}

export function deleteMacro(id) {
  const macros = readMacros();
  const filtered = macros.filter(m => m.id !== id);
  if (filtered.length === macros.length) return false;
  writeMacros(filtered);
  return true;
}

function readSavedQueries() {
  if (!fs.existsSync(SAVED_QUERIES_FILE)) {
    fs.writeFileSync(SAVED_QUERIES_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const data = fs.readFileSync(SAVED_QUERIES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading saved queries file:', error);
    return [];
  }
}

function writeSavedQueries(data) {
  try {
    fs.writeFileSync(SAVED_QUERIES_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing saved queries file:', error);
    return false;
  }
}

export function getAllSavedQueries() {
  const queries = readSavedQueries();
  return queries.sort((a, b) => new Date(b.created) - new Date(a.created));
}

export function createSavedQuery(queryData) {
  const queries = readSavedQueries();
  const newQuery = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    name: queryData.name || 'Unnamed Query',
    query: queryData.query || '',
    created: new Date().toISOString()
  };
  queries.push(newQuery);
  writeSavedQueries(queries);
  return newQuery;
}

export function deleteSavedQuery(id) {
  const queries = readSavedQueries();
  const filtered = queries.filter(q => q.id !== id);
  if (filtered.length === queries.length) return false;
  writeSavedQueries(filtered);
  return true;
}

export function getDecryptedConnections() {
  const connections = readDB();
  return connections.map(conn => {
    const result = { ...conn };
    if (result.password) result.password = decrypt(result.password);
    if (result.privateKey) result.privateKey = decrypt(result.privateKey);
    if (result.passphrase) result.passphrase = decrypt(result.passphrase);
    if (result.services) {
      result.services = JSON.parse(JSON.stringify(result.services));
      Object.keys(result.services).forEach(srv => {
        if (result.services[srv] && result.services[srv].password) {
          result.services[srv].password = decrypt(result.services[srv].password);
        }
      });
    }
    return result;
  });
}

const SAVED_MONGO_QUERIES_FILE = path.join(DATA_DIR, 'saved_mongo_queries.json');

function readSavedMongoQueries() {
  if (!fs.existsSync(SAVED_MONGO_QUERIES_FILE)) {
    fs.writeFileSync(SAVED_MONGO_QUERIES_FILE, JSON.stringify([], null, 2));
    return [];
  }
  try {
    const data = fs.readFileSync(SAVED_MONGO_QUERIES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading saved MongoDB queries file:', error);
    return [];
  }
}

function writeSavedMongoQueries(data) {
  try {
    fs.writeFileSync(SAVED_MONGO_QUERIES_FILE, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing saved MongoDB queries file:', error);
    return false;
  }
}

export function getAllSavedMongoQueries() {
  const queries = readSavedMongoQueries();
  return queries.sort((a, b) => new Date(b.created) - new Date(a.created));
}

export function createSavedMongoQuery(queryData) {
  const queries = readSavedMongoQueries();
  const newQuery = {
    id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
    name: queryData.name || 'Unnamed Query',
    query: queryData.query || '',
    created: new Date().toISOString()
  };
  queries.push(newQuery);
  writeSavedMongoQueries(queries);
  return newQuery;
}

export function deleteSavedMongoQuery(id) {
  const queries = readSavedMongoQueries();
  const filtered = queries.filter(q => q.id !== id);
  if (filtered.length === queries.length) return false;
  writeSavedMongoQueries(filtered);
  return true;
}



