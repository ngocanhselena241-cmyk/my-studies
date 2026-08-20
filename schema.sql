-- Study Tracker — cấu trúc database D1
-- Chạy file này một lần duy nhất, trước khi dùng web.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  username   TEXT NOT NULL UNIQUE,
  salt       TEXT NOT NULL,
  hash       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS user_data (
  user_id    TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Ảnh đính kèm trong ghi chú. Để riêng khỏi user_data vì JSON học kỳ có giới hạn 2MB.
CREATE TABLE IF NOT EXISTS images (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  data       BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_images_user ON images(user_id);
