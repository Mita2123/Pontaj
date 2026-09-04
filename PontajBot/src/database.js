const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const dataDirectory = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDirectory, { recursive: true });

const db = new Database(path.join(dataDirectory, 'pontaj.sqlite'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS bot_settings (
    guild_id TEXT PRIMARY KEY,
    timekeeping_channel_id TEXT,
    panel_message_id TEXT,
    updated_at_ms INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS active_sessions (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at_ms INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS member_totals (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS completed_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    started_at_ms INTEGER NOT NULL,
    ended_at_ms INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_member_totals_by_guild
    ON member_totals (guild_id, duration_ms DESC);

  CREATE TABLE IF NOT EXISTS schema_migrations (
    migration_id TEXT PRIMARY KEY,
    applied_at_ms INTEGER NOT NULL
  );
`);

const hasLegacyDailyTotals = db.prepare(`
  SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'daily_totals'
`).get();
const hasMigratedLegacyTotals = db.prepare(`
  SELECT 1 FROM schema_migrations WHERE migration_id = 'daily-totals-to-member-totals'
`).get();

if (hasLegacyDailyTotals && !hasMigratedLegacyTotals) {
  db.transaction(() => {
    db.exec(`
      INSERT INTO member_totals (guild_id, user_id, duration_ms)
      SELECT guild_id, user_id, SUM(duration_ms)
      FROM daily_totals
      GROUP BY guild_id, user_id
      ON CONFLICT(guild_id, user_id) DO UPDATE SET
        duration_ms = member_totals.duration_ms + excluded.duration_ms;
    `);
    db.prepare(`
      INSERT INTO schema_migrations (migration_id, applied_at_ms) VALUES (?, ?)
    `).run('daily-totals-to-member-totals', Date.now());
  })();
}

function getSettings(guildId) {
  return db.prepare('SELECT * FROM bot_settings WHERE guild_id = ?').get(guildId) || null;
}

function saveSettings(guildId, channelId, panelMessageId) {
  db.prepare(`
    INSERT INTO bot_settings (guild_id, timekeeping_channel_id, panel_message_id, updated_at_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      timekeeping_channel_id = excluded.timekeeping_channel_id,
      panel_message_id = excluded.panel_message_id,
      updated_at_ms = excluded.updated_at_ms
  `).run(guildId, channelId, panelMessageId, Date.now());
}

function getActiveSession(guildId, userId) {
  return db.prepare(
    'SELECT * FROM active_sessions WHERE guild_id = ? AND user_id = ?',
  ).get(guildId, userId) || null;
}

function getActiveSessions(guildId) {
  return db.prepare('SELECT * FROM active_sessions WHERE guild_id = ?').all(guildId);
}

function startSession(guildId, userId, startedAtMs) {
  const result = db.prepare(`
    INSERT INTO active_sessions (guild_id, user_id, started_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO NOTHING
  `).run(guildId, userId, startedAtMs);
  return result.changes === 1;
}

const finalizeSession = db.transaction((guildId, userId, endedAtMs) => {
  const active = getActiveSession(guildId, userId);
  if (!active) return null;

  const safeEndMs = Math.max(endedAtMs, active.started_at_ms);
  const durationMs = safeEndMs - active.started_at_ms;

  db.prepare(`
    INSERT INTO member_totals (guild_id, user_id, duration_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET
      duration_ms = duration_ms + excluded.duration_ms
  `).run(guildId, userId, durationMs);
  db.prepare(`
    INSERT INTO completed_sessions (guild_id, user_id, started_at_ms, ended_at_ms, duration_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(guildId, userId, active.started_at_ms, safeEndMs, durationMs);
  db.prepare('DELETE FROM active_sessions WHERE guild_id = ? AND user_id = ?').run(guildId, userId);

  return { ...active, endedAtMs: safeEndMs, durationMs };
});

function stopSession(guildId, userId, endedAtMs) {
  return finalizeSession(guildId, userId, endedAtMs);
}

function getStoredTotal(guildId, userId) {
  const row = db.prepare(`
    SELECT duration_ms FROM member_totals WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);
  return row?.duration_ms || 0;
}

function getStoredTotals(guildId) {
  return db.prepare(`
    SELECT user_id, duration_ms FROM member_totals
    WHERE guild_id = ? ORDER BY duration_ms DESC
  `).all(guildId);
}

const resetGuildData = db.transaction((guildId) => {
  db.prepare('DELETE FROM active_sessions WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM member_totals WHERE guild_id = ?').run(guildId);
  db.prepare('DELETE FROM completed_sessions WHERE guild_id = ?').run(guildId);
  if (hasLegacyDailyTotals) {
    db.prepare('DELETE FROM daily_totals WHERE guild_id = ?').run(guildId);
  }
});

function resetGuild(guildId) {
  resetGuildData(guildId);
}

module.exports = {
  getActiveSession,
  getActiveSessions,
  getSettings,
  getStoredTotal,
  getStoredTotals,
  resetGuild,
  saveSettings,
  startSession,
  stopSession,
};
