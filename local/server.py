#!/usr/bin/env python3
"""Campus Action local web server. Uses only the Python standard library."""

import functools
import json
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"
CONFIG_PATH = ROOT / "config.json"
START_PORT = 8765
MAX_REQUEST_BYTES = 24 * 1024 * 1024
ALLOWED_API_HOSTS = {"open.bigmodel.cn", "api.deepseek.com"}


def validated_upstream_url(value):
    try:
        parsed = urllib.parse.urlsplit(str(value or "").strip())
    except ValueError:
        return ""
    if (
        parsed.scheme != "https"
        or parsed.hostname not in ALLOWED_API_HOSTS
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not parsed.path.endswith("/chat/completions")
    ):
        return ""
    return urllib.parse.urlunsplit(parsed)


def load_api_key():
    if not CONFIG_PATH.exists():
        return ""
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return ""
    return str(config.get("api_key", "")).strip()


def save_api_key(api_key):
    temporary_path = CONFIG_PATH.with_suffix(".json.tmp")
    temporary_path.write_text(
        json.dumps({"api_key": api_key}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary_path.replace(CONFIG_PATH)


class CampusHandler(SimpleHTTPRequestHandler):
    api_key = ""

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_json_error(self, status, message):
        self.send_json(status, {"error": {"message": message}})

    def is_same_origin(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        return origin.rstrip("/") == ("http://" + self.headers.get("Host", "")).rstrip("/")

    def read_json_body(self, maximum=MAX_REQUEST_BYTES):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("请求长度无效")
        if length <= 0 or length > maximum:
            raise ValueError("请求内容过大或为空")
        try:
            return self.rfile.read(length), length
        except OSError as error:
            raise ValueError("无法读取请求：{}".format(error))

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/config/status":
            self.send_json(200, {"configured": bool(self.api_key)})
            return
        super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path not in ("/api/chat", "/api/config"):
            self.send_json_error(404, "未找到该接口")
            return
        if not self.is_same_origin():
            self.send_json_error(403, "只允许本地网页修改配置")
            return
        try:
            request_body, _ = self.read_json_body(16 * 1024 if path == "/api/config" else MAX_REQUEST_BYTES)
            payload = json.loads(request_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self.send_json_error(400, "请求内容不是有效 JSON")
            return
        except ValueError as error:
            self.send_json_error(400, str(error))
            return

        if path == "/api/config":
            api_key = str(payload.get("api_key", "")).strip() if isinstance(payload, dict) else ""
            if not api_key:
                self.send_json_error(400, "API Key 不能为空")
                return
            try:
                save_api_key(api_key)
            except OSError as error:
                self.send_json_error(500, "无法保存 API Key：{}".format(error))
                return
            CampusHandler.api_key = api_key
            self.send_json(200, {"configured": True})
            print("API Key 已从网页保存到本地 config.json。")
            return

        if not self.api_key:
            self.send_json_error(503, "尚未配置 API Key，请先在设置窗口中填写")
            return

        upstream_url = validated_upstream_url(self.headers.get("X-Campus-Api-Url"))
        if not upstream_url:
            self.send_json_error(400, "识别服务地址无效或不在允许列表中")
            return

        upstream_request = urllib.request.Request(
            upstream_url,
            data=request_body,
            headers={
                "Authorization": "Bearer " + self.api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "Campus-Action-Local/1.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(upstream_request, timeout=65) as response:
                body = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                self.send_json_error(429, "当前使用人数较多，请稍后重试")
                return
            body = error.read()
            try:
                json.loads(body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                body = json.dumps(
                    {"error": {"message": "识别服务返回错误（{}）".format(error.code)}},
                    ensure_ascii=False,
                ).encode("utf-8")
            self.send_response(error.code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except urllib.error.URLError as error:
            reason = getattr(error, "reason", error)
            self.send_json_error(502, "无法连接识别服务：{}".format(reason))
        except TimeoutError:
            self.send_json_error(504, "识别服务连接超时，请重试")
        except Exception as error:  # Keep terminal users from seeing an HTML traceback page.
            self.send_json_error(500, "本地代理请求失败：{}".format(error))

    def log_message(self, message, *args):
        print("[%s] %s" % (self.log_date_time_string(), message % args))


def make_server(api_key):
    CampusHandler.api_key = api_key
    handler = functools.partial(CampusHandler, directory=str(DIST_DIR))
    for port in range(START_PORT, START_PORT + 50):
        try:
            return ThreadingHTTPServer(("127.0.0.1", port), handler), port
        except OSError:
            continue
    raise RuntimeError("未找到可用的本地端口")


def main():
    if not DIST_DIR.is_dir():
        print("未找到 dist 网页文件，请重新解压完整压缩包。")
        input("按回车键退出……")
        return 1

    try:
        server, port = make_server(load_api_key())
    except RuntimeError as error:
        print(error)
        input("按回车键退出……")
        return 1

    url = "http://127.0.0.1:{}/".format(port)
    print("\n校园活动助手已启动：{}".format(url))
    if not CampusHandler.api_key:
        print("尚未配置 API Key，请在浏览器弹窗中填写。")
    print("浏览器将自动打开。使用完毕后，关闭此窗口即可退出。\n")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出。")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
