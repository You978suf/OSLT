#!/usr/bin/env bash
set -e

# Start Ollama in the background; log goes to a file the Flask app can ignore.
echo "[entrypoint] starting ollama serve..."
nohup ollama serve >/tmp/ollama.log 2>&1 &

# Wait until Ollama is reachable (up to ~30s) before launching Flask.
for i in $(seq 1 30); do
    if curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
        echo "[entrypoint] ollama is ready"
        break
    fi
    sleep 1
done

# Pre-warm the model so the first user chat is fast (best-effort, never fails the boot).
( curl -sf -X POST http://127.0.0.1:11434/api/generate \
    -H "Content-Type: application/json" \
    -d '{"model":"llama3.2:3b","prompt":"hi","stream":false}' >/dev/null 2>&1 || true ) &

echo "[entrypoint] starting Flask app..."
exec python app.py
