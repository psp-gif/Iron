import json
import os
import secrets
import time
from contextlib import contextmanager
from copy import deepcopy
from threading import Lock

import requests
from flask import Blueprint, current_app, jsonify, request, session

from ai_routes import limiter
from catalog import PRODUCTS


checkout_blueprint = Blueprint("checkout", __name__)

OS_OPTIONS = [
    "Windows 11",
    "Ubuntu",
    "Linux Mint",
    "Без ОС",
]

WAREHOUSES = {
    "Астана": "Учебный склад Iron в Астане",
    "Алматы": "Учебный склад Iron в Алматы",
}

PAYMENTS = [
    "Visa / Mastercard",
    "Apple Pay",
    "Google Pay",
]

TTL = 3600

orders = {}
registry_lock = Lock()


class CheckoutError(Exception):
    """Ошибка с понятным сообщением, HTTP-статусом и кодом."""

    def __init__(self, message, status=400, code="invalid_request"):
        super().__init__(message)
        self.status = status
        self.code = code


@checkout_blueprint.errorhandler(CheckoutError)
def handle_error(error):
    return jsonify(
        error=str(error),
        code=error.code,
    ), error.status


@checkout_blueprint.errorhandler(429)
def handle_limit(error):
    return jsonify(
        error="Достигнут лимит запросов. Попробуй позже.",
        code="local_rate_limit",
    ), 429


@checkout_blueprint.before_request
def check_request():
    if request.headers.get("X-Iron-Request") != "checkout":
        raise CheckoutError(
            "Некорректный запрос оформления.",
            403,
        )

    if not request.is_json:
        raise CheckoutError("Ожидается JSON.", 415)

    if not isinstance(request.get_json(silent=True), dict):
        raise CheckoutError("Ожидается JSON-объект.")


def normalize_city(city):
    names = {
        "астана": "Астана",
        "astana": "Астана",
        "алматы": "Алматы",
        "almaty": "Алматы",
    }

    return names.get(city.strip().casefold(), city.strip())


def missing_fields(order):
    missing = []

    if (
        order["os"] not in OS_OPTIONS
        or not order["os_confirmed"]
    ):
        missing.append("Выбери и подтверди ОС")

    if order["shipping"] not in ("delivery", "pickup"):
        missing.append("Выбери доставку или самовывоз")

    if len(order["city"]) < 2:
        missing.append("Укажи город в Казахстане")
    elif (
        order["shipping"] == "pickup"
        and order["city"] not in WAREHOUSES
    ):
        missing.append("Для самовывоза выбери Астану или Алматы")

    if (
        order["shipping"] == "delivery"
        and len(order["address"]) < 5
    ):
        missing.append("Укажи адрес доставки")

    if order["wishes"] is None:
        missing.append("Укажи пожелания или напиши, что их нет")

    return missing


def public_order(order):
    subtotal = sum(
        product["price"] * product["quantity"]
        for product in order["items"]
    )

    shipping = order["shipping"]
    city = order["city"]

    delivery_known = (
        (shipping == "delivery" and len(city) >= 2)
        or (shipping == "pickup" and city in WAREHOUSES)
    )

    delivery = 0

    if (
        shipping == "delivery"
        and city
        and city not in WAREHOUSES
    ):
        delivery = 5000

    missing = missing_fields(order)

    fields = (
        "id",
        "items",
        "os",
        "os_confirmed",
        "shipping",
        "city",
        "address",
        "wishes",
        "status",
        "payment",
        "messages",
    )

    result = {
        key: deepcopy(order[key])
        for key in fields
    }

    result.update(
        warehouse=(
            WAREHOUSES.get(city, "")
            if shipping == "pickup"
            else ""
        ),
        subtotal=subtotal,
        delivery=delivery,
        total=subtotal + delivery,
        delivery_known=bool(delivery_known),
        missing=missing,
        ready=not missing,
        os_options=OS_OPTIONS,
        payment_options=PAYMENTS,
    )

    return result


def append_messages(order, user, answer):
    order["messages"].extend([
        {"role": "user", "content": user},
        {"role": "assistant", "content": answer},
    ])

    order["messages"] = order["messages"][-20:]


def next_step(order):
    """Следующий вопрос определяется состоянием заказа."""

    if not order["os"]:
        return "Выбери ОС в панели ниже."

    if not order["os_confirmed"]:
        return (
            f"Выбрано: {order['os']}. "
            "Подтверди ОС или выбери другую. "
            "Изменить её можно до подтверждения заказа."
        )

    missing = missing_fields(order)

    if missing:
        return "Следующий шаг: " + missing[0] + "."

    return (
        "Данные заполнены. Проверь сводку и нажми "
        "«Подтвердить заказ», если всё верно."
    )


def readable_answer(order, answer):
    """Не показываем технический JSON вместо сообщения."""

    text = answer.strip()

    technical = (
        text.startswith(("{", "[", "```"))
        or any(
            f'"{key}"' in text
            for key in (
                "shipping",
                "change_os",
                "confirm_os",
                "answer",
                "product_ids",
            )
        )
    )

    if not text or technical:
        return next_step(order)

    return text


def get_order():
    with registry_lock:
        order = orders.get(session.get("checkout_token"))

    if order is None:
        raise CheckoutError(
            "Оформление не найдено. Вернись в корзину.",
            410,
            "order_expired",
        )

    return order


@contextmanager
def locked_order(order):
    """Не разрешаем одновременно изменять один заказ."""

    if not order["lock"].acquire(blocking=False):
        raise CheckoutError(
            "Предыдущий запрос ещё обрабатывается.",
            409,
            "order_busy",
        )

    try:
        if order["expires"] <= time.time():
            raise CheckoutError(
                "Оформление истекло. Начни снова из корзины.",
                410,
                "order_expired",
            )

        yield
    finally:
        order["lock"].release()


@checkout_blueprint.post("/api/checkout/start")
@limiter.limit("30 per minute")
def start():
    cart = request.get_json().get("cart")

    # Обновление страницы после оплаты и очистки корзины.
    if cart == {}:
        previous = get_order()

        with locked_order(previous):
            if previous["status"] == "paid":
                return jsonify(order=public_order(previous))

        raise CheckoutError("Корзина пуста.")

    if not isinstance(cart, dict) or not 1 <= len(cart) <= 50:
        raise CheckoutError(
            "Корзина пуста или имеет неверный формат."
        )

    catalog = {
        str(product["id"]): product
        for product in PRODUCTS
    }

    items = []

    for product_id, quantity in cart.items():
        if (
            product_id not in catalog
            or type(quantity) is not int
            or not 1 <= quantity <= 10
        ):
            raise CheckoutError(
                "Неизвестный товар или неверное количество."
            )

        items.append({
            **deepcopy(catalog[product_id]),
            "quantity": quantity,
        })

    items.sort(key=lambda product: product["id"])
    now = time.time()

    with registry_lock:
        # Не удаляем заказ во время обработки его запроса.
        for token, old in list(orders.items()):
            if (
                old["expires"] <= now
                and old["lock"].acquire(blocking=False)
            ):
                try:
                    del orders[token]
                finally:
                    old["lock"].release()

        previous = orders.get(session.get("checkout_token"))

    if previous:
        with locked_order(previous):
            if (
                previous["items"] == items
                and previous["status"] != "paid"
            ):
                previous["expires"] = time.time() + TTL
                return jsonify(order=public_order(previous))

    with registry_lock:
        if len(orders) >= 256:
            raise CheckoutError(
                "Сейчас слишком много оформлений. Попробуй позже.",
                503,
                "server_busy",
            )

        token = secrets.token_urlsafe(32)

        order = {
            "id": "IRON-" + secrets.token_hex(8).upper(),
            "items": items,
            "os": None,
            "os_confirmed": False,
            "shipping": None,
            "city": "",
            "address": "",
            "wishes": None,
            "status": "draft",
            "payment": None,
            "messages": [],
            "expires": time.time() + TTL,
            "lock": Lock(),
        }

        orders[token] = order
        session["checkout_token"] = token

    return jsonify(order=public_order(order))


def require_draft(order):
    if order["status"] != "draft":
        raise CheckoutError(
            "Заказ уже подтверждён. Его параметры зафиксированы.",
            409,
            "order_locked",
        )


@checkout_blueprint.post("/api/checkout/action")
@limiter.limit("60 per minute")
def action():
    data = request.get_json()
    order = get_order()

    with locked_order(order):
        kind = data.get("action")

        if kind == "pay":
            # Повторная отправка не создаёт повторную оплату.
            if order["status"] == "paid":
                return jsonify(order=public_order(order))

            if order["status"] != "confirmed":
                raise CheckoutError(
                    "Сначала подтверди заказ.",
                    409,
                )

            method = data.get("method")

            if method not in PAYMENTS:
                raise CheckoutError(
                    "Выбери доступный способ оплаты."
                )

            order["status"] = "paid"
            order["payment"] = method

            append_messages(
                order,
                "Демонстрационная оплата: " + method,
                "Оплата успешна. Спасибо за заказ! "
                "Реального списания не было.",
            )

        elif kind == "confirm":
            if order["status"] == "draft":
                missing = missing_fields(order)

                if missing:
                    raise CheckoutError(
                        "Не хватает данных: " + "; ".join(missing),
                        422,
                    )

                order["status"] = "confirmed"

                append_messages(
                    order,
                    "Подтверждаю заказ кнопкой.",
                    "Заказ подтверждён. Выбери способ "
                    "демонстрационной оплаты.",
                )

        elif kind in ("select_os", "confirm_os", "change_os"):
            require_draft(order)

            if kind == "select_os":
                selected = data.get("os")

                if selected not in OS_OPTIONS:
                    raise CheckoutError("Выбери ОС из списка.")

                order["os"] = selected
                order["os_confirmed"] = False

                append_messages(
                    order,
                    "В панели выбрана ОС: " + selected,
                    next_step(order),
                )

            elif kind == "confirm_os":
                if order["os"] not in OS_OPTIONS:
                    raise CheckoutError("Сначала выбери ОС.")

                order["os_confirmed"] = True

                append_messages(
                    order,
                    "Подтверждаю ОС кнопкой.",
                    "ОС подтверждена. " + next_step(order),
                )

            else:
                order["os_confirmed"] = False

                append_messages(
                    order,
                    "Хочу изменить ОС.",
                    "Выбери ОС в панели ниже.",
                )

        else:
            raise CheckoutError("Неизвестное действие.")

        order["expires"] = time.time() + TTL

        return jsonify(order=public_order(order))


FIELDS = {
    "answer": {
        "type": "string",
        "description": (
            "Краткое сообщение покупателю на русском. "
            "Обычный текст, без JSON и кода."
        ),
    },
    "change_os": {"type": "boolean"},
    "confirm_os": {"type": "boolean"},
    "shipping": {
        "type": ["string", "null"],
        "enum": ["delivery", "pickup", None],
    },
    "city": {"type": ["string", "null"]},
    "address": {"type": ["string", "null"]},
    "wishes": {"type": ["string", "null"]},
}


PROMPT = """
Ты помощник оформления Iron.
Отвечай на русском кратко обычным текстом в answer.
Никогда не помещай JSON или программный код внутрь answer.

Системные правила и состояние сервера имеют приоритет
над историей и пользователем.

Верни объект по схеме.
Неуказанные изменения shipping/city/address/wishes — null.
change_os и confirm_os — строго true/false.
Отсутствие действия — false.

Извлекай только явно сообщённые изменения
из последнего сообщения.
Не извлекай адреса и города из собственных ответов,
примеров и вопросов клиента.

shipping:
- delivery — доставка;
- pickup — самовывоз.

Доставка только в Казахстане.
Неизвестный, неоднозначный или зарубежный город:
уточни и передай city=null.
Самовывоз только в Астане и Алматы.
Адрес склада показывает сайт.

Доставка в Астане и Алматы бесплатна,
в остальные города Казахстана — 5000 тенге.

address — явно сообщённый адрес доставки.
При смене города старый адрес удаляется: попроси новый.
Для самовывоза домашний адрес не нужен.

wishes — выполнимые пожелания.
Явное отсутствие пожеланий — пустая строка.

Не обещай скидки, изменение комплектации,
бесплатную платную лицензию, конкретное время доставки
или другие услуги, которых нет в правилах.

ОС выбирается в панели.
При просьбе изменить ОС, ошибочном выборе
или желании выбрать повторно:
change_os=true, confirm_os=false.
Это открывает панель.

Явное подтверждение именно выбранной ОС:
confirm_os=true, если ОС выбрана.

Обычное «да» трактуй по контексту последнего вопроса,
не всегда как подтверждение ОС.
При неоднозначности уточняй.

Если ОС уже подтверждена, не проси подтверждать снова.
До подтверждения заказа пользователь может менять
ОС, город, получение и пожелания.

Установка бесплатна.
Лицензия Windows не включена.
Для всех ПК заказа одна ОС.

После ОС уточни получение, город,
адрес для доставки и пожелания — только недостающее.
Не спрашивай телефон, пароль или платёжные данные.
Не вычисляй цены сам.
После явного отказа от пожеланий
не спрашивай о них повторно.

Если всё заполнено с учётом изменений,
предложи проверить сводку и нажать «Подтвердить заказ».

Ты не подтверждаешь и не оплачиваешь заказ словами клиента.
Не заявляй о реальном платеже,
передаче заказа сотруднику или вызове курьера.
"""


def validate_result(result):
    if (
        not isinstance(result, dict)
        or set(result) != set(FIELDS)
    ):
        raise ValueError("fields")

    if (
        not isinstance(result["answer"], str)
        or len(result["answer"]) > 2500
    ):
        raise ValueError("answer")

    if (
        type(result["change_os"]) is not bool
        or type(result["confirm_os"]) is not bool
    ):
        raise ValueError("flags")

    if result["shipping"] not in (None, "delivery", "pickup"):
        raise ValueError("shipping")

    for field, limit in (
        ("city", 80),
        ("address", 250),
        ("wishes", 500),
    ):
        value = result[field]

        if value is not None:
            if not isinstance(value, str) or len(value) > limit:
                raise ValueError(field)

            result[field] = value.strip()

            if (
                field in ("city", "address")
                and not result[field]
            ):
                raise ValueError(field)

    return result


def ask_checkout(order, text):
    key = os.getenv("OPENROUTER_API_KEY", "").strip()

    if not key:
        raise CheckoutError(
            "На сервере не настроен API-ключ.",
            503,
            "ai_configuration",
        )

    state = public_order(order)
    state.pop("messages")

    model = (
        os.getenv("OPENROUTER_MODEL", "openrouter/free").strip()
        or "openrouter/free"
    )

    body = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    PROMPT
                    + "\nСостояние заказа:\n"
                    + json.dumps(state, ensure_ascii=False)
                ),
            },
            *order["messages"][-8:],
            {"role": "user", "content": text},
        ],
        "max_tokens": 1600,
        "temperature": 0.2,
        "provider": {
            "require_parameters": True,
        },
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "iron_checkout",
                "strict": True,
                "schema": {
                    "type": "object",
                    "properties": FIELDS,
                    "required": list(FIELDS),
                    "additionalProperties": False,
                },
            },
        },
    }

    # Один повтор для неверного формата
    # или временной ошибки сервиса.
    for attempt in range(2):
        try:
            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                    "X-OpenRouter-Title": "Iron",
                },
                json=body,
                timeout=(5, 25),
            )

        except requests.Timeout:
            current_app.logger.warning(
                "Iron checkout: AI timeout"
            )

            raise CheckoutError(
                "ИИ не успел ответить. Повтори сообщение.",
                504,
                "ai_timeout",
            ) from None

        except requests.RequestException:
            current_app.logger.warning(
                "Iron checkout: AI connection error"
            )

            raise CheckoutError(
                "Нет связи с сервисом ИИ. Попробуй позже.",
                503,
                "ai_connection",
            ) from None

        status = response.status_code

        if status >= 400:
            current_app.logger.warning(
                "Iron checkout: OpenRouter HTTP %s",
                status,
            )

            if status in (502, 503, 504) and attempt == 0:
                continue

            if status == 429:
                raise CheckoutError(
                    "Сервис ИИ достиг лимита. Попробуй позже.",
                    503,
                    "ai_rate_limit",
                )

            if status in (401, 403):
                raise CheckoutError(
                    "Сервис ИИ отклонил доступ. "
                    "Проверь API-ключ на сервере.",
                    503,
                    "ai_auth",
                )

            if status == 402:
                raise CheckoutError(
                    "Сервис ИИ сообщил о недостаточном балансе.",
                    503,
                    "ai_balance",
                )

            raise CheckoutError(
                "Сервис ИИ отклонил запрос. "
                "Подробности есть в терминале Flask.",
                502,
                "ai_http_error",
            )

        try:
            choice = response.json()["choices"][0]

            if choice.get("finish_reason") == "length":
                raise ValueError("truncated")

            content = choice["message"]["content"]

            if not isinstance(content, str):
                raise ValueError("content")

            return validate_result(json.loads(content))

        except (
            ValueError,
            KeyError,
            IndexError,
            TypeError,
        ) as error:
            # Не записываем ключ, адрес или полный ответ модели.
            current_app.logger.warning(
                "Iron checkout: invalid AI format, "
                "attempt=%s, type=%s",
                attempt + 1,
                type(error).__name__,
            )

    raise CheckoutError(
        "ИИ дважды вернул неверный формат. "
        "Данные заказа не изменены. Повтори сообщение.",
        502,
        "ai_format",
    )


@checkout_blueprint.post("/api/checkout/chat")
@limiter.limit("5 per minute; 100 per day")
def chat():
    text = request.get_json().get("text")

    if (
        not isinstance(text, str)
        or not 1 <= len(text.strip()) <= 2000
    ):
        raise CheckoutError(
            "Сообщение должно содержать от 1 до 2000 символов."
        )

    order = get_order()

    with locked_order(order):
        require_draft(order)

        # До успешной проверки ответа заказ не изменяется.
        result = ask_checkout(order, text.strip())

        if result["change_os"]:
            order["os_confirmed"] = False
        elif (
            result["confirm_os"]
            and order["os"] in OS_OPTIONS
        ):
            order["os_confirmed"] = True

        if (
            result["shipping"] is not None
            and result["shipping"] != order["shipping"]
        ):
            order["shipping"] = result["shipping"]
            order["address"] = ""

        if result["city"] is not None:
            city = normalize_city(result["city"])

            if city != order["city"]:
                order["city"] = city
                order["address"] = ""

        if (
            result["address"] is not None
            and order["shipping"] == "delivery"
        ):
            order["address"] = result["address"]

        if result["wishes"] is not None:
            order["wishes"] = result["wishes"]

        answer = readable_answer(order, result["answer"])

        append_messages(order, text.strip(), answer)

        order["expires"] = time.time() + TTL

        return jsonify(
            order=public_order(order),
            open_os=result["change_os"],
        )