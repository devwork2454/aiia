import os
from fastapi import FastAPI, Request
from dotenv import load_dotenv
import lark_oapi as lark
from lark_oapi.api.im.v1 import P2MessageReceiveV1

# 加载环境变量
load_dotenv()

APP_ID = os.getenv("FEISHU_APP_ID", "")
APP_SECRET = os.getenv("FEISHU_APP_SECRET", "")
VERIFICATION_TOKEN = os.getenv("FEISHU_VERIFICATION_TOKEN", "")
ENCRYPT_KEY = os.getenv("FEISHU_ENCRYPT_KEY", "")

app = FastAPI(title="Antigravity Feishu Bot")

# 飞书事件处理的回调函数
def do_p2_im_message_receive_v1(data: P2MessageReceiveV1) -> None:
    message = data.event.message
    msg_type = message.message_type
    
    # 飞书的语音消息可以直接转成文字。如果是文本/转录文字，我们可以在这里提取
    # 并将其传递给 Antigravity CLI 或 SDK
    content = message.content
    print(f"收到新消息, 类型: {msg_type}, 内容: {content}")
    
    # TODO: 在这里通过 subprocess 调用 `agy --prompt "{content}"`
    # 或者调用 antigravity-sdk-python

# 构建飞书事件分发器
event_handler = lark.EventDispatcherHandler.builder(VERIFICATION_TOKEN, ENCRYPT_KEY) \
    .register_p2_im_message_receive_v1(do_p2_im_message_receive_v1) \
    .build()

@app.post("/webhook/event")
async def feishu_event_webhook(request: Request):
    """
    飞书开放平台配置的事件订阅接口
    """
    # 将 FastAPI 请求转换为 Lark SDK 可处理的请求对象
    body = await request.body()
    headers = dict(request.headers)
    
    req = lark.BaseRequest()
    req.body = body
    req.headers = headers
    req.method = request.method
    req.uri = request.url.path
    
    # 处理请求并返回给飞书
    resp = event_handler.do(req)
    return {
        "status_code": resp.status_code,
        "headers": resp.headers,
        "body": resp.body,
    }

if __name__ == "__main__":
    import uvicorn
    # 本地启动服务，端口 8000
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
