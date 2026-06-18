import { clearSessionCookie, createSessionCookie, isAuthenticated } from "./auth";
import {
  completeReminder,
  createReminder,
  deleteReminder,
  listReminders,
  processDueReminders,
  validateReminderInput,
  ValidationError
} from "./reminders";
import { renderApp } from "./ui";
import type { Env } from "./types";

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      console.error(error);
      return json({ error: "服务器内部错误" }, 500);
    }
  },

  async scheduled(event, env, ctx): Promise<void> {
    const scheduledTime = event.scheduledTime ? new Date(event.scheduledTime) : new Date();
    ctx.waitUntil(processDueReminders(env, scheduledTime));
  }
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (!env.ADMIN_PASSWORD) {
    return json({ error: "缺少 ADMIN_PASSWORD 环境变量" }, 500);
  }

  if (pathname === "/" && request.method === "GET") {
    return renderApp();
  }

  if (pathname === "/api/session" && request.method === "GET") {
    return json({ authenticated: await isAuthenticated(request, env.ADMIN_PASSWORD) });
  }

  if (pathname === "/api/login" && request.method === "POST") {
    const body = await readJson(request);
    const password = typeof body.password === "string" ? body.password : "";
    if (password !== env.ADMIN_PASSWORD) {
      return json({ error: "密码错误" }, 401);
    }

    return json({ ok: true }, 200, {
      "Set-Cookie": await createSessionCookie(env.ADMIN_PASSWORD, request.url)
    });
  }

  if (pathname === "/api/logout" && request.method === "POST") {
    return json({ ok: true }, 200, {
      "Set-Cookie": clearSessionCookie()
    });
  }

  if (!pathname.startsWith("/api/")) {
    return renderApp();
  }

  if (!await isAuthenticated(request, env.ADMIN_PASSWORD)) {
    return json({ error: "未登录或登录已过期" }, 401);
  }

  if (pathname === "/api/reminders" && request.method === "GET") {
    return json({ reminders: await listReminders(env) });
  }

  if (pathname === "/api/reminders" && request.method === "POST") {
    try {
      const input = validateReminderInput(await readJson(request));
      return json({ reminder: await createReminder(env, input) }, 201);
    } catch (error) {
      if (error instanceof ValidationError) {
        return json({ error: error.message }, 400);
      }
      throw error;
    }
  }

  const reminderRoute = pathname.match(/^\/api\/reminders\/([^/]+)(?:\/(complete))?$/);
  if (reminderRoute) {
    const id = decodeURIComponent(reminderRoute[1]);
    const action = reminderRoute[2];

    if (!action && request.method === "DELETE") {
      const deleted = await deleteReminder(env, id);
      return deleted ? json({ ok: true }) : json({ error: "提醒不存在" }, 404);
    }

    if (action === "complete" && request.method === "POST") {
      const reminder = await completeReminder(env, id);
      return reminder ? json({ reminder }) : json({ error: "提醒不存在" }, 404);
    }
  }

  return json({ error: "接口不存在" }, 404);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function json(payload: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers
    }
  });
}
