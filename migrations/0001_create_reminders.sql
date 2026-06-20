CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  interval_value INTEGER NOT NULL CHECK (interval_value > 0),
  interval_unit TEXT NOT NULL CHECK (interval_unit IN ('minute', 'hour', 'day', 'month', 'year')),
  repeat_mode TEXT NOT NULL CHECK (repeat_mode IN ('finite', 'forever')),
  repeat_remaining INTEGER CHECK (repeat_remaining IS NULL OR repeat_remaining >= 0),
  next_run_at TEXT NOT NULL,
  advance_notice_days INTEGER NOT NULL DEFAULT 3 CHECK (advance_notice_days >= 0),
  send_window_start TEXT NOT NULL DEFAULT '00:00',
  send_window_end TEXT NOT NULL DEFAULT '23:59',
  min_email_interval_minutes INTEGER NOT NULL DEFAULT 5 CHECK (min_email_interval_minutes > 0),
  last_sent_at TEXT,
  last_sent_for TEXT,
  last_completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_due
ON reminders (status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_reminders_list
ON reminders (status, next_run_at, created_at);
