FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 libgl1 wget git build-essential cmake && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir decord==0.6.0 && python -c "import decord; print('decord OK', decord.__version__)"

COPY unisign/demo/rtmlib-main /tmp/rtmlib-main
RUN pip install --no-cache-dir /tmp/rtmlib-main

COPY . .

RUN mkdir -p models

RUN python download_models.py

ENV PORT=8000
EXPOSE 8000

CMD ["python", "app.py"]
