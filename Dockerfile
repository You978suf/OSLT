FROM python:3.10-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    wget \
    git \
    build-essential \
    cmake \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir decord || \
    pip install --no-cache-dir eva-decord

COPY unisign/demo/rtmlib-main /tmp/rtmlib-main
RUN pip install --no-cache-dir /tmp/rtmlib-main

COPY . .

RUN mkdir -p models

EXPOSE 10000

CMD ["python", "app.py"]
