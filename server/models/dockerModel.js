import path from 'path';
import fs from 'fs';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getDb(connectionId) {
  const dbDir = path.join(__dirname, '../../data/metrics');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = path.join(dbDir, `${connectionId}.sqlite`);
  const db = new sqlite3.Database(dbPath);
  db.run('PRAGMA journal_mode = WAL');
  return db;
}

export function initDockerTables(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS vm_docker_metadata (
          installed INTEGER,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);
      });

      db.run(`
        CREATE TABLE IF NOT EXISTS vm_docker_containers (
          id TEXT PRIMARY KEY,
          name TEXT,
          image TEXT,
          status TEXT,
          state TEXT,
          ports TEXT,
          last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

export function saveDockerStatus(connectionId, installed, containersList) {
  const db = getDb(connectionId);
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM vm_docker_metadata', (err) => {
        if (err) console.error('Error clearing metadata:', err);
      });
      db.run('INSERT INTO vm_docker_metadata (installed) VALUES (?)', [installed ? 1 : 0], (err) => {
        if (err) console.error('Error saving metadata:', err);
      });

      db.run('DELETE FROM vm_docker_containers', (err) => {
        if (err) {
          db.close();
          return reject(err);
        }

        if (installed && containersList && Array.isArray(containersList)) {
          const stmt = db.prepare('INSERT INTO vm_docker_containers (id, name, image, status, state, ports) VALUES (?, ?, ?, ?, ?, ?)');
          for (const c of containersList) {
            stmt.run(c.id, c.name, c.image, c.status, c.state, c.ports);
          }
          stmt.finalize((err) => {
            db.close();
            if (err) return reject(err);
            resolve();
          });
        } else {
          db.close();
          resolve();
        }
      });
    });
  });
}

export function getDockerStatus(connectionId) {
  const db = getDb(connectionId);
  return new Promise((resolve, reject) => {
    db.get(`SELECT installed FROM vm_docker_metadata LIMIT 1`, (err, metaRow) => {
      if (err) {
        db.close();
        return reject(err);
      }
      const installed = metaRow ? metaRow.installed === 1 : false;
      db.all(`SELECT id, name, image, status, state, ports FROM vm_docker_containers`, (err, rows) => {
        db.close();
        if (err) return reject(err);
        resolve({ installed, list: rows || [] });
      });
    });
  });
}
