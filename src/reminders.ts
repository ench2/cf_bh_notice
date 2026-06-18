import { addInterval } from "./time";
import type { Env, IntervalUnit, ReminderInput, ReminderRow, RepeatMode } from "./types";

const INTERVAL_UNITS = new Set<IntervalUnit>(["minute", "hour", "day", "month", "year"]);
const REPEAT_MODES = new Set<RepeatMode>(["finite", "forever"]);
const REMINDER_LOOKAHEAD_MS = 3 * 24 * 60 * 60 * 1000;
const MIN_EMAIL_INTERVAL_MS = 60 * 60 * 1000;
const SEND_TIME_ZONE = "Asia/Shanghai";
const SEND_WINDOW_START_MINUTE = 8 * 60;
const SEND_WINDOW_END_MINUTE = 22 * 60;

export function validateReminderInput(input: unknown): ReminderInput {
  if (!input || typeof input !== "object") {
    throw new ValidationError("请求体必须是 JSON 对象");
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

  if (!title) throw new ValidationError("标题不能为空");
  if (!Number.isInteger(intervalValue) || intervalValue <= 0) {
    throw new ValidationError("间隔数值必须是正整数");
  }
  if (typeof intervalUnit !== "string" || !INTERVAL_UNITS.has(intervalUnit as IntervalUnit)) {
    throw new ValidationError("提醒单位无效");
  }
  if (typeof repeatMode !== "string" || !REPEAT_MODES.has(repeatMode as RepeatMode)) {
    throw new ValidationError("重复模式无效");
  }
  if (repeatMode === "finite" && (typeof repeatCount !== "number" || !Number.isInteger(repeatCount) || repeatCount <= 0)) {
    throw new ValidationError("固定重复次数必须是正整数");
  }
  const finiteRepeatCount = repeatMode === "finite" ? repeatCount as number : undefined;
  if (Number.isNaN(new Date(firstRunAt).getTime())) {
    throw new ValidationError("首次提醒时间无效");
  }

  return {
    title,
    description,
    intervalValue,
    intervalUnit: intervalUnit as IntervalUnit,
    repeatMode: repeatMode as RepeatMode,
    repeatCount: finiteRepeatCount,
    firstRunAt: new Date(firstRunAt).toISOString()
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
      next_run_at, last_sent_at, last_sent_for, last_completed_at, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    reminder.id,
    reminder.title,
    reminder.description,
    reminder.interval_value,
    reminder.interval_unit,
    reminder.repeat_mode,
    reminder.repeat_remaining,
    reminder.next_run_at,
    reminder.last_sent_at,
    reminder.last_sent_for,
    reminder.last_completed_at,
    reminder.status,
    reminder.created_at,
    reminder.updated_at
  ).run();

  return reminder;
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
  if (!isWithinSendWindow(now)) {
    return 0;
  }

  const nowIso = now.toISOString();
  const lookaheadIso = new Date(now.getTime() + REMINDER_LOOKAHEAD_MS).toISOString();
  const lastAllowedSentAtIso = new Date(now.getTime() - MIN_EMAIL_INTERVAL_MS).toISOString();

  const result = await env.DB.prepare(`
    SELECT *
    FROM reminders
    WHERE status = 'active'
      AND next_run_at <= ?
      AND (last_sent_at IS NULL OR last_sent_at <= ?)
    ORDER BY next_run_at ASC
    LIMIT 50
  `).bind(lookaheadIso, lastAllowedSentAtIso).all<ReminderRow>();

  const reminders = result.results ?? [];
  let sentCount = 0;

  for (const reminder of reminders) {
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

function isWithinSendWindow(value: Date): boolean {
  const localMinute = getLocalMinuteOfDay(value, SEND_TIME_ZONE);
  return localMinute >= SEND_WINDOW_START_MINUTE && localMinute <= SEND_WINDOW_END_MINUTE;
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

async function getReminder(env: Env, id: string): Promise<ReminderRow | null> {
  return env.DB.prepare("SELECT * FROM reminders WHERE id = ?").bind(id).first<ReminderRow>();
}

async function sendReminderEmail(env: Env, reminder: ReminderRow): Promise<void> {
  const subject = `提醒：${reminder.title}`;
  const text = [
    `提醒：${reminder.title}`,
    "",
    reminder.description ? `备注：${reminder.description}` : "",
    `本次到期时间：${formatIsoForEmail(reminder.next_run_at)}`,
    `重复周期：每 ${reminder.interval_value} ${unitLabel(reminder.interval_unit)}`,
    `剩余次数：${reminder.repeat_mode === "forever" ? "永久重复" : reminder.repeat_remaining}`,
    "",
    "请登录管理页面并点击“本次完成”来推进下一次提醒。"
  ].filter(Boolean).join("\n");

  const html = `
    <h1>${escapeHtml(reminder.title)}</h1>
    ${reminder.description ? `<p>${escapeHtml(reminder.description)}</p>` : ""}
    <p><strong>本次到期时间：</strong>${escapeHtml(formatIsoForEmail(reminder.next_run_at))}</p>
    <p><strong>重复周期：</strong>每 ${reminder.interval_value} ${escapeHtml(unitLabel(reminder.interval_unit))}</p>
    <p><strong>剩余次数：</strong>${reminder.repeat_mode === "forever" ? "永久重复" : reminder.repeat_remaining}</p>
    <p>请登录管理页面并点击“本次完成”来推进下一次提醒。</p>
  `;

  await env.EMAIL.send({
    to: env.REMINDER_EMAIL,
    from: env.FROM_EMAIL,
    subject,
    text,
    html
  });
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function unitLabel(unit: IntervalUnit): string {
  return {
    minute: "分钟",
    hour: "小时",
    day: "日",
    month: "月",
    year: "年"
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
