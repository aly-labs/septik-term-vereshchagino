#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Локальный сервер сайта «ТЕРМИТ Верещагино».

Что делает:
  1) Раздаёт статические файлы (index.html, css, js, data, img).
  2) Принимает заявки на POST /api/lead.
     - Всегда сохраняет заявку в leads.jsonl (чтобы она не потерялась).
     - Если задана переменная окружения N8N_WEBHOOK_URL — пересылает заявку в n8n
       (Telegram / CRM / таблица настраиваются уже внутри n8n).
  3) ЧПУ: /catalog/<slug> отдаёт index.html и подставляет в <title>/<meta>
     название модели для поисковиков.

СЕКРЕТЫ ХРАНЯТСЯ ТОЛЬКО ЗДЕСЬ, В ПЕРЕМЕННЫХ ОКРУЖЕНИЯ, И НЕ ПОПАДАЮТ В БРАУЗЕР.

Запуск:
    python server.py
    открыть http://localhost:8000

Настройка n8n (пример для Windows PowerShell в текущей сессии):
    $env:N8N_WEBHOOK_URL = "https://ВАШ-ДОМЕН/webhook/ВАШ-ID"
    python server.py

Переменные окружения:
    PORT               — порт (по умолчанию 8000)
    N8N_WEBHOOK_URL    — URL вебхука n8n (если пусто — только локальное сохранение)
    N8N_AUTH_HEADER    — необязательный заголовок Authorization для вебхука
"""

import datetime
import json
import os
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8000"))
WEBHOOK_URL = (os.environ.get("N8N_WEBHOOK_URL") or "").strip()
AUTH_HEADER = (os.environ.get("N8N_AUTH_HEADER") or "").strip()
LEADS_FILE = os.path.join(BASE_DIR, "leads.jsonl")
CATALOG_FILE = os.path.join(BASE_DIR, "data", "catalog.json")

TITLE_RE = re.compile(r"<title>.*?</title>", re.S)
DESC_RE = re.compile(r'<meta name="description" content=".*?"', re.S)


def load_catalog():
    try:
        with open(CATALOG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:  # noqa: BLE001
        print("[catalog] не удалось прочитать catalog.json:", exc, file=sys.stderr)
        return {"items": []}


CATALOG = load_catalog()


def log(*args):
    print("[server]", *args, flush=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    # ---------- утилиты ----------
    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_index(self, slug=None, inject_base=False):
        try:
            with open(os.path.join(BASE_DIR, "index.html"), "r", encoding="utf-8") as f:
                html = f.read()
        except OSError:
            self.send_error(404, "index.html не найден")
            return

        if inject_base:
            html = html.replace("<head>", '<head>\n  <base href="/">', 1)

        if slug:
            item = next((i for i in CATALOG.get("items", []) if i.get("slug") == slug), None)
            if item:
                title = f'{item["name"]} — цена и монтаж в Верещагино | ТЕРМИТ'
                desc = (f'{item["name"]}: характеристики, цена на оборудование и расчёт монтажа '
                        f'в Верещагино и районе. Оставьте заявку на консультацию.')
                html = TITLE_RE.sub(f"<title>{title}</title>", html, count=1)
                html = DESC_RE.sub(f'<meta name="description" content="{desc}"', html, count=1)

        body = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---------- GET ----------
    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path in ("/", "/index.html"):
            self.send_index()
            return

        # ЧПУ страниц каталога: /catalog/<slug>
        m = re.match(r"^/catalog/([^/]+)/?$", path)
        if m:
            self.send_index(slug=urllib.parse.unquote(m.group(1)), inject_base=True)
            return

        # SPA-фолбэк: неизвестный путь без расширения → index.html
        if "." not in os.path.basename(path):
            self.send_index(inject_base=True)
            return

        return super().do_GET()

    # ---------- POST ----------
    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/lead":
            self.send_json(404, {"ok": False, "error": "Не найдено"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else ""
            data = json.loads(raw) if raw else {}
            if not isinstance(data, dict):
                raise ValueError("ожидался объект JSON")
        except Exception as exc:  # noqa: BLE001
            log("отклонена некорректная заявка:", exc)
            self.send_json(400, {"ok": False, "error": "Некорректные данные"})
            return

        name = str(data.get("name", "")).strip()
        phone = str(data.get("phone", "")).strip()
        digits = re.sub(r"\D", "", phone)
        if not name or len(digits) < 10:
            self.send_json(422, {"ok": False, "error": "Укажите имя и корректный телефон"})
            return

        lead = {
            "receivedAt": datetime.datetime.now().isoformat(timespec="seconds"),
            "type": data.get("type", ""),
            "model": data.get("model", ""),
            "name": name,
            "phone": phone,
            "city": data.get("city", ""),
            "comment": data.get("comment", ""),
            "answers": data.get("answers", {}),
            "page": data.get("page", ""),
            "userAgent": self.headers.get("User-Agent", ""),
        }

        # 1) Всегда сохраняем локально — заявка не теряется.
        try:
            with open(LEADS_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(lead, ensure_ascii=False) + "\n")
        except OSError as exc:
            log("ОШИБКА записи leads.jsonl:", exc)

        # 2) Пересылаем в n8n, если настроено.
        forwarded = False
        if WEBHOOK_URL:
            try:
                req = urllib.request.Request(
                    WEBHOOK_URL,
                    data=json.dumps(lead, ensure_ascii=False).encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                if AUTH_HEADER:
                    req.add_header("Authorization", AUTH_HEADER)
                with urllib.request.urlopen(req, timeout=12, context=ssl.create_default_context()) as resp:
                    forwarded = 200 <= resp.status < 300
                if not forwarded:
                    log("n8n вернул статус", resp.status)
            except urllib.error.URLError as exc:
                log("ОШИБКА отправки в n8n:", exc)
            except Exception as exc:  # noqa: BLE001
                log("ОШИБКА отправки в n8n:", exc)
        else:
            log("N8N_WEBHOOK_URL не задан — заявка сохранена локально в leads.jsonl")

        log(f"заявка: {lead['type'] or 'заявка'} · {name} · {phone} · n8n={'ok' if forwarded else 'нет'}")
        self.send_json(200, {"ok": True, "forwarded": forwarded})

    def log_message(self, fmt, *args):  # тише в консоли
        return


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    log(f"сайт запущен:  http://localhost:{PORT}")
    log(f"n8n-вебхук:    {WEBHOOK_URL or 'не задан (заявки сохраняются в leads.jsonl)'}")
    log(f"файл заявок:   {LEADS_FILE}")
    log("остановить сервер: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("остановлено")
        server.shutdown()


if __name__ == "__main__":
    main()
