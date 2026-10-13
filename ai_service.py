import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

from ai_rules import get_system_prompt
from catalog import PRODUCTS


load_dotenv(Path(__file__).resolve().parent / ".env")

API_URL = "https://openrouter.ai/api/v1/chat/completions"

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "iron_consultation",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "answer": {
                    "type": "string",
                    "description": (
                        "Краткий ответ на русском обычным текстом, "
                        "без Markdown. Обычно до 150 слов."
                    ),
                },
                "product_ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": (
                        "До 3 ID рекомендуемых ПК из каталога. "
                        "Пустой список, если рекомендация не нужна "
                        "или включён режим выкупа."
                    ),
                },
            },
            "required": ["answer", "product_ids"],
            "additionalProperties": False,
        },
    },
}


class AIError(Exception):
    """Ошибка, которую можно показать пользователю."""


def validate_result(result, mode="consult"):
    if not isinstance(result, dict):
        raise AIError("ИИ вернул некорректный формат ответа.")

    answer = result.get("answer")
    product_ids = result.get("product_ids")

    if (
        not isinstance(answer, str)
        or not answer.strip()
        or len(answer) > 3000
    ):
        raise AIError("ИИ вернул пустой или слишком длинный ответ.")

    if (
        not isinstance(product_ids, list)
        or len(product_ids) > 3
        or any(type(item) is not int for item in product_ids)
    ):
        raise AIError("ИИ вернул некорректные рекомендации.")

    # В режиме выкупа карточки товаров не используются.
    if mode == "sell":
        return {
            "answer": answer.strip(),
            "product_ids": [],
        }

    technical_markers = (
        "'role':",
        '"role":',
        "'product_ids':",
        '"product_ids":',
    )

    if any(marker in answer for marker in technical_markers):
        raise AIError(
            "ИИ вернул служебные данные вместо ответа. "
            "Попробуй отправить сообщение ещё раз."
        )

    catalog_ids = {product["id"] for product in PRODUCTS}

    if any(item not in catalog_ids for item in product_ids):
        raise AIError("ИИ предложил товар, которого нет в каталоге.")

    return {
        "answer": answer.strip(),
        "product_ids": list(dict.fromkeys(product_ids)),
    }


def ask_ai(history, mode="consult"):
    if mode not in ("consult", "sell"):
        raise AIError("Неизвестный режим помощника.")

    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", "openrouter/free").strip()

    if not key:
        raise AIError("На сервере не настроен API-ключ.")

    system_prompt = get_system_prompt(mode)

    if mode == "consult":
        catalog_text = json.dumps(PRODUCTS, ensure_ascii=False)
        system_prompt += "\n\nКаталог Iron в формате JSON:\n" + catalog_text

    messages = [
        {
            "role": "system",
            "content": system_prompt,
        },
        *history,
    ]

    try:
        response = requests.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "X-OpenRouter-Title": "Iron",
            },
            json={
                "model": model,
                "messages": messages,
                "max_tokens": 1500,
                "temperature": 0.3,
                "response_format": RESPONSE_FORMAT,
                "provider": {
                    "require_parameters": True,
                },
            },
            timeout=(10, 60),
        )
    except requests.Timeout:
        raise AIError(
            "ИИ не успел ответить. Попробуй отправить сообщение ещё раз."
        ) from None
    except requests.RequestException:
        raise AIError(
            "Не удалось связаться с ИИ. Попробуй позже."
        ) from None

    if response.status_code in (401, 403):
        raise AIError(
            "Нет доступа к ИИ. Проверь настройки API-ключа на сервере."
        )

    if response.status_code == 402:
        raise AIError("Сервис ИИ сообщил о недостаточном балансе.")

    if response.status_code == 429:
        raise AIError(
            "Сервис ИИ достиг лимита запросов. Попробуй позже."
        )

    if response.status_code >= 400:
        raise AIError(
            "Не удалось получить ответ в нужном формате. "
            "Возможно, подходящая модель сейчас недоступна."
        )

    try:
        payload = response.json()
        content = payload["choices"][0]["message"]["content"]

        if not isinstance(content, str):
            raise ValueError("Ответ должен быть строкой.")

        result = json.loads(content)
    except (ValueError, KeyError, IndexError, TypeError):
        raise AIError(
            "ИИ вернул некорректный JSON. Попробуй ещё раз."
        ) from None

    return validate_result(result, mode=mode)