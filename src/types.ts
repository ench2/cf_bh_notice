export type IntervalUnit = "minute" | "hour" | "day" | "month" | "year";
export type RepeatMode = "finite" | "forever";
export type ReminderStatus = "active" | "completed" | "deleted";

export type ReminderRow = {
  id: string;
  title: string;
  description: string;
  interval_value: number;
  interval_unit: IntervalUnit;
  repeat_mode: RepeatMode;
  repeat_remaining: number | null;
  next_run_at: string;
  last_sent_at: string | null;
  last_sent_for: string | null;
  last_completed_at: string | null;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
};

export type ReminderInput = {
  title: string;
  description?: string;
  intervalValue: number;
  intervalUnit: IntervalUnit;
  repeatMode: RepeatMode;
  repeatCount?: number;
  firstRunAt: string;
};

export type Env = {
  DB: D1Database;
  ADMIN_PASSWORD: string;
  RESEND_API_KEY: string;
  REMINDER_EMAIL: string;
  FROM_EMAIL: string;
};
