# -*- coding: utf-8 -*-
"""
db.py — لایه پایگاه داده آنتانو (SQLite)
جدول‌ها: کاربران، کدهای ثبت‌نام، نشست‌ها، گفتگوها، پیام‌ها، حافظه بلندمدت
"""
import sqlite3
import os
import secrets
import hashlib

DB_PATH = os.environ.get("ANTANU_DB", "antanu.db")


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ---------- رمزنگاری گذرواژه (PBKDF2 - بدون نیاز به کتابخانه اضافی) ----------

def hash_pw(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${h}"


def verify_pw(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$")
    except ValueError:
        return False
    calc = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return secrets.compare_digest(calc, h)


# ---------- ساختار جدول‌ها ----------

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    stars       INTEGER NOT NULL DEFAULT 1,     -- سطح اشتراک: ۱ تا ۴ ستاره
    is_admin    INTEGER NOT NULL DEFAULT 0,
    device_fp   TEXT,                            -- اثر انگشت دستگاه (قفل یک‌دستگاهی)
    code_used   TEXT,                            -- کدی که با آن ثبت‌نام کرده
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,            -- کد ۵۰ رقمی حروف و عدد
    stars       INTEGER NOT NULL,                -- سطح اشتراکی که این کد می‌دهد
    used        INTEGER NOT NULL DEFAULT 0,
    used_by     TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,               -- user | assistant
    content         TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename    TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL
);
"""


def init_db():
    """ساخت جدول‌ها و کاربر ادمین پیش‌فرض (اگر وجود نداشته باشد)"""
    conn = get_db()
    conn.executescript(SCHEMA)

    admin_user = os.environ.get("ANTANU_ADMIN_USER", "admin")
    admin_pass = os.environ.get("ANTANU_ADMIN_PASS", "Antanu@1234")

    row = conn.execute("SELECT id FROM users WHERE username = ?", (admin_user,)).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO users (username, password, stars, is_admin) VALUES (?, ?, 4, 1)",
            (admin_user, hash_pw(admin_pass)),
        )
        print(f"[ANTANU] کاربر ادمین ساخته شد → نام کاربری: {admin_user}")

    conn.commit()
    conn.close()


# ---------- تولید کد ثبت‌نام ۵۰ رقمی ----------

CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"


def generate_code() -> str:
    return "".join(secrets.choice(CODE_CHARS) for _ in range(50))
