import io
import json
import tempfile
import os
import sys
import secrets
import hashlib
import sqlite3 # Kept for backward references if any, but pymysql is used primarily now
import pymysql
from pathlib import Path
from datetime import datetime, timedelta
import numpy as np
import cv2
import base64
from PIL import Image
from flask import Flask, render_template, request, jsonify, send_file
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

# Import database module
from database import (
    init_db,
    get_db,
    require_auth,
    get_auth_token,
    get_user_from_token,
    _user_json,
    load_config
)

# Import machine learning inference module
import inference
from inference import (
    UniSignManager,
    RealtimeProcessor,
    extract_pose_from_video,
    extract_pose_from_frames,
    ensure_checkpoint,
    DEVICE,
    CHECKPOINT_PATH,
    WORDS_TXT,
    LABEL_MAP_PATH,
)

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_SAMESITE="Lax",
)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

def _rate_key():
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return get_remote_address()

limiter = Limiter(
    key_func=_rate_key,
    app=app,
    default_limits=[],
    storage_uri="memory://",
    headers_enabled=True,
)

ACTIVE_PROCESSORS = {}

# ── Dynamic Config Route ──────────────────────────────────────────────────────

@app.route("/config", methods=["GET"])
def get_config():
    c = load_config()
    return jsonify({
        "google_client_id": c.get("GOOGLE_CLIENT_ID", "YOUR_CLIENT_ID.apps.googleusercontent.com"),
        # True when a server-side ElevenLabs key is configured, so the frontend
        # can use natural TTS/STT without the user pasting their own key.
        "elevenlabs_available": bool(os.environ.get("ELEVENLABS_API_KEY", "").strip()),
    })

# ── Auth Routes ───────────────────────────────────────────────────────────────

@app.route("/auth/register", methods=["POST"])
@limiter.limit("5 per hour; 20 per day")
def auth_register():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = (data.get("name") or "User").strip()
    if not email or "@" not in email:
        return jsonify({"success": False, "error": "Valid email required"}), 400
    if len(password) < 6:
        return jsonify({"success": False, "error": "Password must be ≥ 6 characters"}), 400
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), email.encode(), 100000).hex()
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("INSERT INTO users (email,password_hash,name) VALUES (%s,%s,%s)", (email, pw_hash, name))
            cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
            user = cursor.fetchone()
            token = secrets.token_hex(32)
            exp = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("INSERT INTO sessions (token,user_id,expires_at) VALUES (%s,%s,%s)", (token, user["id"], exp))
            cursor.execute("INSERT IGNORE INTO user_settings (user_id) VALUES (%s)", (user["id"],))
        conn.close()
        return jsonify({"success": True, "token": token, "user": _user_json(user)})
    except pymysql.err.IntegrityError:
        return jsonify({"success": False, "error": "Email already registered"}), 400
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/auth/login", methods=["POST"])
@limiter.limit("10 per minute; 60 per hour")
def auth_login():
    data = request.get_json(force=True)
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"success": False, "error": "Email and password required"}), 400
    pw_hash = hashlib.pbkdf2_hmac('sha256', password.encode(), email.encode(), 100000).hex()
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE email=%s AND password_hash=%s", (email, pw_hash))
            row = cursor.fetchone()
            if not row:
                conn.close()
                return jsonify({"success": False, "error": "Invalid email or password"}), 401
            user = row
            token = secrets.token_hex(32)
            exp = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("INSERT INTO sessions (token,user_id,expires_at) VALUES (%s,%s,%s)", (token, user["id"], exp))
            cursor.execute("INSERT IGNORE INTO user_settings (user_id) VALUES (%s)", (user["id"],))
        conn.close()
        return jsonify({"success": True, "token": token, "user": _user_json(user)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

_email_client_cache = {"client": None, "conn": None}

def _get_email_client():
    cfg = load_config()
    conn = (cfg.get("ACS_CONNECTION_STRING") or "").strip()
    if not conn:
        return None, None
    if _email_client_cache["conn"] == conn and _email_client_cache["client"] is not None:
        return _email_client_cache["client"], cfg
    try:
        from azure.communication.email import EmailClient
        client = EmailClient.from_connection_string(conn)
        _email_client_cache["client"] = client
        _email_client_cache["conn"] = conn
        return client, cfg
    except Exception as e:
        print(f"[ACS] Failed to init email client: {e}")
        return None, cfg

def _hash_reset_token(token):
    return hashlib.sha256(token.encode()).hexdigest()

@app.route("/auth/forgot-password", methods=["POST"])
@limiter.limit("3 per hour; 10 per day")
def auth_forgot_password():
    data = request.get_json(force=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not email or "@" not in email:
        return jsonify({"success": False, "error": "Valid email required"}), 400
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("SELECT id, name FROM users WHERE email=%s AND (is_guest=0 OR is_guest IS NULL)", (email,))
            user = cursor.fetchone()
            if not user:
                conn.close()
                return jsonify({
                    "success": False,
                    "code": "not_registered",
                    "error": "No account is registered with that email. Please register first."
                }), 404
            raw_token = secrets.token_urlsafe(32)
            token_hash = _hash_reset_token(raw_token)
            expires = (datetime.now() + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute(
                "UPDATE users SET reset_token_hash=%s, reset_token_expires=%s WHERE id=%s",
                (token_hash, expires, user["id"]),
            )
        conn.close()
        client, cfg = _get_email_client()
        sender = (cfg.get("ACS_SENDER_ADDRESS") or "").strip() if cfg else ""
        base_url = (cfg.get("APP_BASE_URL") or request.host_url.rstrip("/")).rstrip("/") if cfg else request.host_url.rstrip("/")
        reset_link = f"{base_url}/reset-password?token={raw_token}"
        ok_payload = jsonify({"success": True, "message": f"A reset link has been sent to {email}."})
        if not client or not sender:
            print(f"[forgot-password] ACS not configured; reset link: {reset_link}")
            return ok_payload
        message = {
            "senderAddress": sender,
            "recipients": {"to": [{"address": email, "displayName": user["name"] or "User"}]},
            "content": {
                "subject": "Reset your JSSIR-OM password",
                "plainText": (
                    f"Hello {user['name'] or 'there'},\n\n"
                    f"We received a request to reset your password.\n"
                    f"Click the link below to set a new password (valid for 1 hour):\n\n"
                    f"{reset_link}\n\n"
                    f"If you did not request this, you can safely ignore this email.\n"
                ),
                "html": (
                    f"<p>Hello {user['name'] or 'there'},</p>"
                    f"<p>We received a request to reset your password. "
                    f"Click the button below to set a new password (link valid for 1 hour):</p>"
                    f"<p><a href=\"{reset_link}\" style=\"background:#C8102E;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;\">Reset password</a></p>"
                    f"<p>Or copy this link: <br><code>{reset_link}</code></p>"
                    f"<p>If you did not request this, you can safely ignore this email.</p>"
                ),
            },
        }
        try:
            poller = client.begin_send(message)
            poller.result(timeout=20)
        except Exception as e:
            print(f"[forgot-password] Email send failed: {e}")
        return ok_payload
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/auth/reset-password", methods=["POST"])
@limiter.limit("10 per hour; 30 per day")
def auth_reset_password():
    data = request.get_json(force=True) or {}
    raw_token = (data.get("token") or "").strip()
    new_password = data.get("password") or ""
    if not raw_token:
        return jsonify({"success": False, "error": "Reset token required"}), 400
    if len(new_password) < 6:
        return jsonify({"success": False, "error": "Password must be ≥ 6 characters"}), 400
    token_hash = _hash_reset_token(raw_token)
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id, email FROM users WHERE reset_token_hash=%s AND reset_token_expires > NOW()",
                (token_hash,),
            )
            user = cursor.fetchone()
            if not user:
                conn.close()
                return jsonify({"success": False, "error": "Invalid or expired reset link"}), 400
            pw_hash = hashlib.pbkdf2_hmac('sha256', new_password.encode(), user["email"].encode(), 100000).hex()
            cursor.execute(
                "UPDATE users SET password_hash=%s, reset_token_hash=NULL, reset_token_expires=NULL WHERE id=%s",
                (pw_hash, user["id"]),
            )
            cursor.execute("DELETE FROM sessions WHERE user_id=%s", (user["id"],))
        conn.close()
        return jsonify({"success": True, "message": "Password updated. Please sign in with your new password."})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/auth/guest", methods=["POST"])
def auth_guest():
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("INSERT INTO users (name,is_guest) VALUES ('Guest',1)")
            cursor.execute("SELECT LAST_INSERT_ID()")
            uid = cursor.fetchone()["LAST_INSERT_ID()"]
            token = secrets.token_hex(32)
            exp = (datetime.now() + timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("INSERT INTO sessions (token,user_id,expires_at) VALUES (%s,%s,%s)", (token, uid, exp))
            cursor.execute("INSERT IGNORE INTO user_settings (user_id) VALUES (%s)", (uid,))
        conn.close()
        return jsonify({"success": True, "token": token, "user": {"id": uid, "name": "Guest", "email": None, "is_guest": 1}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    token = get_auth_token()
    if token:
        try:
            conn = get_db()
            with conn.cursor() as cursor:
                cursor.execute("DELETE FROM sessions WHERE token=%s", (token,))
            conn.close()
        except Exception:
            pass
    return jsonify({"success": True})

@app.route("/auth/me", methods=["GET"])
def auth_me():
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    return jsonify({"success": True, "user": _user_json(user)})

# ── History Routes ────────────────────────────────────────────────────────────

@app.route("/history", methods=["GET"])
def get_history():
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    type_filter = request.args.get("type", "all")
    limit = min(int(request.args.get("limit", 100)), 500)
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            if type_filter == "all":
                cursor.execute(
                    "SELECT * FROM translation_history WHERE user_id=%s ORDER BY created_at DESC LIMIT %s",
                    (user["id"], limit)
                )
            else:
                cursor.execute(
                    "SELECT * FROM translation_history WHERE user_id=%s AND type=%s ORDER BY created_at DESC LIMIT %s",
                    (user["id"], type_filter, limit)
                )
            rows = cursor.fetchall()
        conn.close()
        return jsonify({"success": True, "history": rows})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/history", methods=["POST"])
def add_history():
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    data = request.get_json(force=True)
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO translation_history (user_id,type,input_text,output_text,confidence) VALUES (%s,%s,%s,%s,%s)",
                (user["id"], data.get("type","s2s"), data.get("input_text",""), data.get("output_text",""), float(data.get("confidence",0)))
            )
            cursor.execute("SELECT LAST_INSERT_ID()")
            row_id = cursor.fetchone()["LAST_INSERT_ID()"]
            cursor.execute("INSERT INTO analytics (user_id,event_type) VALUES (%s,%s)", (user["id"], f"translation_{data.get('type','s2s')}"))
        conn.close()
        return jsonify({"success": True, "id": row_id})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/history/<int:hid>", methods=["DELETE"])
def delete_history_item(hid):
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM translation_history WHERE id=%s AND user_id=%s", (hid, user["id"]))
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/history/clear", methods=["DELETE"])
def clear_history():
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("DELETE FROM translation_history WHERE user_id=%s", (user["id"],))
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Settings Routes ───────────────────────────────────────────────────────────

@app.route("/settings", methods=["GET"])
def get_settings():
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("INSERT IGNORE INTO user_settings (user_id) VALUES (%s)", (user["id"],))
            cursor.execute("SELECT * FROM user_settings WHERE user_id=%s", (user["id"],))
            s = cursor.fetchone()
        conn.close()
        return jsonify({"success": True, "settings": s})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/settings", methods=["POST"])
def save_settings():
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    data = request.get_json(force=True)
    allowed = ['theme','accent_color','camera_quality','text_size','haptic_feedback',
               'visual_cues','high_contrast','el_api_key','el_voice_id','el_model']
    updates = {k: v for k, v in data.items() if k in allowed}
    try:
        if updates:
            set_clause = ", ".join(f"{k}=%s" for k in updates)
            conn = get_db()
            with conn.cursor() as cursor:
                cursor.execute("INSERT IGNORE INTO user_settings (user_id) VALUES (%s)", (user["id"],))
                cursor.execute(f"UPDATE user_settings SET {set_clause},updated_at=NOW() WHERE user_id=%s",
                               list(updates.values()) + [user["id"]])
            conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/auth/google", methods=["POST"])
@limiter.limit("10 per minute; 60 per hour")
def auth_google():
    """Verify a Google Identity Services id_token, then create or find the user."""
    import requests as req
    data = request.get_json(force=True)
    id_token = (data.get("id_token") or "").strip()
    if not id_token:
        return jsonify({"success": False, "error": "Missing id_token"}), 400

    # Verify id_token with Google's tokeninfo endpoint.
    try:
        resp = req.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token},
            timeout=10,
        )
        if resp.status_code != 200:
            return jsonify({"success": False, "error": "Invalid Google token"}), 401
        info = resp.json()
    except Exception as e:
        return jsonify({"success": False, "error": f"Token verification failed: {e}"}), 500

    cfg = load_config()
    expected_client_id = cfg.get("GOOGLE_CLIENT_ID", "") or ""
    if expected_client_id and not expected_client_id.startswith("YOUR_"):
        if info.get("aud") != expected_client_id:
            return jsonify({"success": False, "error": "Token audience mismatch"}), 401

    if info.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        return jsonify({"success": False, "error": "Untrusted token issuer"}), 401

    email = (info.get("email") or "").strip().lower()
    email_verified = str(info.get("email_verified", "")).lower() in ("true", "1")
    name = (info.get("name") or "Google User").strip()
    if not email or not email_verified:
        return jsonify({"success": False, "error": "Email not verified by Google"}), 400

    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
            row = cursor.fetchone()
            if row:
                user = row
                cursor.execute("UPDATE users SET name=%s WHERE id=%s", (name, user["id"]))
                user["name"] = name
            else:
                cursor.execute("INSERT INTO users (email,name) VALUES (%s,%s)", (email, name))
                cursor.execute("SELECT * FROM users WHERE email=%s", (email,))
                user = cursor.fetchone()
            token = secrets.token_hex(32)
            exp = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")
            cursor.execute("INSERT INTO sessions (token,user_id,expires_at) VALUES (%s,%s,%s)", (token, user["id"], exp))
            cursor.execute("INSERT IGNORE INTO user_settings (user_id) VALUES (%s)", (user["id"],))
        conn.close()
        return jsonify({"success": True, "token": token, "user": _user_json(user)})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/analytics", methods=["GET"])
def get_analytics():
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    try:
        conn = get_db()
        with conn.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM translation_history WHERE user_id=%s", (user["id"],))
            total = cursor.fetchone()["COUNT(*)"]
            cursor.execute("SELECT COUNT(*) FROM translation_history WHERE user_id=%s AND type='s2s'", (user["id"],))
            s2s = cursor.fetchone()["COUNT(*)"]
            cursor.execute("SELECT COUNT(*) FROM translation_history WHERE user_id=%s AND type='sp2s'", (user["id"],))
            sp2s = cursor.fetchone()["COUNT(*)"]
        conn.close()
        return jsonify({"success": True, "analytics": {"total": total, "s2s_count": s2s, "sp2s_count": sp2s}})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── General Routes ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/forgot-password")
def forgot_password_page():
    return render_template("forgot_password.html")

@app.route("/reset-password")
def reset_password_page():
    return render_template("reset_password.html")

# ── Static info pages ─────────────────────────────────────────────────────────

_INFO_PAGES = {
    "about": {
        "title": "Our Mission",
        "subtitle": "Bridging communication for the Deaf community in Oman.",
        "updated": "May 31, 2026",
        "content": """
            <p><strong>JISSR</strong> (Arabic: <span lang="ar">جِسر</span>, meaning <em>bridge</em>) is an AI-powered platform that translates Omani Sign Language into spoken Arabic and English in real time, and converts speech back into animated signing.</p>
            <h2>Why we exist</h2>
            <p>There are tens of thousands of Deaf and Hard-of-Hearing people across the Sultanate of Oman, yet very few public services, schools, or workplaces are equipped to communicate fluently with them. Sign language interpreters are rare; everyday interactions — at a clinic, in a classroom, at a service counter — can quickly become inaccessible.</p>
            <p>JISSR is a step toward closing that gap. By turning a phone or laptop camera into an instant interpreter, we want to make every conversation a two-way street.</p>
            <h2>What we do</h2>
            <ul>
              <li><strong>Sign → Speech:</strong> Real-time recognition of Omani Sign Language using deep learning (UniSign + RTMPose) — the spoken translation appears on screen and can be read aloud.</li>
              <li><strong>Speech → Sign:</strong> Spoken or typed Arabic/English is converted into animated signing using an avatar dictionary.</li>
              <li><strong>History & accessibility:</strong> Sessions are saved so users can review past conversations, with high-contrast modes and adjustable text for low-vision users.</li>
            </ul>
            <h2>Our principles</h2>
            <ul>
              <li><strong>Privacy first.</strong> Video frames are processed in memory and discarded; we never permanently store recordings.</li>
              <li><strong>Inclusive by design.</strong> The interface is built with WCAG 2.1 AA accessibility in mind from day one.</li>
              <li><strong>Open to the community.</strong> JISSR is an academic project developed at <strong>Sultan Qaboos University</strong>; we welcome feedback from Deaf users, interpreters, educators and researchers.</li>
            </ul>
        """,
    },
    "team": {
        "title": "The Team",
        "subtitle": "Built as a Final Year Project at Sultan Qaboos University.",
        "updated": "May 31, 2026",
        "content": """
            <p>JISSR was developed as a <strong>Final Year Project (FYP)</strong> at the College of Engineering, <strong>Sultan Qaboos University</strong>, Muscat, Oman.</p>
            <h2>Project lead</h2>
            <p><strong>Yousuf Al-Shaili</strong> — design, machine learning integration, full-stack development.</p>
            <h2>Acknowledgements</h2>
            <ul>
              <li>Sultan Qaboos University — College of Engineering, for academic supervision and resources.</li>
              <li>The Omani Deaf community, whose contributions to sign language datasets make this work possible.</li>
              <li>Open-source projects relied upon by JISSR: <a href="https://pytorch.org/" rel="noopener" target="_blank">PyTorch</a>, <a href="https://github.com/Tau-J/rtmlib" rel="noopener" target="_blank">RTMLib (RTMPose)</a>, <a href="https://flask.palletsprojects.com/" rel="noopener" target="_blank">Flask</a>, and the broader UniSign research community.</li>
            </ul>
            <h2>Want to join or contribute?</h2>
            <p>If you're a student, interpreter, or developer interested in sign-language AI for Omani communities, reach out via the <a href="/contact">Contact</a> page — collaborations are very welcome.</p>
        """,
    },
    "contact": {
        "title": "Contact",
        "subtitle": "We'd love to hear from you.",
        "updated": "May 31, 2026",
        "content": """
            <p>For questions, feedback, collaboration, or accessibility issues, please get in touch.</p>
            <div class="contact-card">
              <div class="label">Email</div>
              <div class="value"><a href="mailto:mr.yousufalshaaili@gmail.com">mr.yousufalshaaili@gmail.com</a></div>
            </div>
            <div class="contact-card">
              <div class="label">Institution</div>
              <div class="value">Sultan Qaboos University<br><span style="font-weight:400;color:var(--muted);font-size:14px;">College of Engineering · Muscat, Oman</span></div>
            </div>
            <h2>Reporting a bug or accessibility issue</h2>
            <p>When you write in, please include:</p>
            <ul>
              <li>What you were trying to do.</li>
              <li>What happened instead.</li>
              <li>The device and browser you used (e.g. iPhone Safari, Windows Chrome).</li>
            </ul>
            <p>We try to reply within a few working days.</p>
        """,
    },
    "terms": {
        "title": "Terms of Service",
        "subtitle": "The rules for using JISSR.",
        "updated": "May 31, 2026",
        "content": """
            <p>By accessing or using <strong>JISSR</strong> (the &ldquo;Service&rdquo;), you agree to these Terms. If you do not agree, please do not use the Service.</p>
            <h2>1. Nature of the Service</h2>
            <p>JISSR is an <strong>academic prototype</strong> developed as a Final Year Project at Sultan Qaboos University. It is provided for <strong>educational, research, and non-commercial</strong> use. Translation accuracy is not guaranteed and the Service must not be relied on for medical, legal, emergency, or other critical communication.</p>
            <h2>2. Your account</h2>
            <ul>
              <li>You are responsible for keeping your password secure.</li>
              <li>You may sign in via email/password or with Google; in both cases you remain responsible for activity on your account.</li>
              <li>You must be at least 13 years old to register, or have permission from a parent/guardian.</li>
            </ul>
            <h2>3. Acceptable use</h2>
            <p>You agree <strong>not</strong> to use JISSR to:</p>
            <ul>
              <li>Upload, transmit, or generate content that is unlawful, harmful, defamatory, sexually explicit, or that infringes anyone's rights.</li>
              <li>Attempt to reverse-engineer, abuse, or overload the Service.</li>
              <li>Misrepresent translations produced by the Service as professional interpretation.</li>
            </ul>
            <h2>4. Recordings and data</h2>
            <p>Video frames sent for sign recognition are processed in memory and discarded immediately afterwards. Translation text you choose to save is stored in your account history and can be deleted at any time. See the <a href="/privacy">Privacy Policy</a> for details.</p>
            <h2>5. No warranty</h2>
            <p>The Service is provided <strong>&ldquo;as is&rdquo;</strong>, without warranty of any kind, express or implied. We do not guarantee that the Service will be uninterrupted, error-free, or accurate.</p>
            <h2>6. Limitation of liability</h2>
            <p>To the maximum extent permitted by law, the project authors and Sultan Qaboos University shall not be liable for any indirect, incidental, special, or consequential damages arising from your use of the Service.</p>
            <h2>7. Changes</h2>
            <p>We may update these Terms as the project evolves. The &ldquo;Last updated&rdquo; date below reflects the latest revision. Continued use of the Service after changes means you accept the revised Terms.</p>
            <h2>8. Governing law</h2>
            <p>These Terms are governed by the laws of the <strong>Sultanate of Oman</strong>, without regard to conflict-of-laws principles.</p>
        """,
    },
    "privacy": {
        "title": "Privacy Policy",
        "subtitle": "What we collect, why, and how we protect it.",
        "updated": "May 31, 2026",
        "content": """
            <p>Your privacy matters. This policy explains what data JISSR collects, how it is used, and the choices you have.</p>
            <h2>1. Data we collect</h2>
            <ul>
              <li><strong>Account information:</strong> email address and display name when you register or sign in with Google.</li>
              <li><strong>Authentication tokens:</strong> session tokens stored in our database so you stay signed in.</li>
              <li><strong>Translation history:</strong> the text output of translations you choose to save (you can delete it at any time).</li>
              <li><strong>Basic usage events:</strong> counts of translation requests, used to monitor service health.</li>
              <li><strong>Technical logs:</strong> standard server logs (IP, timestamp, request path) kept for a short period for security.</li>
            </ul>
            <h2>2. Data we do <em>not</em> store</h2>
            <ul>
              <li><strong>Video recordings.</strong> Frames sent for sign recognition are processed in server memory and discarded immediately.</li>
              <li><strong>Audio recordings.</strong> Microphone audio used for speech-to-text is processed in memory and discarded.</li>
              <li><strong>Passwords in plain text.</strong> Passwords are hashed with PBKDF2-SHA256 before storage.</li>
            </ul>
            <h2>3. Where data is stored</h2>
            <p>Account data is stored in a managed <strong>MySQL database on Microsoft Azure</strong> in the <strong>UAE North</strong> region. Large model files are stored in Azure Blob Storage. We rely on Azure's encryption-at-rest and TLS-in-transit.</p>
            <h2>4. Sharing</h2>
            <p>We do not sell your data. We do not share it with third parties except where required to operate the Service (e.g. Microsoft Azure as our cloud provider, Google for OAuth sign-in if you choose it). We may disclose information if compelled by lawful request.</p>
            <h2>5. Your choices</h2>
            <ul>
              <li><strong>Delete your account or history:</strong> email <a href="mailto:mr.yousufalshaaili@gmail.com">mr.yousufalshaaili@gmail.com</a> and we will remove your data within 30 days.</li>
              <li><strong>Reset your password:</strong> use the &ldquo;Forgot password?&rdquo; link on the sign-in screen.</li>
              <li><strong>Sign out everywhere:</strong> happens automatically whenever you reset your password.</li>
            </ul>
            <h2>6. Cookies and local storage</h2>
            <p>JISSR uses your browser's local storage to remember your authentication token and UI preferences (theme, accent colour, text size). No third-party advertising or tracking cookies are used.</p>
            <h2>7. Children</h2>
            <p>JISSR is not directed at children under 13. If you believe a child has registered, contact us and we will delete the account.</p>
            <h2>8. Changes to this policy</h2>
            <p>If we materially change how we handle data, we will update this page and revise the &ldquo;Last updated&rdquo; date.</p>
        """,
    },
    "accessibility": {
        "title": "Accessibility",
        "subtitle": "Designed for everyone, including users with disabilities.",
        "updated": "May 31, 2026",
        "content": """
            <p>JISSR is built first and foremost for the <strong>Deaf and Hard-of-Hearing</strong> community. Accessibility is not a bonus feature — it is the entire point. We aim to conform to the <a href="https://www.w3.org/WAI/standards-guidelines/wcag/" rel="noopener" target="_blank">Web Content Accessibility Guidelines (WCAG) 2.1, Level AA</a>.</p>
            <h2>Features for accessibility</h2>
            <ul>
              <li><strong>High-contrast mode</strong> and dark/light themes, switchable from settings.</li>
              <li><strong>Adjustable text size</strong> across the interface.</li>
              <li><strong>Keyboard navigation</strong> for all interactive controls.</li>
              <li><strong>ARIA labels</strong> and role attributes for screen-reader compatibility.</li>
              <li><strong>Visual cues for audio events</strong> (recording status, playback) — no critical information is conveyed by sound alone.</li>
              <li><strong>Haptic feedback</strong> on supported mobile devices for action confirmation.</li>
              <li><strong>Captions and text output</strong> for every spoken translation.</li>
            </ul>
            <h2>Known limitations</h2>
            <p>As an academic prototype, some areas still need work:</p>
            <ul>
              <li>Translation accuracy varies with lighting, signing speed, and camera angle.</li>
              <li>The avatar dictionary is limited to a starter vocabulary of common signs.</li>
              <li>Some animations and modals could better support reduced-motion preferences.</li>
            </ul>
            <h2>Report an accessibility barrier</h2>
            <p>If something stops you from using JISSR, please tell us — we take accessibility reports as a priority. Email <a href="mailto:mr.yousufalshaaili@gmail.com">mr.yousufalshaaili@gmail.com</a> with what happened and the device/browser you used. We try to respond within a few working days.</p>
        """,
    },
}

@app.route("/about")
def info_about(): return render_template("page.html", **_INFO_PAGES["about"])

@app.route("/team")
def info_team(): return render_template("page.html", **_INFO_PAGES["team"])

@app.route("/contact")
def info_contact(): return render_template("page.html", **_INFO_PAGES["contact"])

@app.route("/terms")
def info_terms(): return render_template("page.html", **_INFO_PAGES["terms"])

@app.route("/privacy")
def info_privacy(): return render_template("page.html", **_INFO_PAGES["privacy"])

@app.route("/accessibility")
def info_accessibility(): return render_template("page.html", **_INFO_PAGES["accessibility"])

# ── Real-time predict (for webcam) ────────────────────────────────────────────
@app.route("/predict", methods=["POST"])
@require_auth
def predict():
    try:
        data = request.get_json(force=True)
        frames_b64 = data.get("frames", [])
        
        if len(frames_b64) < 5:
            return jsonify({"success": False, "error": "too few frames"}), 400
        
        # Decode frames
        frames = []
        for frame_b64 in frames_b64:
            try:
                if ',' in frame_b64:
                    frame_b64 = frame_b64.split(',')[1]
                img_bytes = base64.b64decode(frame_b64)
                img = Image.open(io.BytesIO(img_bytes))
                frame = np.array(img)
                if len(frame.shape) == 3 and frame.shape[2] == 3:
                    frame = cv2.cvtColor(frame, cv2.COLOR_RGB2BGR)
                frames.append(frame)
            except:
                continue
        
        if not frames:
            return jsonify({"success": False, "error": "No valid frames"}), 400
        
        pose_data = extract_pose_from_frames(frames)
        preds = UniSignManager.predict_from_pose(pose_data, top_k=5)
        return jsonify({"success": True, "predictions": preds})
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Video-file predict ────────────────────────────────────────────────────────
@app.route("/predict-video", methods=["POST"])
@require_auth
def predict_video():
    try:
        file = request.files.get("video")
        if not file:
            return jsonify({"success": False, "error": "No video"}), 400
        
        suffix = Path(file.filename).suffix or ".mp4"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name
        
        pose_data = extract_pose_from_video(tmp_path)
        if not pose_data or len(pose_data['keypoints']) == 0:
            os.unlink(tmp_path)
            return jsonify({"success": False, "error": "No pose detected"}), 400
        
        preds = UniSignManager.predict_from_pose(pose_data, tmp_path, top_k=5)
        os.unlink(tmp_path)
        return jsonify({
            "success": True,
            "predictions": preds,
            "frames": len(pose_data['keypoints'])
        })
        
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── ElevenLabs TTS ────────────────────────────────────────────────────────────
@app.route("/tts-elevenlabs", methods=["POST"])
@require_auth
def tts_elevenlabs():
    import requests as req
    try:
        data = request.get_json(force=True)
        text = data.get("text", "").strip()
        # Fall back to the server-side key when the user hasn't pasted their own.
        api_key = (data.get("api_key") or "").strip() or os.environ.get("ELEVENLABS_API_KEY", "").strip()
        voice_id = data.get("voice_id", "21m00Tcm4TlvDq8ikWAM")
        model_id = data.get("model_id", "eleven_multilingual_v2")

        if not text:
            return jsonify({"success": False, "error": "Empty text"}), 400
        if not api_key:
            return jsonify({"success": False, "error": "No API key"}), 400

        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        headers = {
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        }
        body = {
            "text": text,
            "model_id": model_id,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
        }
        resp = req.post(url, headers=headers, json=body, timeout=30)
        if resp.status_code != 200:
            try:
                err = resp.json().get("detail", {}).get("message", resp.text[:200])
            except:
                err = resp.text[:200]
            return jsonify({"success": False, "error": err}), resp.status_code

        return send_file(io.BytesIO(resp.content), mimetype="audio/mpeg",
                         download_name="tts.mp3")
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── ElevenLabs STT (Scribe) ───────────────────────────────────────────────────
@app.route("/stt-elevenlabs", methods=["POST"])
@require_auth
def stt_elevenlabs():
    import requests as req
    try:
        # Fall back to the server-side key when the user hasn't pasted their own.
        api_key = (request.form.get("api_key") or "").strip() or os.environ.get("ELEVENLABS_API_KEY", "").strip()
        lang = request.form.get("lang", "ara")   # ISO-639-3
        audio = request.files.get("audio")

        if not api_key:
            return jsonify({"success": False, "error": "No API key"}), 400
        if not audio:
            return jsonify({"success": False, "error": "No audio file"}), 400

        url = "https://api.elevenlabs.io/v1/speech-to-text"
        headers = {"xi-api-key": api_key}
        files = {"file": (audio.filename or "audio.webm", audio.stream, audio.mimetype)}
        data = {"model_id": "scribe_v1", "language_code": lang}

        resp = req.post(url, headers=headers, files=files, data=data, timeout=60)
        if resp.status_code != 200:
            try:
                err = resp.json().get("detail", {}).get("message", resp.text[:200])
            except:
                err = resp.text[:200]
            return jsonify({"success": False, "error": err}), resp.status_code

        transcript = resp.json().get("text", "")
        return jsonify({"success": True, "transcript": transcript})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Avatar: word list ─────────────────────────────────────────────────────────
@app.route("/avatar/words")
def avatar_words():
    vocab_path = Path(WORDS_TXT)
    words = []
    if vocab_path.exists():
        for line in vocab_path.read_text(encoding="utf-8").splitlines():
            parts = line.strip().split(maxsplit=1)
            if len(parts) == 2:
                sign_id, arabic = parts
                has_anim = sign_id in inference._avatar_index
                words.append({"sign_id": sign_id, "arabic": arabic, "has_anim": has_anim})
    return jsonify({"success": True, "words": words, "total": len(words)})

# ── Avatar: resolve text to sign sequence ─────────────────────────────────────
@app.route("/avatar/resolve", methods=["POST"])
@require_auth
def avatar_resolve():
    data = request.get_json(force=True)
    text = data.get("text", "").strip()
    words = text.split()
    seq = []
    i = 0
    while i < len(words):
        matched = None
        if i + 1 < len(words):
            phrase = words[i] + " " + words[i + 1]
            if phrase in inference._vocab_map:
                sid = inference._vocab_map[phrase]
                matched = {"sign_id": sid, "word": phrase, "has_anim": sid in inference._avatar_index}
                i += 2
        if not matched:
            word = words[i]
            sid = inference._vocab_map.get(word)
            matched = {"sign_id": sid, "word": word, "has_anim": bool(sid and sid in inference._avatar_index)}
            if not sid:
                matched["sign_id"] = None
            i += 1
        seq.append(matched)
    return jsonify({"success": True, "sequence": seq})

# ── Avatar: serve landmark frames ─────────────────────────────────────────────
@app.route("/avatar/frames/<sign_id>")
def avatar_frames(sign_id):
    path = inference._avatar_index.get(sign_id)
    if not path:
        return jsonify({"success": False, "error": f"No animation for sign {sign_id}"}), 404
    arr = np.load(path).astype(np.float32)
    fmt = "543" if arr.shape[1] == 543 else "133"
    if arr.shape[2] == 3:
        frames = arr.tolist()
    else:
        z = np.zeros((*arr.shape[:2], 1), dtype=np.float32)
        frames = np.concatenate([arr, z], axis=2).tolist()
    return jsonify({"success": True, "sign_id": sign_id, "format": fmt,
                    "n_frames": len(frames), "frames": frames})

# ── Free neural TTS via Microsoft edge-tts (Omani Arabic) ─────────────────────
# Default voices: Omani male for Arabic, US male for English. No API key needed.
EDGE_VOICE_AR = os.environ.get("EDGE_VOICE_AR", "ar-OM-AbdullahNeural")
EDGE_VOICE_EN = os.environ.get("EDGE_VOICE_EN", "en-US-GuyNeural")

@app.route("/tts-edge", methods=["POST"])
@require_auth
def tts_edge():
    import re as _re
    import asyncio
    import edge_tts
    try:
        d = request.get_json(force=True)
        text = (d.get("text") or "").strip()
        lang = d.get("lang", "ar")
        if not text:
            return jsonify({"success": False, "error": "empty"}), 400

        is_arabic = bool(_re.search(r"[؀-ۿ]", text)) or lang == "ar"
        voice = d.get("voice") or (EDGE_VOICE_AR if is_arabic else EDGE_VOICE_EN)

        async def _synth():
            buf = io.BytesIO()
            communicate = edge_tts.Communicate(text, voice)
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    buf.write(chunk["data"])
            return buf

        buf = asyncio.run(_synth())
        if buf.getbuffer().nbytes == 0:
            return jsonify({"success": False, "error": "no audio produced"}), 502
        buf.seek(0)
        return send_file(buf, mimetype="audio/mpeg", download_name="tts.mp3")
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Legacy gTTS fallback ──────────────────────────────────────────────────────
@app.route("/tts", methods=["POST"])
@require_auth
def tts_gtts():
    try:
        from gtts import gTTS
        d = request.get_json(force=True)
        text = d.get("text", "").strip()
        lang = d.get("lang", "ar")
        if not text:
            return jsonify({"success": False, "error": "empty"}), 400
        buf = io.BytesIO()
        gTTS(text=text, lang=lang, slow=False).write_to_fp(buf)
        buf.seek(0)
        return send_file(buf, mimetype="audio/mpeg", download_name="s.mp3")
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Chatbot (Ollama) ──────────────────────────────────────────────────────────
OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL    = os.environ.get("OLLAMA_MODEL", "llama3.2")

CHAT_SYSTEM_PROMPT = (
    "You are JISSR's in-app help assistant. Be concise, friendly, and accurate. "
    "Answer ONLY from the facts in this prompt — never invent UI labels, menus, "
    "buttons, emails, URLs, phone numbers, or social handles. If you don't know, say so.\n\n"

    "=== ABOUT JISSR ===\n"
    "JISSR (جِسر, 'bridge' in Arabic) is a real-time Omani Sign Language (OSL) "
    "translation web app. It is a Final Year Project at Sultan Qaboos University, "
    "College of Engineering, Muscat, Oman. Project lead: Yousuf Al-Shaili.\n\n"

    "=== CONTACT ===\n"
    "Email: mr.yousufalshaaili@gmail.com\n"
    "Contact page in the app: /contact\n"
    "Institution: Sultan Qaboos University, College of Engineering, Muscat, Oman.\n"
    "JISSR has NO public website (other than this app), NO phone number, NO WhatsApp, "
    "NO social media accounts. Do not invent any.\n\n"

    "=== FEATURES (use only these names — do not rename) ===\n"
    "1) Sign → Speech (top-nav 'Sign → Speech'):\n"
    "   - INPUT: live camera feed OR an uploaded video file.\n"
    "   - OUTPUT: predicted OSL word shown on screen, with optional text-to-speech.\n"
    "   - Controls on the page: a round red 'Record' button in the middle, an 'Upload' "
    "button on the left, a 'Flip Cam' button on the right.\n"
    "   - 'Auto-Speak' toggle is on the same page (inside the AI Output panel) — NOT "
    "in Settings.\n"
    "   - Output panel shows the top prediction, Top-5 predictions, and a history list "
    "with a 'Clear' button.\n"

    "2) Speech → Sign (top-nav 'Speech → Sign'):\n"
    "   - INPUT: spoken Arabic or English via your MICROPHONE (or typed text).\n"
    "   - OUTPUT: an animated AVATAR signing the matching OSL signs from a sign dictionary.\n"
    "   - Speech → Sign does NOT use the camera and does NOT do phoneme analysis — it "
    "matches recognised words to entries in an avatar/sign dictionary.\n"

    "3) History — past translations saved per signed-in user, with delete and clear.\n"
    "4) Settings — language, voice, theme (light/dark), accessibility options.\n"
    "5) Sign in / Sign up — email + password OR Google sign-in. 'Forgot password?' link "
    "on the sign-in screen takes the user to /forgot-password, which emails a reset link.\n\n"

    "=== PRIVACY ===\n"
    "Video frames and microphone audio are processed in memory and immediately discarded — "
    "they are NEVER stored. Only the text output of translations is saved in History, and "
    "only if the user keeps them. Passwords are hashed (PBKDF2-SHA256).\n\n"

    "=== INFO PAGES ===\n"
    "/about (mission), /team (project lead + acknowledgements), /contact (email + how to "
    "report a bug), /privacy, /terms, /accessibility.\n\n"

    "=== STYLE RULES ===\n"
    "- Keep answers short. Prefer 1-3 sentences unless the user asks for steps.\n"
    "- Reply in the language the user wrote in (English or Arabic).\n"
    "- If a user asks something unrelated to JISSR / OSL / sign language / accessibility, "
    "say briefly that you only help with JISSR and offer to answer a JISSR question.\n"
    "- You cannot see the user's camera or hear their mic — you are text-only.\n"
    "- If you don't know a specific OSL sign, suggest trying Sign → Speech live."
)

@app.route("/api/chat", methods=["POST"])
@limiter.limit("30 per minute; 200 per hour")
def chat():
    import requests as _r
    user = get_user_from_token(get_auth_token())
    if not user:
        return jsonify({"success": False, "error": "Not authenticated"}), 401
    data = request.get_json(force=True, silent=True) or {}
    messages = data.get("messages") or []
    if not isinstance(messages, list) or not messages:
        return jsonify({"success": False, "error": "messages list required"}), 400
    # Cap context to last 10 turns
    messages = [m for m in messages[-10:] if isinstance(m, dict) and m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
    if not messages:
        return jsonify({"success": False, "error": "no valid messages"}), 400
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [{"role": "system", "content": CHAT_SYSTEM_PROMPT}] + messages,
        "stream": False,
        "options": {"temperature": 0.4, "num_ctx": 2048},
    }
    try:
        r = _r.post(f"{OLLAMA_BASE_URL}/api/chat", json=payload, timeout=60)
        if r.status_code != 200:
            return jsonify({"success": False, "error": f"Ollama returned HTTP {r.status_code}"}), 502
        body = r.json()
        reply = (body.get("message") or {}).get("content", "").strip()
        if not reply:
            return jsonify({"success": False, "error": "Empty reply from model"}), 502
        return jsonify({"success": True, "reply": reply})
    except _r.exceptions.ConnectionError:
        return jsonify({"success": False, "error": "Help assistant is offline. Please try again later."}), 503
    except _r.exceptions.Timeout:
        return jsonify({"success": False, "error": "Help assistant took too long to reply. Please try again."}), 504
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

# ── Health ────────────────────────────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({
        "ok": UniSignManager._loaded,
        "model": "UniSign",
        "pose_estimator": "RTMlib",
        "num_classes": len(UniSignManager._label_map),
        "avatar_signs": len(inference._avatar_index),
        "device": DEVICE,
    })

# ── SocketIO Events (for real-time streaming) ─────────────────────────────────
@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit('connected', {'status': 'ready'})

@socketio.on('disconnect')
def handle_disconnect():
    print(f"Client disconnected: {request.sid}")
    if request.sid in ACTIVE_PROCESSORS:
        ACTIVE_PROCESSORS[request.sid].stop()
        del ACTIVE_PROCESSORS[request.sid]

@socketio.on('start_realtime')
def handle_start_realtime():
    if request.sid not in ACTIVE_PROCESSORS:
        processor = RealtimeProcessor()
        processor.start()
        ACTIVE_PROCESSORS[request.sid] = processor
        emit('realtime_started', {'status': 'processing'})

@socketio.on('stop_realtime')
def handle_stop_realtime():
    if request.sid in ACTIVE_PROCESSORS:
        ACTIVE_PROCESSORS[request.sid].stop()
        del ACTIVE_PROCESSORS[request.sid]
        emit('realtime_stopped', {'status': 'stopped'})

@socketio.on('frame')
def handle_frame(data):
    if request.sid in ACTIVE_PROCESSORS:
        processor = ACTIVE_PROCESSORS[request.sid]
        processor.add_frame(data['frame'])
        
        result = processor.get_latest_result()
        if result:
            emit('prediction', {'predictions': result})

# ══════════════════════════════════════════════════════════════════════════════
#  Initialization
# ══════════════════════════════════════════════════════════════════════════════

# Initialize database
init_db()

# Load UniSign model on startup (downloads from blob storage if missing)
ensure_checkpoint(CHECKPOINT_PATH)
if Path(CHECKPOINT_PATH).exists():
    UniSignManager.load(CHECKPOINT_PATH, WORDS_TXT, LABEL_MAP_PATH)
else:
    print(f"[Warning] UniSign checkpoint not found at {CHECKPOINT_PATH}")

# Download avatar landmark frames (from blob storage if missing), then index them
inference.ensure_landmarks()
inference._build_avatar_index()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 10000)), debug=False, allow_unsafe_werkzeug=True)
