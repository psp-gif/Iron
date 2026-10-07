from flask import Blueprint, jsonify, request
from flask_limiter import Limiter
from catalog import PRODUCTS
from flask_limiter.util import get_remote_address

from ai_service import AIError, ask_ai


ai_blueprint = Blueprint("ai", __name__)

# Ограничения для локальной версии с одним процессом сервера.
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri="memory://",
)

MAX_MESSAGES = 12
MAX_MESSAGE_LENGTH = 4000
MAX_HISTORY_LENGTH = 16000


def validate_history(history):
    if not isinstance(history, list):
        return False

    if not 1 <= len(history) <= MAX_MESSAGES:
        return False

    total_length = 0

    for index, message in enumerate(history):
        if not isinstance(message, dict):
            return False

        # Разрешаем только чередование пользователь → помощник.
        expected_role = "user" if index % 2 == 0 else "assistant"

        if message.get("role") != expected_role:
            return False

        content = message.get("content")

        if not isinstance(content, str):
            return False

        if not content.strip() or len(content) > MAX_MESSAGE_LENGTH:
            return False

        total_length += len(content)

    return (
        history[-1]["role"] == "user"
        and total_length <= MAX_HISTORY_LENGTH
    )


@ai_blueprint.post("/api/chat")
@limiter.limit("5 per minute; 100 per day")
def chat():
    if not request.is_json:
        return jsonify(error="Ожидается запрос в формате JSON."), 415

    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify(error="Некорректный запрос."), 400

    history = data.get("messages")

    if not validate_history(history):
        return jsonify(
            error="Некорректная или слишком длинная история. Начни новый чат."
        ), 400

    # Не передаём дополнительные поля из пользовательского запроса.
    clean_history = [
        {"role": message["role"], "content": message["content"]}
        for message in history
    ]
    
    try:
        result = ask_ai(clean_history)
    except AIError as error:
        return jsonify(error=str(error)), 503

    catalog_by_id = {
        product["id"]: product
        for product in PRODUCTS
    }

    recommended_products = [
        catalog_by_id[product_id]
        for product_id in result["product_ids"]
    ]

    return jsonify(
        answer=result["answer"],
        product_ids=result["product_ids"],
        products=recommended_products,
    )


@ai_blueprint.errorhandler(429)
def too_many_requests(error):
    return jsonify(
        error="Слишком много сообщений. Подожди минуту; если достигнут дневной лимит — попробуй завтра."
    ), 429