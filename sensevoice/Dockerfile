FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends curl bzip2 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# SenseVoice int8 模型（155MB，中文+情绪+事件）
RUN curl -L --retry 3 -o model.tar.bz2 \
    https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2 \
    && tar xjf model.tar.bz2 \
    && rm model.tar.bz2

COPY server.py .

ENV PORT=8080
EXPOSE 8080

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
