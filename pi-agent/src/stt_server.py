import argparse
import os
import shutil
from typing import Annotated

import uvicorn
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

app = FastAPI(title="Pi Agent STT Service", version="1.0.0")

# 全局模型引用
model = None

class STTResponse(BaseModel):
    text: str

@app.on_event("startup")
def load_model():
    global model
    print("[STT Server] 正在加载 SenseVoice 模型至内存...")
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"[STT Server] 使用设备: {device}")
        from funasr import AutoModel
        # SenseVoiceSmall 是目前中英文混合极速识别的最佳选择
        # remote_code 仅当本地缓存目录存在时传入（跳过远端代码拉取），否则用 funasr 内置实现
        kwargs = {
            "model": "iic/SenseVoiceSmall",
            "trust_remote_code": True,
            "device": device,
            "disable_update": True,  # 生产环境防止每次都去远端检查更新
        }
        if os.path.isdir("./model_dir"):
            kwargs["remote_code"] = "./model_dir"
        model = AutoModel(**kwargs)
        print("[STT Server] SenseVoice 模型加载完成！")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[STT Server] 模型加载失败，请确保安装了 funasr/torch 且网络正常: {e}")
        # 这里不直接抛出异常，允许服务启动，但在请求时会报错

@app.post("/transcribe", response_model=STTResponse)
async def transcribe_audio(file: Annotated[UploadFile, File()]):
    global model
    if model is None:
        raise HTTPException(status_code=500, detail="模型未加载成功，请检查服务器日志。")

    # 将上传的文件保存到临时路径（basename 防路径穿越）
    from pathlib import Path
    temp_file_path = f"/tmp/{Path(file.filename).name}"
    try:
        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        print(f"[STT Server] 接收到音频: {file.filename}, 开始识别...")

        # SenseVoice 推理
        res = model.generate(
            input=temp_file_path,
            cache={},
            language="auto",
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=15,
        )

        # 解析返回结果
        if len(res) > 0 and 'text' in res[0]:
            # SenseVoice 返回的 text 含语种和情感标签，如
            # "<|zh|><|NEUTRAL|><|Speech|> 帮我查一下代码"，这里清洗标签提取核心文本
            raw_text = res[0]['text']
            import re
            clean_text = re.sub(r'<\|.*?\|>', '', raw_text).strip()
            print(f"[STT Server] 识别结果: {clean_text}")
            return STTResponse(text=clean_text)
        else:
            print("[STT Server] 识别结果为空")
            return STTResponse(text="")

    except Exception as e:
        print(f"[STT Server] 转录失败: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001, help="Port to run the STT server on")
    args = parser.parse_args()

    print(f"启动 STT 服务，端口: {args.port}")
    uvicorn.run(app, host="127.0.0.1", port=args.port)
