#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Получение OAuth-токена Яндекс.Диска для загрузки таблицы заявок.

Как пользоваться:
  1. Создайте приложение: https://oauth.yandex.ru/client/new
     - Название: любое, например «Заявки с сайта»
     - Платформа: «Веб-сервисы»
     - Redirect URI: https://oauth.yandex.ru/verification_code
     - Права доступа: добавьте «Яндекс Диск» (чтение и запись)
     - Нажмите «Создать приложение» — на странице будут ClientID и Client secret.
  2. Запустите:  python yadisk_token.py
  3. Вставьте ClientID и Client secret, разрешите доступ в браузере,
     вставьте код подтверждения — скрипт напечатает токен.
  4. Запускайте сервер так:
       $env:YADISK_TOKEN = "токен из шага 3"
       python server.py
"""

import json
import sys
import urllib.parse
import urllib.request
import webbrowser

REDIRECT_URI = "https://oauth.yandex.ru/verification_code"
AUTHORIZE_URL = "https://oauth.yandex.ru/authorize"
TOKEN_URL = "https://oauth.yandex.ru/token"


def main():
    print("=== Получение токена Яндекс.Диска ===\n")
    client_id = input("ClientID приложения: ").strip()
    client_secret = input("Client secret: ").strip()
    if not client_id or not client_secret:
        print("Нужно указать ClientID и Client secret.")
        sys.exit(1)

    auth_url = AUTHORIZE_URL + "?" + urllib.parse.urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": "cloud_api:disk.read cloud_api:disk.write",
    })

    print("\nОткрываю страницу авторизации в браузере…")
    print("Если не открылась, перейдите сами:")
    print(auth_url)
    print("\nВойдите в Яндекс, нажмите «Войти» и разрешите доступ.")
    webbrowser.open(auth_url)

    code = input("\nВставьте код подтверждения, который показал Яндекс: ").strip()
    if not code:
        print("Код не введён.")
        sys.exit(1)

    data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(TOKEN_URL, data=data)
        with urllib.request.urlopen(req, timeout=30) as resp:
            tok = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        print("Не удалось обменять код на токен:", exc)
        sys.exit(1)

    access = tok.get("access_token", "")
    if not access:
        print("Яндекс вернул ошибку:", json.dumps(tok, ensure_ascii=False))
        sys.exit(1)

    print("\n=== Ваш токен (скопируйте целиком) ===")
    print(access)
    print("=======================================")
    print("\nДальше запускайте сервер так:")
    print('  $env:YADISK_TOKEN = "' + access + '"')
    print("  python server.py")
    print("\nТаблица «Заявки с сайта.xlsx» появится в корне Яндекс.Диска.")


if __name__ == "__main__":
    main()