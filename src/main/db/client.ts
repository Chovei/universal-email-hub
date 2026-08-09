import { app } from 'electron'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'path'
import fs from 'fs'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _sqlite: Database.Database | null = null

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'emails.db')
}

function getMigrationsPath(): string {
  // In packaged app: migrations are next to the bundled index.js
  // In dev: migrations are in the source tree
  const candidates = [
    path.join(__dirname, 'migrations'),                          // packaged / built
    path.join(app.getAppPath(), 'src', 'main', 'db', 'migrations'), // dev (source)
  ]
  return candidates.find(fs.existsSync) ?? candidates[0]
}

export function initDatabase(): void {
  const dbPath = getDbPath()
  try {
    openAndMigrate(dbPath)
  } catch (err) {
    // A corrupt or unreadable database must not brick the app forever.
    // Preserve the bad files for forensics, then start fresh: mail re-syncs
    // from the providers (the source of truth) and credentials live in the
    // OS-encrypted store, not SQLite. Accounts must be re-added — painful,
    // but infinitely better than an app that never opens again.
    console.error('[db] open/migrate failed — backing up and recreating database:', err)
    closeQuietly()
    backupCorruptDatabase(dbPath)
    openAndMigrate(dbPath) // a second failure propagates — nothing more we can do
  }
}

function closeQuietly(): void {
  try { _sqlite?.close() } catch { /* already broken */ }
  _sqlite = null
  _db = null
}

function backupCorruptDatabase(dbPath: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbPath + suffix
    if (fs.existsSync(file)) {
      try {
        fs.renameSync(file, `${dbPath}.corrupt-${stamp}${suffix}`)
      } catch (err) {
        console.error(`[db] could not preserve ${file}:`, err)
        try { fs.rmSync(file, { force: true }) } catch { /* last resort */ }
      }
    }
  }
}

function openAndMigrate(dbPath: string): void {
  const dbDir = path.dirname(dbPath)

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true })
  }

  _sqlite = new Database(dbPath)

  // Performance tuning
  _sqlite.pragma('journal_mode = WAL')
  _sqlite.pragma('synchronous = NORMAL')
  _sqlite.pragma('cache_size = -65536') // 64 MB
  _sqlite.pragma('mmap_size = 268435456') // 256 MB
  _sqlite.pragma('temp_store = MEMORY')
  _sqlite.pragma('foreign_keys = ON')
  _sqlite.pragma('busy_timeout = 5000')
  _sqlite.pragma('wal_autocheckpoint = 1000')

  _db = drizzle(_sqlite, { schema })

  // Try file-based migrations first; fall back to inline DDL for dev / first run
  const migrationsPath = getMigrationsPath()
  if (fs.existsSync(migrationsPath)) {
    migrate(_db, { migrationsFolder: migrationsPath })
  } else {
    createTablesDirectly()
  }

  createFts5Table()
  ensureSchemaExtensions()
}

function createTablesDirectly(): void {
  if (!_sqlite) return
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, email TEXT NOT NULL,
      display_name TEXT NOT NULL, avatar_url TEXT, color TEXT DEFAULT '#6366F1' NOT NULL,
      is_active INTEGER DEFAULT 1 NOT NULL, sync_cursor TEXT, last_sync_at INTEGER,
      sync_interval_seconds INTEGER DEFAULT 60 NOT NULL, "order" INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL, notes TEXT, label TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_idx ON accounts (email);
    CREATE TABLE IF NOT EXISTS threads (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, remote_id TEXT,
      subject TEXT DEFAULT '' NOT NULL, snippet TEXT DEFAULT '' NOT NULL,
      last_message_at INTEGER NOT NULL, unread_count INTEGER DEFAULT 0 NOT NULL,
      message_count INTEGER DEFAULT 0 NOT NULL, is_starred INTEGER DEFAULT 0 NOT NULL,
      has_attachment INTEGER DEFAULT 0 NOT NULL, labels TEXT DEFAULT '[]' NOT NULL,
      participant_addresses TEXT DEFAULT '[]' NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS threads_account_last_msg_idx ON threads (account_id, last_message_at);
    CREATE INDEX IF NOT EXISTS threads_remote_idx ON threads (account_id, remote_id);
    CREATE INDEX IF NOT EXISTS threads_account_unread_idx ON threads (account_id, unread_count);
    CREATE INDEX IF NOT EXISTS threads_account_starred_idx ON threads (account_id, is_starred);
    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, remote_id TEXT NOT NULL,
      name TEXT NOT NULL, type TEXT DEFAULT 'custom' NOT NULL,
      total_count INTEGER DEFAULT 0 NOT NULL, unread_count INTEGER DEFAULT 0 NOT NULL,
      sync_cursor TEXT, updated_at INTEGER NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS folders_account_remote_idx ON folders (account_id, remote_id);
    CREATE INDEX IF NOT EXISTS folders_account_type_idx ON folders (account_id, type);
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL, thread_id TEXT NOT NULL, account_id TEXT NOT NULL,
      folder_id TEXT, remote_id TEXT NOT NULL, from_address TEXT NOT NULL, from_name TEXT,
      to_addresses TEXT DEFAULT '[]' NOT NULL, cc_addresses TEXT DEFAULT '[]' NOT NULL,
      bcc_addresses TEXT DEFAULT '[]' NOT NULL, reply_to_addresses TEXT DEFAULT '[]' NOT NULL,
      subject TEXT DEFAULT '' NOT NULL, body_html TEXT, body_text TEXT, date INTEGER NOT NULL,
      is_read INTEGER DEFAULT 0 NOT NULL, is_starred INTEGER DEFAULT 0 NOT NULL,
      is_draft INTEGER DEFAULT 0 NOT NULL, has_attachment INTEGER DEFAULT 0 NOT NULL,
      labels TEXT DEFAULT '[]' NOT NULL, headers TEXT DEFAULT '{}' NOT NULL,
      size_bytes INTEGER, fetched_at INTEGER NOT NULL,
      FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS messages_remote_idx ON messages (account_id, remote_id);
    CREATE INDEX IF NOT EXISTS messages_thread_date_idx ON messages (thread_id, date);
    CREATE INDEX IF NOT EXISTS messages_folder_date_idx ON messages (folder_id, date);
    CREATE INDEX IF NOT EXISTS messages_account_date_idx ON messages (account_id, date);
    CREATE INDEX IF NOT EXISTS messages_account_read_idx ON messages (account_id, is_read);
    CREATE INDEX IF NOT EXISTS messages_account_starred_idx ON messages (account_id, is_starred);
    CREATE INDEX IF NOT EXISTS messages_account_draft_idx ON messages (account_id, is_draft);
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY NOT NULL, message_id TEXT NOT NULL, filename TEXT NOT NULL,
      mime_type TEXT NOT NULL, size INTEGER NOT NULL, remote_ref TEXT NOT NULL,
      local_path TEXT, is_downloaded INTEGER DEFAULT 0 NOT NULL,
      is_inline INTEGER DEFAULT 0 NOT NULL, content_id TEXT,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id);
    CREATE TABLE IF NOT EXISTS sync_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, account_id TEXT NOT NULL,
      folder_id TEXT, type TEXT NOT NULL, priority INTEGER DEFAULT 5 NOT NULL,
      payload TEXT, status TEXT DEFAULT 'pending' NOT NULL, attempts INTEGER DEFAULT 0 NOT NULL,
      last_error TEXT, next_run_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sync_jobs_status_priority_idx ON sync_jobs (status, priority, next_run_at);
    CREATE INDEX IF NOT EXISTS sync_jobs_account_idx ON sync_jobs (account_id, status);
    CREATE TABLE IF NOT EXISTS plugin_storage (
      plugin_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS plugin_storage_pk ON plugin_storage (plugin_id, key);
    CREATE INDEX IF NOT EXISTS plugin_storage_plugin_idx ON plugin_storage (plugin_id);
  `)
}

function ensureSchemaExtensions(): void {
  if (!_sqlite) return

  // Add new columns to accounts for existing databases (safe to run on fresh DBs too)
  for (const sql of [
    'ALTER TABLE accounts ADD COLUMN notes TEXT',
    'ALTER TABLE accounts ADD COLUMN label TEXT',
  ]) {
    try { _sqlite.exec(sql) } catch { /* column already exists */ }
  }

  // verification_codes table — always safe with IF NOT EXISTS
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS verification_codes (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      service_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      sender_name TEXT,
      code TEXT NOT NULL,
      subject TEXT DEFAULT '' NOT NULL,
      received_at INTEGER NOT NULL,
      is_read INTEGER DEFAULT 0 NOT NULL,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS verification_codes_account_received_idx
      ON verification_codes (account_id, received_at);
    CREATE INDEX IF NOT EXISTS verification_codes_received_idx
      ON verification_codes (received_at);
  `)

  // Authenticator (TOTP) accounts. METADATA ONLY — there is deliberately no
  // secret column. Seeds live in the OS-encrypted credential store (see
  // src/main/totp/totpStore.ts), so a copy of this database yields no ability
  // to generate codes.
  _sqlite.exec(`
    CREATE TABLE IF NOT EXISTS totp_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT,
      issuer TEXT DEFAULT '' NOT NULL,
      label TEXT NOT NULL,
      algorithm TEXT DEFAULT 'SHA1' NOT NULL,
      digits INTEGER DEFAULT 6 NOT NULL,
      period INTEGER DEFAULT 30 NOT NULL,
      verified INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS totp_accounts_account_idx ON totp_accounts (account_id);
  `)

  // Hot-path indexes added after v0.1.16 (idempotent for existing DBs):
  // - sender lookups (search suggestions, sender filters)
  // - verification-code dedupe (message identity + 24h account/code window)
  _sqlite.exec(`
    CREATE INDEX IF NOT EXISTS messages_from_address_idx ON messages (from_address);
    CREATE INDEX IF NOT EXISTS verification_codes_message_idx ON verification_codes (message_id);
    CREATE INDEX IF NOT EXISTS verification_codes_account_code_idx
      ON verification_codes (account_id, code, received_at);
  `)
}

function createFts5Table(): void {
  if (!_sqlite) return

  _sqlite.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
      message_id UNINDEXED,
      account_id UNINDEXED,
      thread_id UNINDEXED,
      subject,
      body_text,
      from_address,
      from_name,
      to_addresses,
      content='',
      tokenize='unicode61 remove_diacritics 2'
    );
  `)
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.')
  return _db
}

export function getRawSqlite(): Database.Database {
  if (!_sqlite) throw new Error('Database not initialized.')
  return _sqlite
}

export function closeDatabase(): void {
  if (_sqlite) {
    // M2: Flush the WAL to the main DB file before closing so the next
    //     startup doesn't need to replay a large WAL file.
    try { _sqlite.pragma('wal_checkpoint(TRUNCATE)') } catch { /* ignore */ }
    _sqlite.close()
    _sqlite = null
    _db = null
  }
}

export function checkpoint(): void {
  _sqlite?.pragma('wal_checkpoint(RESTART)')
}
