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

export function getAllConnections(maskCredentials = true) {
  const connections = readDB();
  if (maskCredentials) {
    return connections.map(conn => {
      const masked = { ...conn };
      if (masked.password) masked.password = '********';
      if (masked.privateKey) masked.privateKey = '********';
      return masked;
    });
  }
  return connections;
}

export function getConnectionById(id, decryptCredentials = false) {
  const connections = readDB();
  const conn = connections.find(c => c.id === id);
  if (!conn) return null;

  const result = { ...conn };
  if (decryptCredentials) {
    if (result.password) result.password = decrypt(result.password);
    if (result.privateKey) result.privateKey = decrypt(result.privateKey);
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
    created: new Date().toISOString()
  };

  if (newConn.authMethod === 'password' && connData.password) {
    newConn.password = encrypt(connData.password);
  } else if (newConn.authMethod === 'key' && connData.privateKey) {
    newConn.privateKey = encrypt(connData.privateKey);
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
      created: new Date().toISOString()
    };

    if (newConn.authMethod === 'password' && connData.password) {
      newConn.password = encrypt(connData.password);
    } else if (newConn.authMethod === 'key' && connData.privateKey) {
      newConn.privateKey = encrypt(connData.privateKey);
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

  // Manage sensitive fields: only encrypt if updated and not the mask placeholder '********'
  if (existing.authMethod === 'password') {
    if (connUpdate.password && connUpdate.password !== '********') {
      existing.password = encrypt(connUpdate.password);
      existing.privateKey = ''; // Clear key if switching auth
    }
  } else if (existing.authMethod === 'key') {
    if (connUpdate.privateKey && connUpdate.privateKey !== '********') {
      existing.privateKey = encrypt(connUpdate.privateKey);
      existing.password = ''; // Clear password if switching auth
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
