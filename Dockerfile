FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 libgl1 wget curl ca-certificates git build-essential cmake procps zstd && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir decord==0.6.0 && python -c "import decord; print('decord OK', decord.__version__)"

COPY unisign/demo/rtmlib-main /tmp/rtmlib-main
RUN pip install --no-cache-dir /tmp/rtmlib-main

# Install Ollama and pre-pull the help-chat model so no first-request download is needed.
ENV OLLAMA_MODELS=/root/.ollama/models
RUN curl -fsSL https://ollama.com/install.sh | sh
RUN set -eux; \
    (ollama serve >/tmp/ollama-build.log 2>&1 &) ; \
    for i in $(seq 1 30); do \
        curl -sf http://127.0.0.1:11434/api/tags >/dev/null && break || sleep 1; \
    done; \
    ollama pull llama3.2:1b; \
    pkill -f "ollama serve" || true; \
    sleep 2

COPY . .

RUN mkdir -p models

RUN python download_models.py

# Default chat backend points at the in-container Ollama
ENV OLLAMA_BASE_URL=http://127.0.0.1:11434
ENV OLLAMA_MODEL=llama3.2:1b

ENV PORT=8000
EXPOSE 8000

# Make entrypoint executable and use it (boots Ollama in background, then Flask)
RUN chmod +x /app/docker-entrypoint.sh
CMD ["/app/docker-entrypoint.sh"]
