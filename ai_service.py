import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

from ai_rules import SYSTEM_PROMPT
from catalog import PRODUCTS


load_dotenv(Path(__file__).resolve().parent / ".env")

API_URL = "https://openrouter.ai/api/v1/chat/completions"

# Описываем формат ответа, который ожидаем от модели.
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
                        "без Markdown. До 150 слов."
                    ),
                },
                "product_ids": {
                    "type": "array",
                    "items": {"type": "integer"},
                    "description": (
                        "До 3 ID рекомендуемых ПК из каталога. "
                        "Пустой список, если рекомендация не нужна."
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


def validate_result(result):
    # Проверяем ответ даже при использовании JSON Schema.
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

    catalog_ids = {product["id"] for product in PRODUCTS}

    # Не допускаем несуществующие товары.
    if any(item not in catalog_ids for item in product_ids):
        raise AIError("ИИ предложил товар, которого нет в каталоге.")

    # Убираем повторяющиеся ID, сохраняя порядок.
    unique_ids = list(dict.fromkeys(product_ids))

    return {
        "answer": answer.strip(),
        "product_ids": unique_ids,
    }


def ask_ai(history):
    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    model = os.getenv("OPENROUTER_MODEL", "openrouter/free").strip()

    if not key:
        raise AIError("На сервере не настроен API-ключ.")

    catalog_text = json.dumps(PRODUCTS, ensure_ascii=False)

    messages = [
        {
            "role": "system",
            "content": (
                SYSTEM_PROMPT
                + "\n\nКаталог Iron в формате JSON:\n"
                + catalog_text
            ),
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
        raise AIError("ИИ не успел ответить. Попробуй ещё раз.") from None
    except requests.RequestException:
        raise AIError("Не удалось связаться с ИИ.") from None

    if response.status_code in (401, 403):
        raise AIError("Ошибка доступа к API. Проверь ключ и настройки.")

    if response.status_code == 402:
        raise AIError("Запрос отклонён из-за баланса или лимита.")

    if response.status_code == 429:
        raise AIError("Лимит OpenRouter исчерпан. Попробуй позже.")

    if response.status_code >= 400:
        raise AIError(
            "Не удалось получить ответ в нужном формате. "
            "Возможно, подходящая модель сейчас недоступна."
        )

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]

        if not isinstance(content, str):
            raise ValueError

        result = json.loads(content)
    except (ValueError, KeyError, IndexError, TypeError):
        raise AIError("ИИ вернул некорректный JSON.") from None

    return validate_result(result)