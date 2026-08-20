/* ============================================================================
   API của Study Tracker — chạy trên Cloudflare Pages Functions.
   Mọi đường dẫn bắt đầu bằng /api/ đều đi vào file này.

     POST /api/register   tạo tài khoản
     POST /api/login      đăng nhập
     POST /api/logout     đăng xuất
     GET  /api/me         đang đăng nhập bằng tài khoản nào
     GET  /api/data       lấy toàn bộ dữ liệu học kỳ
     PUT  /api/data       ghi đè toàn bộ dữ liệu học kỳ

   Cần một D1 database gắn với tên biến DB.
   ========================================================================== */

const SESSION_DAYS   = 30;
const COOKIE         = "st_session";
const PBKDF2_ROUNDS  = 30000;   // đủ mạnh mà vẫn nằm dưới giới hạn 10ms CPU của gói miễn phí
const MAX_DATA_BYTES = 2_000_000;

/* ---------- tiện ích ------------------------------------------------------ */
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}
const bad = (msg, status = 400) => json({ error: msg }, status);

function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function unhex(str) {
  const out = new Uint8Array(str.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(str.substr(i * 2, 2), 16);
  return out;
}
function randomHex(bytes = 32) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function hashPassword(password, saltHex) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: unhex(saltHex), iterations: PBKDF2_ROUNDS, hash: "SHA-256" },
    key, 256
  );
  return hex(bits);
}

/* so sánh không phụ thuộc thời gian, tránh lộ thông tin qua độ trễ */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function currentUser(env, request) {
  const token = readCookie(request, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.username, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
    return null;
  }
  return { id: row.id, username: row.username };
}

async function startSession(env, userId) {
  const token = randomHex(32);
  const expires = Date.now() + SESSION_DAYS * 86400000;
  await env.DB.prepare(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`
  ).bind(token, userId, expires).run();
  await env.DB.prepare(
    `DELETE FROM sessions WHERE user_id = ? AND expires_at < ?`
  ).bind(userId, Date.now()).run();
  return token;
}

/* ---------- xử lý request ------------------------------------------------- */
export async function onRequest(context) {
  const { request, env, params } = context;

  if (!env.DB) {
    return bad("Chưa gắn database. Vào Cloudflare → project → Settings → Bindings, thêm D1 với tên biến DB rồi deploy lại.", 500);
  }

  const route = "/" + (Array.isArray(params.path) ? params.path.join("/") : params.path || "");
  const method = request.method.toUpperCase();

  try {
    if (route === "/register" && method === "POST") return await register(request, env);
    if (route === "/login"    && method === "POST") return await login(request, env);
    if (route === "/logout"   && method === "POST") return await logout(request, env);
    if (route === "/me"       && method === "GET")  return await me(request, env);
    if (route === "/data"     && method === "GET")  return await getData(request, env);
    if (route === "/data"     && method === "PUT")  return await putData(request, env);
    return bad("Không có đường dẫn này", 404);
  } catch (err) {
    return bad("Lỗi server: " + (err && err.message ? err.message : String(err)), 500);
  }
}

/* ---------- tài khoản ----------------------------------------------------- */
async function readBody(request) {
  try { return await request.json(); } catch { return {}; }
}

async function register(request, env) {
  const { username, password } = await readBody(request);
  const name = String(username || "").trim().toLowerCase();

  if (!/^[a-z0-9_.]{3,24}$/.test(name)) {
    return bad("Tên đăng nhập chỉ gồm chữ thường, số, dấu _ hoặc . và dài 3–24 ký tự.");
  }
  if (typeof password !== "string" || password.length < 8) {
    return bad("Mật khẩu cần ít nhất 8 ký tự.");
  }
  if (password.length > 200) return bad("Mật khẩu quá dài.");

  const taken = await env.DB.prepare(`SELECT id FROM users WHERE username = ?`).bind(name).first();
  if (taken) return bad("Tên đăng nhập này đã có người dùng.", 409);

  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt);

  await env.DB.prepare(
    `INSERT INTO users (id, username, salt, hash, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, name, salt, hash, Date.now()).run();

  await env.DB.prepare(
    `INSERT INTO user_data (user_id, json, updated_at) VALUES (?, ?, ?)`
  ).bind(id, "null", Date.now()).run();

  const token = await startSession(env, id);
  return json({ user: { username: name } }, 201, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
}

async function login(request, env) {
  const { username, password } = await readBody(request);
  const name = String(username || "").trim().toLowerCase();
  if (!name || typeof password !== "string") return bad("Thiếu tên đăng nhập hoặc mật khẩu.");

  const user = await env.DB.prepare(
    `SELECT id, username, salt, hash FROM users WHERE username = ?`
  ).bind(name).first();

  /* vẫn băm một lần dù không có user, để thời gian phản hồi không tiết lộ tên nào tồn tại */
  const salt = user ? user.salt : "00000000000000000000000000000000";
  const attempt = await hashPassword(password, salt);
  if (!user || !safeEqual(attempt, user.hash)) return bad("Sai tên đăng nhập hoặc mật khẩu.", 401);

  const token = await startSession(env, user.id);
  return json({ user: { username: user.username } }, 200, {
    "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400),
  });
}

async function logout(request, env) {
  const token = readCookie(request, COOKIE);
  if (token) await env.DB.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
}

async function me(request, env) {
  const user = await currentUser(env, request);
  if (!user) return bad("Chưa đăng nhập.", 401);
  return json({ user: { username: user.username } });
}

/* ---------- dữ liệu học kỳ ------------------------------------------------ */
async function getData(request, env) {
  const user = await currentUser(env, request);
  if (!user) return bad("Chưa đăng nhập.", 401);

  const row = await env.DB.prepare(
    `SELECT json, updated_at FROM user_data WHERE user_id = ?`
  ).bind(user.id).first();

  let state = null;
  if (row && row.json) { try { state = JSON.parse(row.json); } catch { state = null; } }
  return json({ state, updated_at: row ? row.updated_at : null });
}

async function putData(request, env) {
  const user = await currentUser(env, request);
  if (!user) return bad("Chưa đăng nhập.", 401);

  const body = await readBody(request);
  if (!body || typeof body.state !== "object" || body.state === null) {
    return bad("Dữ liệu gửi lên không hợp lệ.");
  }
  const str = JSON.stringify(body.state);
  if (str.length > MAX_DATA_BYTES) return bad("Dữ liệu quá lớn.", 413);

  await env.DB.prepare(
    `INSERT INTO user_data (user_id, json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).bind(user.id, str, Date.now()).run();

  return json({ ok: true, updated_at: Date.now() });
}
