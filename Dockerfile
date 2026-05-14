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
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY unisign/demo/rtmlib-main /tmp/rtmlib-main
RUN pip install --no-cache-dir /tmp/rtmlib-main

COPY . .

RUN mkdir -p models

EXPOSE 5000

<<<<<<< HEAD
CMD ["python", "app.py"]
=======
CMD ["python", "app.py"]
>>>>>>> 1bd6f80c5220bd4f15d2ff553eee65cd5bb5cba0
