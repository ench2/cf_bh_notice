export function renderApp(): Response {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>实时提醒管理</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --ink: #1d2433;
      --muted: #657084;
      --line: #dce2ea;
      --accent: #156f5b;
      --accent-hover: #0f5a49;
      --danger: #b42318;
      --danger-bg: #fff1f0;
      --ok-bg: #eaf7ef;
      --warn-bg: #fff8e5;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--ink);
      background: var(--bg);
    }

    button, input, textarea, select {
      font: inherit;
    }

    button {
      border: 0;
      border-radius: 6px;
      min-height: 38px;
      padding: 0 14px;
      color: #fff;
      background: var(--accent);
      cursor: pointer;
    }

    button:hover { background: var(--accent-hover); }
    button.secondary {
      color: var(--ink);
      background: #e9edf3;
    }
    button.secondary:hover { background: #dce3ec; }
    button.danger {
      background: var(--danger);
    }
    button.danger:hover {
      background: #8f1d14;
    }
    button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }

    .shell {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 28px 0 44px;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }

    h1 {
      margin: 0;
      font-size: 26px;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .muted {
      margin: 6px 0 0;
      color: var(--muted);
      font-size: 14px;
    }

    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 18px;
    }

    .login-wrap {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .login-panel {
      width: min(380px, 100%);
    }

    .grid {
      display: grid;
      grid-template-columns: 360px minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }

    .left-stack {
      display: grid;
      gap: 18px;
    }

    .form-grid {
      display: grid;
      gap: 12px;
    }

    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
    }

    input, textarea, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px 11px;
      color: var(--ink);
      background: #fff;
    }

    textarea {
      min-height: 78px;
      resize: vertical;
    }

    .inline-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .message {
      margin-top: 12px;
      min-height: 20px;
      color: var(--danger);
      font-size: 14px;
    }

    .list {
      display: grid;
      gap: 12px;
    }

    .item {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      background: #fff;
    }

    .item-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 10px;
    }

    .item-title {
      margin: 0;
      font-size: 17px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }

    .desc {
      margin: 6px 0 0;
      color: var(--muted);
      line-height: 1.5;
      overflow-wrap: anywhere;
      white-space: pre-wrap;
    }

    .badge {
      flex: 0 0 auto;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--ink);
      background: var(--warn-bg);
    }

    .badge.completed { background: var(--ok-bg); }

    .meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      margin: 12px 0;
    }

    .meta div {
      min-width: 0;
      border-radius: 6px;
      background: #f5f7fa;
      padding: 10px;
      color: var(--muted);
      font-size: 12px;
    }

    .meta strong {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: 14px;
      font-weight: 600;
      overflow-wrap: anywhere;
    }

    .empty {
      color: var(--muted);
      padding: 24px;
      text-align: center;
    }

    @media (max-width: 860px) {
      .grid { grid-template-columns: 1fr; }
      .topbar { align-items: flex-start; }
      .meta { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main id="app"></main>

  <script>
    const app = document.getElementById("app");
    let refreshTimer = null;
    let editingReminderId = null;
    let remindersById = new Map();

    start();

    async function start() {
      const session = await api("/api/session", { quiet: true });
      if (session.authenticated) {
        renderDashboard();
        await loadReminders();
        refreshTimer = setInterval(loadReminders, 15000);
      } else {
        renderLogin();
      }
    }

    function renderLogin(message = "") {
      clearInterval(refreshTimer);
      editingReminderId = null;
      app.innerHTML = \`
        <section class="login-wrap">
          <form class="panel login-panel" id="login-form">
            <h1>提醒管理</h1>
            <p class="muted">请输入管理员密码。</p>
            <div class="form-grid" style="margin-top:18px">
              <label>管理密码
                <input name="password" type="password" autocomplete="current-password" required autofocus>
              </label>
              <button type="submit">登录</button>
              <div class="message" id="login-message">\${escapeHtml(message)}</div>
            </div>
          </form>
        </section>
      \`;
      window.__noticeReminderForm = null;

      document.getElementById("login-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
          await api("/api/login", {
            method: "POST",
            body: JSON.stringify({ password: form.get("password") })
          });
          renderDashboard();
          await loadReminders();
          refreshTimer = setInterval(loadReminders, 15000);
        } catch (error) {
          document.getElementById("login-message").textContent = error.message;
        }
      });
    }

    function renderDashboard() {
      editingReminderId = null;
      remindersById = new Map();
      app.innerHTML = \`
        <section class="shell">
          <div class="topbar">
            <div>
              <h1>实时提醒</h1>
              <p class="muted">列表每 15 秒自动刷新，邮件由 Workers Cron 每分钟扫描发送。</p>
            </div>
            <button class="secondary" id="logout-button">退出</button>
          </div>

          <div class="grid">
            <div class="left-stack">
            <form class="panel form-grid" id="reminder-form">
              <h2 id="reminder-form-title" style="margin:0;font-size:18px">新增提醒</h2>
              <label>标题
                <input name="title" maxlength="120" required>
              </label>
              <label>备注
                <textarea name="description" maxlength="1000"></textarea>
              </label>
              <label>首次提醒时间
                <input name="firstRunAt" type="datetime-local" required>
              </label>
              <label>提前提醒天数
                <input name="advanceNoticeDays" type="number" min="0" step="1" value="3" required>
              </label>
              <div class="inline-grid">
                <label>间隔数值
                  <input name="intervalValue" type="number" min="1" step="1" value="1" required>
                </label>
                <label>单位
                  <select name="intervalUnit">
                    <option value="minute">分钟</option>
                    <option value="hour">小时</option>
                    <option value="day">日</option>
                    <option value="month">月</option>
                    <option value="year">年</option>
                  </select>
                </label>
              </div>
              <div class="inline-grid">
                <label>重复模式
                  <select name="repeatMode" id="repeat-mode">
                    <option value="finite">固定次数</option>
                    <option value="forever">永久</option>
                  </select>
                </label>
                <label>重复次数
                  <input name="repeatCount" id="repeat-count" type="number" min="1" step="1" value="1">
                </label>
              </div>
              <div class="inline-grid">
                <label>发送开始
                  <input name="sendWindowStart" type="time" value="00:00" required>
                </label>
                <label>发送结束
                  <input name="sendWindowEnd" type="time" value="23:59" required>
                </label>
              </div>
              <label>重复发信间隔（分钟）
                <input name="minEmailIntervalMinutes" type="number" min="1" step="1" value="5" required>
              </label>
              <div class="actions">
                <button type="submit" id="reminder-submit-button">添加提醒</button>
                <button type="button" class="secondary" id="cancel-edit-button" hidden>取消编辑</button>
              </div>
              <div class="message" id="form-message"></div>
            </form>

            <section class="panel form-grid" id="date-calculator-panel">
              <h2 style="margin:0;font-size:18px">日期计算器</h2>
              <label>开始日期
                <input id="calc-start-date" type="date" required>
              </label>
              <label>天数
                <input id="calc-days" type="number" min="0" step="1" value="180" required>
              </label>
              <div class="meta" style="grid-template-columns:1fr;margin:0">
                <div>结果日期<strong id="calc-result">-</strong></div>
              </div>
            </section>
            </div>

            <section class="panel">
              <div class="actions" style="justify-content:space-between;margin-bottom:14px">
                <h2 style="margin:0;font-size:18px">提醒列表</h2>
                <button class="secondary" id="refresh-button">刷新</button>
              </div>
              <div class="list" id="reminder-list">
                <div class="empty">加载中...</div>
              </div>
            </section>
          </div>
        </section>
      \`;

      const reminderForm = document.getElementById("reminder-form");
      const firstRun = document.querySelector("[name=firstRunAt]");
      setupDateCalculator();
      resetReminderForm();

      document.getElementById("logout-button").addEventListener("click", async () => {
        await api("/api/logout", { method: "POST" });
        renderLogin();
      });
      document.getElementById("refresh-button").addEventListener("click", loadReminders);

      const repeatMode = document.getElementById("repeat-mode");
      const repeatCount = document.getElementById("repeat-count");
      repeatMode.addEventListener("change", () => {
        repeatCount.disabled = repeatMode.value === "forever";
      });
      document.getElementById("cancel-edit-button").addEventListener("click", () => {
        resetReminderForm();
      });

      document.getElementById("reminder-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const message = document.getElementById("form-message");
        message.textContent = "";
        const isEditing = Boolean(editingReminderId);

        try {
          await api(isEditing ? \`/api/reminders/\${editingReminderId}\` : "/api/reminders", {
            method: isEditing ? "PUT" : "POST",
            body: JSON.stringify({
              title: data.get("title"),
              description: data.get("description"),
              firstRunAt: new Date(data.get("firstRunAt")).toISOString(),
              intervalValue: Number(data.get("intervalValue")),
              intervalUnit: data.get("intervalUnit"),
              repeatMode: data.get("repeatMode"),
              repeatCount: data.get("repeatMode") === "finite" ? Number(data.get("repeatCount")) : undefined,
              advanceNoticeDays: Number(data.get("advanceNoticeDays")),
              sendWindowStart: data.get("sendWindowStart"),
              sendWindowEnd: data.get("sendWindowEnd"),
              minEmailIntervalMinutes: Number(data.get("minEmailIntervalMinutes"))
            })
          });
          resetReminderForm();
          await loadReminders();
        } catch (error) {
          message.textContent = error.message;
        }
      });

      function resetReminderForm() {
        editingReminderId = null;
        reminderForm.reset();
        document.getElementById("reminder-form-title").textContent = "新增提醒";
        document.getElementById("reminder-submit-button").textContent = "添加提醒";
        document.getElementById("cancel-edit-button").hidden = true;
        document.getElementById("form-message").textContent = "";
        document.querySelector("[name=intervalValue]").value = "1";
        document.querySelector("[name=repeatMode]").value = "finite";
        repeatCount.disabled = false;
        repeatCount.value = "1";
        firstRun.value = toDatetimeLocal(new Date(Date.now() + 60_000));
        document.querySelector("[name=advanceNoticeDays]").value = "3";
        document.querySelector("[name=sendWindowStart]").value = "00:00";
        document.querySelector("[name=sendWindowEnd]").value = "23:59";
        document.querySelector("[name=minEmailIntervalMinutes]").value = "5";
      }

      window.__noticeReminderForm = {
        reset: resetReminderForm
      };
    }

    async function loadReminders() {
      try {
        const { reminders } = await api("/api/reminders", { quiet: true });
        remindersById = new Map(reminders.map((item) => [item.id, item]));
        if (editingReminderId && !remindersById.has(editingReminderId)) {
          window.__noticeReminderForm?.reset?.();
        }
        renderReminders(reminders);
      } catch (error) {
        if (error.status === 401) {
          renderLogin("登录已过期，请重新登录。");
          return;
        }
        document.getElementById("reminder-list").innerHTML = \`<div class="empty">\${escapeHtml(error.message)}</div>\`;
      }
    }

    function renderReminders(reminders) {
      const list = document.getElementById("reminder-list");
      if (!reminders.length) {
        list.innerHTML = '<div class="empty">暂无提醒。</div>';
        return;
      }

      list.innerHTML = reminders.map((item) => \`
        <article class="item">
          <div class="item-head">
            <div>
              <h3 class="item-title">\${escapeHtml(item.title)}</h3>
              \${item.description ? \`<p class="desc">\${escapeHtml(item.description)}</p>\` : ""}
            </div>
            <span class="badge \${item.status === "completed" ? "completed" : ""}">\${statusLabel(item.status)}</span>
          </div>
          <div class="meta">
            <div>下次提醒<strong>\${formatDate(item.next_run_at)}</strong></div>
            <div>间隔周期<strong>每 \${item.interval_value} \${unitLabel(item.interval_unit)}</strong></div>
            <div>剩余次数<strong>\${item.repeat_mode === "forever" ? "永久重复" : item.repeat_remaining}</strong></div>
            <div>提前提醒<strong>\${escapeHtml(String(item.advance_notice_days ?? 3))} 天</strong></div>
            <div>发送时间段<strong>\${escapeHtml(formatSendWindow(item))}</strong></div>
            <div>重复发信间隔<strong>\${escapeHtml(String(item.min_email_interval_minutes || 5))} 分钟</strong></div>
          </div>
          <div class="actions">
            <button class="secondary" data-action="edit" data-id="\${item.id}">编辑</button>
            <button data-action="complete" data-id="\${item.id}" \${item.status !== "active" ? "disabled" : ""}>本次完成</button>
            <button class="danger" data-action="delete" data-id="\${item.id}">删除</button>
          </div>
        </article>
      \`).join("");

      list.querySelectorAll("button[data-action]").forEach((button) => {
        button.addEventListener("click", async () => {
          const action = button.dataset.action;
          const id = button.dataset.id;
          button.disabled = true;
          try {
            if (action === "edit") {
              beginEditReminder(remindersById.get(id));
              button.disabled = false;
              return;
            }
            if (action === "complete") {
              await api(\`/api/reminders/\${id}/complete\`, { method: "POST" });
            } else {
              await api(\`/api/reminders/\${id}\`, { method: "DELETE" });
            }
            await loadReminders();
          } catch (error) {
            alert(error.message);
            button.disabled = false;
          }
        });
      });
    }

    function beginEditReminder(item) {
      if (!item) return;

      editingReminderId = item.id;
      document.getElementById("reminder-form-title").textContent = "编辑提醒";
      document.getElementById("reminder-submit-button").textContent = "保存修改";
      document.getElementById("cancel-edit-button").hidden = false;
      document.getElementById("form-message").textContent = "";
      document.querySelector("[name=title]").value = item.title || "";
      document.querySelector("[name=description]").value = item.description || "";
      document.querySelector("[name=firstRunAt]").value = toDatetimeLocal(new Date(item.next_run_at));
      document.querySelector("[name=advanceNoticeDays]").value = String(item.advance_notice_days ?? 3);
      document.querySelector("[name=intervalValue]").value = String(item.interval_value ?? 1);
      document.querySelector("[name=intervalUnit]").value = item.interval_unit || "day";
      document.querySelector("[name=repeatMode]").value = item.repeat_mode || "finite";
      document.querySelector("[name=repeatCount]").value = item.repeat_mode === "finite"
        ? String(Math.max(Number(item.repeat_remaining ?? 1), 1))
        : "1";
      document.querySelector("[name=repeatCount]").disabled = item.repeat_mode === "forever";
      document.querySelector("[name=sendWindowStart]").value = item.send_window_start || "00:00";
      document.querySelector("[name=sendWindowEnd]").value = item.send_window_end || "23:59";
      document.querySelector("[name=minEmailIntervalMinutes]").value = String(item.min_email_interval_minutes || 5);
      document.getElementById("reminder-form").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(payload.error || "请求失败");
        error.status = response.status;
        throw error;
      }
      return payload;
    }

    function toDatetimeLocal(date) {
      const offset = date.getTimezoneOffset();
      return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
    }

    function setupDateCalculator() {
      const startInput = document.getElementById("calc-start-date");
      const daysInput = document.getElementById("calc-days");
      const result = document.getElementById("calc-result");

      startInput.value = toDateInputValue(new Date());
      const update = () => {
        const startDate = parseLocalDate(startInput.value);
        const days = Number(daysInput.value);
        if (!startDate || !Number.isInteger(days) || days < 0) {
          result.textContent = "-";
          return;
        }

        startDate.setDate(startDate.getDate() + days);
        result.textContent = formatLocalDate(startDate);
      };

      startInput.addEventListener("input", update);
      daysInput.addEventListener("input", update);
      update();
    }

    function toDateInputValue(date) {
      return formatLocalDate(date);
    }

    function parseLocalDate(value) {
      const match = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(value);
      if (!match) return null;

      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const date = new Date(year, month - 1, day);
      if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
      }
      return date;
    }

    function formatLocalDate(date) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return \`\${year}-\${month}-\${day}\`;
    }

    function formatDate(value) {
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    }

    function statusLabel(status) {
      return status === "active" ? "进行中" : status === "completed" ? "已完成" : "已删除";
    }

    function formatSendWindow(item) {
      return \`\${item.send_window_start || "00:00"} - \${item.send_window_end || "23:59"}\`;
    }

    function unitLabel(unit) {
      return ({ minute: "分钟", hour: "小时", day: "日", month: "月", year: "年" })[unit] || unit;
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }
  </script>
</body>
</html>`;
