import { addInterval } from "./time";
import type { Env, IntervalUnit, ReminderInput, ReminderRow, RepeatMode } from "./types";

const INTERVAL_UNITS = new Set<IntervalUnit>(["minute", "hour", "day", "month", "year"]);
const REPEAT_MODES = new Set<RepeatMode>(["finite", "forever"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ADVANCE_NOTICE_DAYS = 3;
const DEFAULT_SEND_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_SEND_WINDOW_START = "00:00";
const DEFAULT_SEND_WINDOW_END = "23:59";
const DEFAULT_MIN_EMAIL_INTERVAL_MINUTES = 5;

export function validateReminderInput(input: unknown): ReminderInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Request body must be a JSON object");
  }

  const value = input as Record<string, unknown>;
  const title = stringValue(value.title).trim();
  const description = stringValue(value.description ?? "").trim();
  const intervalValue = Number(value.intervalValue);
  const intervalUnit = value.intervalUnit;
  const repeatMode = value.repeatMode;
  const repeatCount = value.repeatCount === undefined || value.repeatCount === null || value.repeatCount === ""
    ? undefined
    : Number(value.repeatCount);
  const firstRunAt = stringValue(value.firstRunAt);
  const advanceNoticeDays = value.advanceNoticeDays === undefined || value.advanceNoticeDays === null || value.advanceNoticeDays === ""
    ? DEFAULT_ADVANCE_NOTICE_DAYS
    : Number(value.advanceNoticeDays);
  const sendWindowStart = normalizeTimeOfDay(stringValue(value.sendWindowStart), DEFAULT_SEND_WINDOW_START);
  const sendWindowEnd = normalizeTimeOfDay(stringValue(value.sendWindowEnd), DEFAULT_SEND_WINDOW_END);
  const minEmailIntervalMinutes = value.minEmailIntervalMinutes === undefined || value.minEmailIntervalMinutes === null || value.minEmailIntervalMinutes === ""
    ? DEFAULT_MIN_EMAIL_INTERVAL_MINUTES
    : Number(value.minEmailIntervalMinutes);

  if (!title) throw new ValidationError("Title is required");
  if (!Number.isInteger(intervalValue) || intervalValue <= 0) {
    throw new ValidationError("Interval value must be a positive integer");
  }
  if (typeof intervalUnit !== "string" || !INTERVAL_UNITS.has(intervalUnit as IntervalUnit)) {
    throw new ValidationError("Invalid reminder unit");
  }
  if (typeof repeatMode !== "string" || !REPEAT_MODES.has(repeatMode as RepeatMode)) {
    throw new ValidationError("Invalid repeat mode");
  }
  if (repeatMode === "finite" && (typeof repeatCount !== "number" || !Number.isInteger(repeatCount) || repeatCount <= 0)) {
    throw new ValidationError("Repeat count must be a positive integer");
  }
  const finiteRepeatCount = repeatMode === "finite" ? repeatCount as number : undefined;
  if (Number.isNaN(new Date(firstRunAt).getTime())) {
    throw new ValidationError("Invalid first run time");
  }
  if (!Number.isInteger(advanceNoticeDays) || advanceNoticeDays < 0) {
    throw new ValidationError("Advance notice days must be a non-negative integer");
  }
  if (!sendWindowStart || !sendWindowEnd) {
    throw new ValidationError("Invalid send window time");
  }
  if (!Number.isInteger(minEmailIntervalMinutes) || minEmailIntervalMinutes <= 0) {
    throw new ValidationError("Minimum email interval must be a positive integer");
  }

  return {
    title,
    description,
    intervalValue,
    intervalUnit: intervalUnit as IntervalUnit,
    repeatMode: repeatMode as RepeatMode,
    repeatCount: finiteRepeatCount,
    firstRunAt: new Date(firstRunAt).toISOString(),
    advanceNoticeDays,
    sendWindowStart,
    sendWindowEnd,
    minEmailIntervalMinutes
  };
}

export async function listReminders(env: Env): Promise<ReminderRow[]> {
  const result = await env.DB.prepare(`
    SELECT *
    FROM reminders
    WHERE status != 'deleted'
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'completed' THEN 1 ELSE 2 END,
      next_run_at ASC,
      created_at DESC
  `).all<ReminderRow>();

  return result.results ?? [];
}

export async function createReminder(env: Env, input: ReminderInput, now = new Date()): Promise<ReminderRow> {
  const id = crypto.randomUUID();
  const nowIso = now.toISOString();

  const reminder: ReminderRow = {
    id,
    title: input.title,
    description: input.description ?? "",
    interval_value: input.intervalValue,
    interval_unit: input.intervalUnit,
    repeat_mode: input.repeatMode,
    repeat_remaining: input.repeatMode === "finite" ? input.repeatCount ?? null : null,
    next_run_at: input.firstRunAt,
    advance_notice_days: input.advanceNoticeDays,
    send_window_start: input.sendWindowStart,
    send_window_end: input.sendWindowEnd,
    min_email_interval_minutes: input.minEmailIntervalMinutes,
    last_sent_at: null,
    last_sent_for: null,
    last_completed_at: null,
    status: "active",
    created_at: nowIso,
    updated_at: nowIso
  };

  await env.DB.prepare(`
    INSERT INTO reminders (
      id, title, description, interval_value, interval_unit, repeat_mode, repeat_remaining,
      next_run_at, advance_notice_days, send_window_start, send_window_end, min_email_interval_minutes,
      last_sent_at, last_sent_for, last_completed_at, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    reminder.id,
    reminder.title,
    reminder.description,
    reminder.interval_value,
    reminder.interval_unit,
    reminder.repeat_mode,
    reminder.repeat_remaining,
    reminder.next_run_at,
    reminder.advance_notice_days,
    reminder.send_window_start,
    reminder.send_window_end,
    reminder.min_email_interval_minutes,
    reminder.last_sent_at,
    reminder.last_sent_for,
    reminder.last_completed_at,
    reminder.status,
    reminder.created_at,
    reminder.updated_at
  ).run();

  return reminder;
}

export async function updateReminder(
  env: Env,
  id: string,
  input: ReminderInput,
  now = new Date()
): Promise<ReminderRow | null> {
  const existing = await getReminder(env, id);
  if (!existing || existing.status === "deleted") return null;

  const nowIso = now.toISOString();
  const result = await env.DB.prepare(`
    UPDATE reminders
    SET title = ?,
        description = ?,
        interval_value = ?,
        interval_unit = ?,
        repeat_mode = ?,
        repeat_remaining = ?,
        next_run_at = ?,
        advance_notice_days = ?,
        send_window_start = ?,
        send_window_end = ?,
        min_email_interval_minutes = ?,
        last_sent_at = NULL,
        last_sent_for = NULL,
        last_completed_at = NULL,
        status = 'active',
        updated_at = ?
    WHERE id = ? AND status != 'deleted'
  `).bind(
    input.title,
    input.description ?? "",
    input.intervalValue,
    input.intervalUnit,
    input.repeatMode,
    input.repeatMode === "finite" ? input.repeatCount ?? null : null,
    input.firstRunAt,
    input.advanceNoticeDays,
    input.sendWindowStart,
    input.sendWindowEnd,
    input.minEmailIntervalMinutes,
    nowIso,
    id
  ).run();

  if ((result.meta.changes ?? 0) === 0) return null;
  return getReminder(env, id);
}

export async function deleteReminder(env: Env, id: string, now = new Date()): Promise<boolean> {
  const result = await env.DB.prepare(`
    UPDATE reminders
    SET status = 'deleted', updated_at = ?
    WHERE id = ? AND status != 'deleted'
  `).bind(now.toISOString(), id).run();

  return (result.meta.changes ?? 0) > 0;
}

export async function completeReminder(env: Env, id: string, now = new Date()): Promise<ReminderRow | null> {
  const reminder = await getReminder(env, id);
  if (!reminder || reminder.status === "deleted") return null;
  if (reminder.status === "completed") return reminder;

  const nowIso = now.toISOString();
  const nextRepeatRemaining = reminder.repeat_mode === "finite"
    ? Math.max((reminder.repeat_remaining ?? 0) - 1, 0)
    : null;
  const nextStatus = reminder.repeat_mode === "finite" && nextRepeatRemaining === 0 ? "completed" : "active";
  const nextRunAt = nextStatus === "completed"
    ? reminder.next_run_at
    : addInterval(nowIso, reminder.interval_value, reminder.interval_unit);

  await env.DB.prepare(`
    UPDATE reminders
    SET repeat_remaining = ?,
        next_run_at = ?,
        last_sent_for = NULL,
        last_completed_at = ?,
        status = ?,
        updated_at = ?
    WHERE id = ? AND status = 'active'
  `).bind(
    nextRepeatRemaining,
    nextRunAt,
    nowIso,
    nextStatus,
    nowIso,
    id
  ).run();

  return getReminder(env, id);
}

export async function processDueReminders(env: Env, now = new Date()): Promise<number> {
  const nowIso = now.toISOString();

  const result = await env.DB.prepare(`
    SELECT *
    FROM reminders
    WHERE status = 'active'
      AND julianday(next_run_at) <= julianday(?) + advance_notice_days
    ORDER BY next_run_at ASC
    LIMIT 100
  `).bind(nowIso).all<ReminderRow>();

  const reminders = result.results ?? [];
  let sentCount = 0;

  for (const reminder of reminders) {
    if (!shouldSendReminder(reminder, now)) {
      continue;
    }

    await sendReminderEmail(env, reminder);
    await env.DB.prepare(`
      UPDATE reminders
      SET last_sent_at = ?, last_sent_for = next_run_at, updated_at = ?
      WHERE id = ? AND status = 'active' AND next_run_at = ?
    `).bind(nowIso, nowIso, reminder.id, reminder.next_run_at).run();
    sentCount += 1;
  }

  return sentCount;
}

export async function sendTestEmail(env: Env): Promise<void> {
  const sentAt = new Date().toISOString();
  await sendEmail(env, {
    subject: "Notice reminder test email",
    text: `This is a test email from notice-reminder-worker at ${sentAt}.`,
    html: `<p>This is a test email from notice-reminder-worker at ${escapeHtml(sentAt)}.</p>`
  });
}

type ReminderSendPolicy = {
  windowStartMinute: number;
  windowEndMinute: number;
  minEmailIntervalMinutes: number;
};

function shouldSendReminder(reminder: ReminderRow, now: Date): boolean {
  const policy = getReminderSendPolicy(reminder);
  if (!isWithinAdvanceNoticeWindow(reminder, now)) {
    return false;
  }
  if (!isWithinSendWindow(now, policy)) {
    return false;
  }

  if (!reminder.last_sent_at) {
    return true;
  }

  const lastSentAt = new Date(reminder.last_sent_at).getTime();
  if (Number.isNaN(lastSentAt)) {
    return true;
  }

  return lastSentAt <= now.getTime() - policy.minEmailIntervalMinutes * 60_000;
}

function isWithinAdvanceNoticeWindow(reminder: ReminderRow, now: Date): boolean {
  const nextRunAt = new Date(reminder.next_run_at).getTime();
  if (Number.isNaN(nextRunAt)) {
    return false;
  }

  const advanceNoticeDays = parseNonNegativeInteger(reminder.advance_notice_days, DEFAULT_ADVANCE_NOTICE_DAYS);
  return nextRunAt <= now.getTime() + advanceNoticeDays * DAY_MS;
}

function getReminderSendPolicy(reminder: ReminderRow): ReminderSendPolicy {
  const windowStartMinute = parseTimeOfDay(reminder.send_window_start, DEFAULT_SEND_WINDOW_START);
  const windowEndMinute = parseTimeOfDay(reminder.send_window_end, DEFAULT_SEND_WINDOW_END);
  const minEmailIntervalMinutes = parsePositiveInteger(reminder.min_email_interval_minutes, DEFAULT_MIN_EMAIL_INTERVAL_MINUTES);

  return {
    windowStartMinute,
    windowEndMinute,
    minEmailIntervalMinutes
  };
}

function isWithinSendWindow(value: Date, policy: ReminderSendPolicy): boolean {
  const localMinute = getLocalMinuteOfDay(value, DEFAULT_SEND_TIME_ZONE);
  if (policy.windowStartMinute <= policy.windowEndMinute) {
    return localMinute >= policy.windowStartMinute && localMinute <= policy.windowEndMinute;
  }
  return localMinute >= policy.windowStartMinute || localMinute <= policy.windowEndMinute;
}

function getLocalMinuteOfDay(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(value);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return hour * 60 + minute;
}

function normalizeTimeOfDay(value: string, fallback: string): string {
  const target = value || fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(target);
  if (!match) return "";

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeOfDay(value: string | undefined, fallback: string): number {
  const target = value || fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(target);
  if (!match) return parseTimeOfDay(fallback, "08:00");

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return parseTimeOfDay(fallback, "08:00");
  }
  return hour * 60 + minute;
}

function parsePositiveInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value: string | number | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function getReminder(env: Env, id: string): Promise<ReminderRow | null> {
  return env.DB.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<ReminderRow>();
}

async function sendReminderEmail(env: Env, reminder: ReminderRow): Promise<void> {
  const subject = `Reminder: ${reminder.title}`;
  const nextRunAt = formatIsoForEmail(reminder.next_run_at);
  const repeatRemaining = reminder.repeat_mode === "forever" ? "Forever" : String(reminder.repeat_remaining);
  const text = [
    `Reminder: ${reminder.title}`,
    "",
    reminder.description ? `Note: ${reminder.description}` : "",
    `Due at: ${nextRunAt}`,
    `Interval: every ${reminder.interval_value} ${unitLabel(reminder.interval_unit)}`,
    `Remaining repeats: ${repeatRemaining}`,
    "",
    "Open the reminder page and mark this item complete to schedule the next run."
  ].filter(Boolean).join("\n");

  const html = `
    <h1>${escapeHtml(reminder.title)}</h1>
    ${reminder.description ? `<p>${escapeHtml(reminder.description)}</p>` : ""}
    <p><strong>Due at:</strong> ${escapeHtml(nextRunAt)}</p>
    <p><strong>Interval:</strong> every ${reminder.interval_value} ${escapeHtml(unitLabel(reminder.interval_unit))}</p>
    <p><strong>Remaining repeats:</strong> ${escapeHtml(repeatRemaining)}</p>
    <p>Open the reminder page and mark this item complete to schedule the next run.</p>
  `;

  await sendEmail(env, { subject, text, html });
}

async function sendEmail(env: Env, message: { subject: string; text: string; html: string }): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [env.REMINDER_EMAIL],
      subject: message.subject,
      text: message.text,
      html: message.html
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend email failed: ${response.status} ${errorText}`);
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function unitLabel(unit: IntervalUnit): string {
  return {
    minute: "minute",
    hour: "hour",
    day: "day",
    month: "month",
    year: "year"
  }[unit];
}

function formatIsoForEmail(value: string): string {
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
