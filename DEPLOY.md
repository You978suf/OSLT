# Deploying JISSR on a Hostinger VPS — normal mode (no Docker, no Azure)

This runs the app the plain way: a Python process behind Nginx, with a local
MySQL database and the model file uploaded by hand. No Docker, no Azure.

Target: **Hostinger VPS KVM 2** (2 vCPU / 8 GB RAM / ~100 GB disk) running
**Ubuntu 22.04**. Pick Ubuntu 22.04 (it has Python 3.10, which matches the
project) — NOT a "Docker" template, just the clean OS.

Throughout, replace:
- `YOUR_VPS_IP`  → the server IP Hostinger gives you
- `yourdomain.com` → the domain you'll point at it

---

## 0. What lives where

| Item | Comes from | How it gets to the VPS |
|---|---|---|
| Code (`app.py`, `templates/`, `static/`, `unisign/`, …) | git repo | `git clone` |
| `models/sentences_best_11pct.pth` (2.35 GB) | your PC | SFTP upload |
| `landmarks/` (sentences + words) | your PC | SFTP upload |
| `config.json` | you create on the server | typed in / SFTP |
| MySQL database | installed on the VPS | created below |

---

## 1. Create the VPS and log in

1. In hPanel → **VPS** → buy/select **KVM 2**, OS = **Ubuntu 22.04 (64-bit)**.
2. Set a root password when prompted; note the **IP address**.
3. From your PC (PowerShell), SSH in:

```powershell
ssh root@YOUR_VPS_IP
```

---

## 2. Install system packages

On the VPS:

```bash
apt update && apt upgrade -y

# Python + build tools + the native libs OpenCV/torch need + web server + db
apt install -y python3 python3-venv python3-pip git nginx \
  mysql-server build-essential cmake \
  libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 libgl1 \
  wget curl ca-certificates zstd
```

---

## 3. Get the code

```bash
cd /opt
git clone https://github.com/<your-username>/<your-repo>.git jissr
cd /opt/jissr
```

(If your repo is private, use a GitHub personal-access token in the URL, or
just upload the whole folder by SFTP like the model in step 4.)

---

## 4. Upload the model + landmarks (the git-ignored big files)

These are NOT in git. Upload them from **your PC** (open a new PowerShell
window, do NOT run this on the server):

```powershell
cd "C:\Users\Yuossf\Desktop\FYP\JSSIR-OM-main\JSSIR-OM-agj"

# 2.35 GB model checkpoint (this takes a while)
scp models\sentences_best_11pct.pth root@YOUR_VPS_IP:/opt/jissr/models/

# avatar landmark frames (recursive)
scp -r landmarks\* root@YOUR_VPS_IP:/opt/jissr/landmarks/
```

Back on the VPS, make sure the folders exist first if scp complained:

```bash
mkdir -p /opt/jissr/models /opt/jissr/landmarks
```

---

## 5. Set up MySQL (local database)

```bash
mysql
```

In the MySQL prompt, create the database and a user (use your own password):

```sql
CREATE DATABASE jissr_db CHARACTER SET utf8mb4;
CREATE USER 'jissr'@'localhost' IDENTIFIED BY 'StrongPasswordHere';
GRANT ALL PRIVILEGES ON jissr_db.* TO 'jissr'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

The app creates its tables automatically on first start (`init_db()`).

---

## 6. Create `config.json` on the server

```bash
cd /opt/jissr
nano config.json
```

Paste (matching the user/password from step 5):

```json
{
  "MYSQL_HOST": "localhost",
  "MYSQL_USER": "jissr",
  "MYSQL_PASSWORD": "StrongPasswordHere",
  "MYSQL_DATABASE": "jissr_db",
  "GOOGLE_CLIENT_ID": "530387255441-he5b8s6r7rscmppd4853388qaf26elh8.apps.googleusercontent.com",
  "APP_BASE_URL": "https://yourdomain.com"
}
```

Save with Ctrl+O, Enter, Ctrl+X.

---

## 7. Python environment + dependencies

```bash
cd /opt/jissr
python3 -m venv venv
source venv/bin/activate

pip install --upgrade pip
pip install -r requirements.txt
pip install decord==0.6.0
pip install ./unisign/demo/rtmlib-main

# Downloads the small RTMPose pose-estimation models (one time)
python download_models.py
```

---

## 8. (Optional) Chatbot — install Ollama

The help chatbot uses Ollama. If you skip this, everything else works and the
chat box just says "assistant offline".

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull llama3.2:1b
```

The app already defaults to `http://localhost:11434` and model `llama3.2`. To
match the 1b model you pulled, add this line to `/etc/environment` (or the
systemd unit below):

```
OLLAMA_MODEL=llama3.2:1b
```

---

## 9. First test run

```bash
cd /opt/jissr
source venv/bin/activate
python app.py
```

It will init the DB, load the 2.35 GB model (takes a minute), and serve on
port 10000. From your PC browser, visit `http://YOUR_VPS_IP:10000` to confirm
it loads. Then stop it with Ctrl+C and set it up as a service below.

---

## 10. Run it as a service (stays up, auto-restarts)

```bash
nano /etc/systemd/system/jissr.service
```

Paste:

```ini
[Unit]
Description=JISSR Flask app
After=network.target mysql.service

[Service]
WorkingDirectory=/opt/jissr
ExecStart=/opt/jissr/venv/bin/python /opt/jissr/app.py
Restart=always
Environment=PORT=10000
Environment=OLLAMA_MODEL=llama3.2:1b
User=root

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable --now jissr
systemctl status jissr        # should say "active (running)"
journalctl -u jissr -f        # live logs (Ctrl+C to exit)
```

---

## 11. Nginx reverse proxy (port 80 → app, with WebSocket support)

```bash
nano /etc/nginx/sites-available/jissr
```

Paste (WebSocket upgrade headers are required for live sign streaming):

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:10000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }
}
```

Enable it:

```bash
ln -s /etc/nginx/sites-available/jissr /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

---

## 12. Point your domain at the VPS

In your domain registrar (or Hostinger DNS), create an **A record**:

```
Type: A    Name: @    Value: YOUR_VPS_IP
```

(Optionally another A record `Name: www` → same IP.) Wait for DNS to
propagate (minutes to an hour). Test: `http://yourdomain.com`.

---

## 13. Free HTTPS (Let's Encrypt) — the "normal" replacement for Caddy

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

Follow the prompts; certbot edits the Nginx config and auto-renews. Your site
is now live at **https://yourdomain.com**.

---

## Updating later

```bash
cd /opt/jissr
git pull
source venv/bin/activate
pip install -r requirements.txt   # only if requirements changed
systemctl restart jissr
```

---

## Troubleshooting

- **App won't start / 502 from Nginx** → `journalctl -u jissr -f` to see the
  Python error.
- **DB errors** → re-check `config.json` user/password vs. step 5.
- **Model not found** → confirm `ls -lh /opt/jissr/models/` shows the 2.35 GB
  `.pth`; re-upload if the SFTP transfer was cut off.
- **Chatbot offline** → `systemctl status ollama`; make sure `ollama pull
  llama3.2:1b` finished.
- **Out of memory while loading model** → KVM 2 (8 GB) is enough for CPU
  inference; if you used a smaller plan, upgrade or add swap.
