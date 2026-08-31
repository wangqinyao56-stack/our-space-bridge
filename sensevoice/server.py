"""
SenseVoice 情绪识别服务（听语气）
sherpa-onnx 轻量 CPU 推理（无 torch），识别文字 + 情绪 + 音频事件。
POST /recognize 收原始 PCM16 16kHz mono 字节，返回 { text, emotion, events }。
"""

import os
import re

import numpy as np
import sherpa_onnx
from fastapi import FastAPI, Request

MODEL_DIR = os.environ.get("MODEL_DIR", "/app/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17")
MODEL = os.path.join(MODEL_DIR, "model.int8.onnx")
TOKENS = os.path.join(MODEL_DIR, "tokens.txt")

EMOTION_TAGS = {
    "HAPPY": "开心",
    "SAD": "难过",
    "ANGRY": "生气",
    "NEUTRAL": "平静",
    "FEARFUL": "害怕",
    "DISGUSTED": "厌恶",
    "SURPRISED": "惊讶",
}

EVENT_TAGS = {
    "BGM": "背景音乐",
    "Laughter": "笑声",
    "Cry": "哭声",
    "Breath": "呼吸声",
    "Cough": "咳嗽",
    "Sneeze": "打喷嚏",
    "Applause": "掌声",
    "Yawn": "哈欠",
    "Gasp": "喘息",
}

recognizer = None


def get_recognizer():
    global recognizer
    if recognizer is None:
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=MODEL,
            tokens=TOKENS,
            use_itn=True,
            debug=False,
        )
    return recognizer


app = FastAPI()


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/recognize")
async def recognize(request: Request):
    body = await request.body()
    if not body:
        return {"text": "", "emotion": None, "events": []}
    sample_rate = int(request.headers.get("x-sample-rate", "16000"))
    samples = np.frombuffer(body, dtype=np.int16).astype(np.float32) / 32768.0

    rec = get_recognizer()
    stream = rec.create_stream()
    stream.accept_waveform(sample_rate, samples)
    rec.decode_stream(stream)
    raw_text = (stream.result.text or "") if stream.result else ""

    # SenseVoice 输出里情绪/事件以 <|TAG|> 形式嵌在文本里
    tags = re.findall(r"<\|([^|]+)\|>", raw_text)
    emotion = None
    events = []
    for t in tags:
        if t in EMOTION_TAGS:
            if emotion is None:
                emotion = {"tag": t, "label": EMOTION_TAGS[t]}
        elif t in EVENT_TAGS:
            events.append({"tag": t, "label": EVENT_TAGS[t]})

    clean_text = re.sub(r"<\|[^|]+\|>", "", raw_text).strip()

    return {"text": clean_text, "emotion": emotion, "events": events, "raw": raw_text}
