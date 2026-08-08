"""Legacy entrypoint — prefer `python -m adapter.feishu_app` or uvicorn adapter.feishu_app:app."""

from adapter.feishu_app import app

__all__ = ["app"]

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("adapter.feishu_app:app", host="0.0.0.0", port=8000, reload=True)
