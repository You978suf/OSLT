import os
import pymysql
import json
from pathlib import Path
from flask import request, jsonify
from functools import wraps

CONFIG_PATH = Path(__file__).parent / "config.json"
_DEFAULTS = {
    "MYSQL_HOST": "localhost",
    "MYSQL_USER": "root",
    "MYSQL_PASSWORD": "",
    "MYSQL_DATABASE": "jissr_db",
    "MYSQL_SSL_CA": "",
    "GOOGLE_CLIENT_ID": "YOUR_CLIENT_ID.apps.googleusercontent.com",
    "ACS_CONNECTION_STRING": "",
    "ACS_SENDER_ADDRESS": "",
    "APP_BASE_URL": "",
}

def load_config():
    cfg = dict(_DEFAULTS)
    if CONFIG_PATH.exists():
        try:
            cfg.update(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
        except Exception:
            pass
    for key in _DEFAULTS:
        if os.environ.get(key):
            cfg[key] = os.environ[key]
    return cfg

def _ssl_kwargs(config):
    ca = (config.get("MYSQL_SSL_CA") or "").strip()
    if ca and Path(ca).exists():
        return {"ssl": {"ca": ca}}
    if config.get("MYSQL_HOST", "").endswith(".mysql.database.azure.com"):
        return {"ssl": {"ssl_mode": "REQUIRED"}}
    return {}

def get_db():
    config = load_config()
    return pymysql.connect(
        host=config.get("MYSQL_HOST", "localhost"),
        user=config.get("MYSQL_USER", "root"),
        password=config.get("MYSQL_PASSWORD", ""),
        database=config.get("MYSQL_DATABASE", "jissr_db"),
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
        **_ssl_kwargs(config),
    )

def init_db():
    config = load_config()
    db_name = config.get("MYSQL_DATABASE", "jissr_db")
    try:
        conn = pymysql.connect(
            host=config.get("MYSQL_HOST", "localhost"),
            user=config.get("MYSQL_USER", "root"),
            password=config.get("MYSQL_PASSWORD", ""),
            autocommit=True,
            **_ssl_kwargs(config),
        )
        with conn.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {db_name}")
        conn.close()

        # Connect to target database and create tables
        conn = get_db()
        with conn.cursor() as cursor:
            # Users table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    email VARCHAR(255) UNIQUE,
                    password_hash VARCHAR(255),
                    name VARCHAR(255) DEFAULT 'User',
                    is_guest TINYINT DEFAULT 0,
                    reset_token_hash VARCHAR(255) DEFAULT NULL,
                    reset_token_expires DATETIME DEFAULT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
            for col_sql in (
                "ALTER TABLE users ADD COLUMN reset_token_hash VARCHAR(255) DEFAULT NULL",
                "ALTER TABLE users ADD COLUMN reset_token_expires DATETIME DEFAULT NULL",
            ):
                try:
                    cursor.execute(col_sql)
                except Exception:
                    pass
            # Sessions table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    token VARCHAR(255) PRIMARY KEY,
                    user_id INT NOT NULL,
                    expires_at DATETIME NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
            # Translation history table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS translation_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    type VARCHAR(50) NOT NULL,
                    input_text TEXT,
                    output_text TEXT,
                    confidence FLOAT DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
            # Analytics table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS analytics (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT,
                    event_type VARCHAR(255) NOT NULL,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
            # User settings table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_settings (
                    user_id INT PRIMARY KEY,
                    theme VARCHAR(50) DEFAULT 'light',
                    accent_color VARCHAR(50) DEFAULT '#C8102E',
                    camera_quality VARCHAR(50) DEFAULT '720p',
                    text_size INT DEFAULT 18,
                    haptic_feedback TINYINT DEFAULT 1,
                    visual_cues TINYINT DEFAULT 1,
                    high_contrast TINYINT DEFAULT 0,
                    el_api_key VARCHAR(255) DEFAULT '',
                    el_voice_id VARCHAR(255) DEFAULT '21m00Tcm4TlvDq8ikWAM',
                    el_model VARCHAR(255) DEFAULT 'eleven_multilingual_v2',
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
            """)
        conn.close()
        print(f"[DB] MySQL database '{db_name}' initialized successfully")
    except Exception as e:
        print(f"[DB] Warning: Could not connect to MySQL server. Please verify MySQL service is running. Error: {e}")

def get_auth_token():
    auth = request.headers.get('Authorization', '')
    return auth[7:] if auth.startswith('Bearer ') else None

def get_user_from_token(token):
    if not token:
        return None
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT u.* FROM sessions s JOIN users u ON s.user_id=u.id "
                "WHERE s.token=%s AND s.expires_at>NOW()", (token,)
            )
            row = cursor.fetchone()
        conn.close()
        return row
    except Exception:
        return None

def _user_json(u):
    return {"id": u["id"], "email": u.get("email"), "name": u["name"], "is_guest": u["is_guest"]}

def require_auth(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = get_user_from_token(get_auth_token())
        if not user:
            return jsonify({"success": False, "error": "Authentication required"}), 401
        request.user = user
        return f(*args, **kwargs)
    return wrapper
