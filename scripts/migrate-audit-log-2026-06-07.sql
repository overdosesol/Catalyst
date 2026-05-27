-- ── Bundle #2 (2026-06-07): observability persistence migration ──────────
-- Run once on existing prod DB to create the 3 new tables. Safe to re-run
-- (all DDL uses IF NOT EXISTS). Boot-time _migrate() also re-applies this
-- via db.exec(schema.sql), so on next deploy this script is redundant —
-- present for explicit operator step / DR scenarios.
--
-- Usage on VPS:
--   sqlite3 /path/to/catalyst.db < scripts/migrate-audit-log-2026-06-07.sql

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT    NOT NULL DEFAULT (datetime('now')),
  actor_user_id   INTEGER,
  actor_kind      TEXT    NOT NULL,
  event_type      TEXT    NOT NULL,
  target_user_id  INTEGER,
  payload_json    TEXT,
  success         INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_ts     ON admin_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_event  ON admin_audit_log(event_type, ts DESC);

CREATE TABLE IF NOT EXISTS alert_decisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT    NOT NULL DEFAULT (datetime('now')),
  trend_id     INTEGER,
  user_id      INTEGER,
  source       TEXT,
  reason       TEXT    NOT NULL,
  gates_json   TEXT,
  weights_json TEXT,
  sent         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_ts    ON alert_decisions(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_user  ON alert_decisions(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_alert_decisions_trend ON alert_decisions(trend_id, ts DESC);

CREATE TABLE IF NOT EXISTS feature_usage_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ts        TEXT    NOT NULL DEFAULT (datetime('now')),
  user_id   INTEGER NOT NULL,
  feature   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feature_usage_user_feature_ts ON feature_usage_log(user_id, feature, ts DESC);
