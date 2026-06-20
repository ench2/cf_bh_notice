ALTER TABLE reminders ADD COLUMN advance_notice_days INTEGER NOT NULL DEFAULT 3 CHECK (advance_notice_days >= 0);
