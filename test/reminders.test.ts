import { describe, expect, it, vi } from "vitest";
import { completeReminder, processDueReminders, validateReminderInput } from "../src/reminders";
import type { Env, ReminderRow } from "../src/types";

describe("validateReminderInput", () => {
  it("accepts valid finite reminders", () => {
    expect(validateReminderInput({
      title: "喝水",
      intervalValue: 1,
      intervalUnit: "minute",
      repeatMode: "finite",
      repeatCount: 2,
      firstRunAt: "2026-06-18T10:00:00.000Z"
    })).toMatchObject({
      title: "喝水",
      intervalValue: 1,
      intervalUnit: "minute",
      repeatMode: "finite",
      repeatCount: 2
    });
  });

  it("rejects second units", () => {
    expect(() => validateReminderInput({
      title: "喝水",
      intervalValue: 1,
      intervalUnit: "second",
      repeatMode: "forever",
      firstRunAt: "2026-06-18T10:00:00.000Z"
    })).toThrow("提醒单位无效");
  });
});

describe("reminder behavior", () => {
  it("completes a finite reminder and marks it completed when count reaches zero", async () => {
    const db = createDb([row({ repeat_remaining: 1 })]);
    const env = createEnv(db);

    const updated = await completeReminder(env, "r1", new Date("2026-06-18T10:15:00.000Z"));

    expect(updated?.status).toBe("completed");
    expect(updated?.repeat_remaining).toBe(0);
    expect(updated?.last_completed_at).toBe("2026-06-18T10:15:00.000Z");
  });

  it("completes an active reminder and computes next time from completion time", async () => {
    const db = createDb([row({ interval_value: 2, interval_unit: "hour", repeat_remaining: 3 })]);
    const env = createEnv(db);

    const updated = await completeReminder(env, "r1", new Date("2026-06-18T10:15:00.000Z"));

    expect(updated?.status).toBe("active");
    expect(updated?.repeat_remaining).toBe(2);
    expect(updated?.next_run_at).toBe("2026-06-18T12:15:00.000Z");
  });

  it("sends reminders up to three days early and throttles each reminder to one email per hour", async () => {
    const inWindow = row({ next_run_at: "2026-06-20T00:05:00.000Z", last_sent_at: null });
    const throttled = row({ id: "r2", next_run_at: "2026-06-20T00:05:00.000Z", last_sent_at: "2026-06-18T00:30:00.000Z" });
    const outsideLookahead = row({ id: "r3", next_run_at: "2026-06-21T00:06:00.000Z", last_sent_at: null });
    const db = createDb([inWindow, throttled, outsideLookahead]);
    const env = createEnv(db);

    const count = await processDueReminders(env, new Date("2026-06-18T00:05:00.000Z"));

    expect(count).toBe(1);
    expect(env.EMAIL.send).toHaveBeenCalledTimes(1);
    expect(db.rows[0].last_sent_for).toBe("2026-06-20T00:05:00.000Z");
    expect(db.rows[0].last_sent_at).toBe("2026-06-18T00:05:00.000Z");
  });

  it("does not send reminder emails before 08:00 Asia/Shanghai", async () => {
    const db = createDb([row({ next_run_at: "2026-06-18T10:00:00.000Z", last_sent_at: null })]);
    const env = createEnv(db);

    const count = await processDueReminders(env, new Date("2026-06-17T23:59:00.000Z"));

    expect(count).toBe(0);
    expect(env.EMAIL.send).not.toHaveBeenCalled();
  });
});

function row(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: "r1",
    title: "测试提醒",
    description: "",
    interval_value: 1,
    interval_unit: "minute",
    repeat_mode: "finite",
    repeat_remaining: 2,
    next_run_at: "2026-06-18T10:00:00.000Z",
    last_sent_at: null,
    last_sent_for: null,
    last_completed_at: null,
    status: "active",
    created_at: "2026-06-18T09:00:00.000Z",
    updated_at: "2026-06-18T09:00:00.000Z",
    ...overrides
  };
}

function createEnv(db: ReturnType<typeof createDb>): Env {
  return {
    DB: db as unknown as D1Database,
    EMAIL: { send: vi.fn(async () => undefined) },
    ADMIN_PASSWORD: "secret",
    REMINDER_EMAIL: "admin@example.com",
    FROM_EMAIL: "reminders@example.com"
  };
}

function createDb(rows: ReminderRow[]) {
  return {
    rows,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          first: async <T>() => {
            if (sql.includes("SELECT * FROM reminders WHERE id = ?")) {
              return rows.find((item) => item.id === args[0]) as T | null ?? null;
            }
            return null;
          },
          all: async <T>() => {
            if (sql.includes("last_sent_at IS NULL")) {
              const lookahead = String(args[0]);
              const lastAllowedSentAt = String(args[1]);
              return {
                results: rows.filter((item) =>
                  item.status === "active" &&
                  item.next_run_at <= lookahead &&
                  (item.last_sent_at === null || item.last_sent_at <= lastAllowedSentAt)
                ) as T[]
              };
            }
            return { results: rows as T[] };
          },
          run: async () => {
            if (sql.includes("UPDATE reminders") && sql.includes("last_completed_at")) {
              const id = String(args[5]);
              const target = rows.find((item) => item.id === id && item.status === "active");
              if (target) {
                target.repeat_remaining = args[0] as number | null;
                target.next_run_at = String(args[1]);
                target.last_sent_for = null;
                target.last_completed_at = String(args[2]);
                target.status = args[3] as ReminderRow["status"];
                target.updated_at = String(args[4]);
              }
              return { meta: { changes: target ? 1 : 0 } };
            }
            if (sql.includes("last_sent_at") && sql.includes("last_sent_for = next_run_at")) {
              const id = String(args[2]);
              const nextRunAt = String(args[3]);
              const target = rows.find((item) => item.id === id && item.next_run_at === nextRunAt);
              if (target) {
                target.last_sent_at = String(args[0]);
                target.last_sent_for = target.next_run_at;
                target.updated_at = String(args[1]);
              }
              return { meta: { changes: target ? 1 : 0 } };
            }
            return { meta: { changes: 0 } };
          }
        })
      };
    }
  };
}
