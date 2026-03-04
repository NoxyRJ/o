const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const path = require("path");

let db;

async function initDB() {
  db = await open({
    filename: path.join(__dirname, "database.sqlite"),
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS targets (
      discord_id TEXT NOT NULL,
      type TEXT NOT NULL,              -- 'profile' ou 'group'
      roblox_id TEXT NOT NULL,
      username TEXT,
      total INTEGER DEFAULT 0,         -- baseTotal
      gained_today INTEGER DEFAULT 0,
      tracking INTEGER DEFAULT 0,
      last_update INTEGER DEFAULT 0,
      PRIMARY KEY (discord_id, type)
    );
  `);

  try {
    const cols = await db.all(`PRAGMA table_info(targets);`);
    const has = Array.isArray(cols) && cols.some((c) => c?.name === "last_follower_id");
    if (!has) {
      await db.exec(`ALTER TABLE targets ADD COLUMN last_follower_id INTEGER DEFAULT 0;`);
      console.log("✅ Migração: coluna last_follower_id adicionada em targets");
    }
  } catch (e) {
    console.log("⚠️ Migração last_follower_id falhou:", e?.message || e);
  }

  await db.exec(`
    CREATE TABLE IF NOT EXISTS history_daily (
      discord_id TEXT NOT NULL,
      day TEXT NOT NULL,               -- YYYY-MM-DD
      type TEXT NOT NULL,              -- 'profile' ou 'group'
      total INTEGER DEFAULT 0,
      PRIMARY KEY (discord_id, day, type)
    );
  `);

  return db;
}

function getDB() {
  return db;
}

module.exports = { initDB, getDB };