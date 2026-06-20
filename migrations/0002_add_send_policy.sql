ALTER TABLE reminders ADD COLUMN send_window_start TEXT NOT NULL DEFAULT '00:00';
ALTER TABLE reminders ADD COLUMN send_window_end TEXT NOT NULL DEFAULT '23:59';
ALTER TABLE reminders ADD COLUMN min_email_interval_minutes INTEGER NOT NULL DEFAULT 5 CHECK (min_email_interval_minutes > 0);
