import type { IntervalUnit } from "./types";

const MS_BY_UNIT: Record<"minute" | "hour" | "day", number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000
};

export function addInterval(baseIso: string, value: number, unit: IntervalUnit): string {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("interval value must be a positive integer");
  }

  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) {
    throw new Error("base date is invalid");
  }

  if (unit === "minute" || unit === "hour" || unit === "day") {
    return new Date(base.getTime() + MS_BY_UNIT[unit] * value).toISOString();
  }

  const year = base.getUTCFullYear();
  const month = base.getUTCMonth();
  const targetMonth = unit === "month" ? month + value : month;
  const targetYear = unit === "year" ? year + value : year;

  const normalized = normalizeYearMonth(targetYear, targetMonth);
  const lastDay = daysInUtcMonth(normalized.year, normalized.month);
  const day = Math.min(base.getUTCDate(), lastDay);

  return new Date(Date.UTC(
    normalized.year,
    normalized.month,
    day,
    base.getUTCHours(),
    base.getUTCMinutes(),
    base.getUTCSeconds(),
    base.getUTCMilliseconds()
  )).toISOString();
}

function normalizeYearMonth(year: number, month: number): { year: number; month: number } {
  const normalizedYear = year + Math.floor(month / 12);
  const normalizedMonth = ((month % 12) + 12) % 12;
  return { year: normalizedYear, month: normalizedMonth };
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}
