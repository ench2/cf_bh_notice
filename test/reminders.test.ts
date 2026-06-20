import { afterEach, describe, expect, it, vi } from "vitest";
import { completeReminder, processDueReminders, updateReminder, validateReminderInput } from "../src/reminders";
import type { Env, ReminderRow } from "../src/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateReminderInput", () => {
  it("accepts valid finite reminders", () => {
    expect(validateReminderInput({
      title: "Drink water",
      intervalValue: 1,
      intervalUnit: "minute",
      repeatMode: "finite",
      repeatCount: 2,
      firstRunAt: "2026-06-18T10:00:00.000Z",
      advanceNoticeDays: 4,
      sendWindowStart: "08:00",
      sendWindowEnd: "22:00",
      minEmailIntervalMinutes: 10
    })).toMatchObject({
      title: "Drink water",
      intervalValue: 1,
      intervalUnit: "minute",
      repeatMode: "finite",
      repeatCount: 2,
      advanceNoticeDays: 4,
      sendWindowStart: "08:00",
      sendWindowEnd: "22:00",
      minEmailIntervalMinutes: 10
    });
  });

  it("rejects second units", () => {
    expect(() => validateReminderInput({
      title: "Drink water",
      intervalValue: 1,
      intervalUnit: "second",
      repeatMode: "forever",
      firstRunAt: "2026-06-18T10:00:00.000Z"
    })).toThrow("Invalid reminder unit");
  });

  it("rejects invalid advance notice days", () => {
    expect(() => validateReminderInput({
      title: "Drink water",
      intervalValue: 1,
      intervalUnit: "minute",
      repeatMode: "forever",
      firstRunAt: "2026-06-18T10:00:00.000Z",
      advanceNoticeDays: -1
    })).toThrow("Advance notice days must be a non-negative integer");
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

  it("updates an existing reminder and reactivates it with the new schedule", async () => {
    const db = createDb([row({
      status: "completed",
      repeat_remaining: 0,
      last_sent_at: "2026-06-18T09:00:00.000Z",
      last_sent_for: "2026-06-18T10:00:00.000Z",
      last_completed_at: "2026-06-18T10:15:00.000Z"
    })]);
    const env = createEnv(db);

    const updated = await updateReminder(env, "r1", {
      title: "Updated reminder",
      description: "Updated description",
      intervalValue: 3,
      intervalUnit: "day",
      repeatMode: "finite",
      repeatCount: 4,
      firstRunAt: "2026-06-25T08:00:00.000Z",
      advanceNoticeDays: 2,
      sendWindowStart: "09:00",
      sendWindowEnd: "18:00",
      minEmailIntervalMinutes: 30
    }, new Date("2026-06-20T00:00:00.000Z"));

    expect(updated).toMatchObject({
      title: "Updated reminder",
      description: "Updated description",
      interval_value: 3,
      interval_unit: "day",
      repeat_mode: "finite",
      repeat_remaining: 4,
      next_run_at: "2026-06-25T08:00:00.000Z",
      advance_notice_days: 2,
      send_window_start: "09:00",
      send_window_end: "18:00",
      min_email_interval_minutes: 30,
      status: "active",
      last_sent_at: null,
      last_sent_for: null,
      last_completed_at: null,
      updated_at: "2026-06-20T00:00:00.000Z"
    });
  });

  it("sends reminders up to three days early and respects per-reminder throttling", async () => {
    const inWindow = row({ next_run_at: "2026-06-20T00:05:00.000Z", last_sent_at: null });
    const throttled = row({
      id: "r2",
      next_run_at: "2026-06-20T00:05:00.000Z",
      last_sent_at: "2026-06-18T00:03:00.000Z",
      min_email_interval_minutes: 5
    });
    const outsideLookahead = row({ id: "r3", next_run_at: "2026-06-21T00:06:00.000Z", last_sent_at: null });
    const db = createDb([inWindow, throttled, outsideLookahead]);
    const env = createEnv(db);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const count = await processDueReminders(env, new Date("2026-06-18T00:05:00.000Z"));

    expect(count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer test-resend-key"
      })
    }));
    expect(db.rows[0].last_sent_for).toBe("2026-06-20T00:05:00.000Z");
    expect(db.rows[0].last_sent_at).toBe("2026-06-18T00:05:00.000Z");
  });

  it("uses each reminder advance notice days before sending", async () => {
    const notYet = row({
      next_run_at: "2026-06-18T00:06:00.000Z",
      advance_notice_days: 0,
      last_sent_at: null
    });
    const dueNow = row({
      id: "r2",
      next_run_at: "2026-06-18T00:05:00.000Z",
      advance_notice_days: 0,
      last_sent_at: null
    });
    const db = createDb([notYet, dueNow]);
    const env = createEnv(db);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const count = await processDueReminders(env, new Date("2026-06-18T00:05:00.000Z"));

    expect(count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.rows[0].last_sent_at).toBeNull();
    expect(db.rows[1].last_sent_for).toBe("2026-06-18T00:05:00.000Z");
  });

  it("does not send reminder emails outside each reminder send window", async () => {
    const db = createDb([row({
      next_run_at: "2026-06-18T10:00:00.000Z",
      last_sent_at: null,
      send_window_start: "08:00",
      send_window_end: "22:00"
    })]);
    const env = createEnv(db);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const count = await processDueReminders(env, new Date("2026-06-17T23:59:00.000Z"));

    expect(count).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports send windows that cross midnight", async () => {
    const db = createDb([row({
      next_run_at: "2026-06-18T10:00:00.000Z",
      send_window_start: "22:00",
      send_window_end: "02:00"
    })]);
    const env = createEnv(db);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const count = await processDueReminders(env, new Date("2026-06-17T15:30:00.000Z"));

    expect(count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function row(overrides: Partial<ReminderRow> = {}): ReminderRow {
  return {
    id: "r1",
    title: "Test reminder",
    description: "",
    interval_value: 1,
    interval_unit: "minute",
    repeat_mode: "finite",
    repeat_remaining: 2,
    next_run_at: "2026-06-18T10:00:00.000Z",
    advance_notice_days: 3,
    send_window_start: "00:00",
    send_window_end: "23:59",
    min_email_interval_minutes: 60,
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
    ADMIN_PASSWORD: "secret",
    RESEND_API_KEY: "test-resend-key",
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
            if (sql.includes("WHERE status = 'active'")) {
              const now = new Date(String(args[0])).getTime();
              return {
                results: rows.filter((item) => {
                  const nextRunAt = new Date(item.next_run_at).getTime();
                  return item.status === "active" &&
                    !Number.isNaN(nextRunAt) &&
                    nextRunAt <= now + item.advance_notice_days * 24 * 60 * 60 * 1000;
                }) as T[]
              };
            }
            return { results: rows as T[] };
          },
          run: async () => {
            if (sql.includes("SET title = ?")) {
              const id = String(args[12]);
              const target = rows.find((item) => item.id === id && item.status !== "deleted");
              if (target) {
                target.title = String(args[0]);
                target.description = String(args[1]);
                target.interval_value = Number(args[2]);
                target.interval_unit = args[3] as ReminderRow["interval_unit"];
                target.repeat_mode = args[4] as ReminderRow["repeat_mode"];
                target.repeat_remaining = args[5] as number | null;
                target.next_run_at = String(args[6]);
                target.advance_notice_days = Number(args[7]);
                target.send_window_start = String(args[8]);
                target.send_window_end = String(args[9]);
                target.min_email_interval_minutes = Number(args[10]);
                target.last_sent_at = null;
                target.last_sent_for = null;
                target.last_completed_at = null;
                target.status = "active";
                target.updated_at = String(args[11]);
              }
              return { meta: { changes: target ? 1 : 0 } };
            }
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
