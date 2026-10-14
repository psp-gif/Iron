WAREHOUSES = {
    "Астана": "ул. Железная, 12, склад № 1",
    "Алматы": "ул. Сборочная, 24, склад № 2",
}

WAREHOUSE_HOURS = "Ежедневно, 10:00–19:00"

DELIVERY_FEE = 5000
LOCAL_DELIVERY_DAYS = "1–2 рабочих дня"
OTHER_DELIVERY_DAYS = "3–5 рабочих дней"


def delivery_details(order):
    shipping = order["shipping"]
    city = order["city"]

    result = {
        "delivery": 0,
        "delivery_known": False,
        "delivery_estimate": "",
        "delivery_terms": "",
        "warehouse": "",
        "warehouse_hours": "",
    }

    if shipping == "pickup" and city in WAREHOUSES:
        result.update(
            delivery_known=True,
            warehouse=WAREHOUSES[city],
            warehouse_hours=WAREHOUSE_HOURS,
            delivery_terms=(
                f"Самовывоз в городе {city} бесплатный. "
                f"Адрес: {WAREHOUSES[city]}. "
                f"Часы работы: {WAREHOUSE_HOURS}. "
                "Получение после уведомления о готовности заказа."
            ),
        )

    elif shipping == "delivery" and len(city) >= 2:
        local = city in WAREHOUSES

        fee = 0 if local else DELIVERY_FEE

        days = (
            LOCAL_DELIVERY_DAYS
            if local
            else OTHER_DELIVERY_DAYS
        )

        price_text = "бесплатно" if local else "5 000 ₸"

        result.update(
            delivery=fee,
            delivery_known=True,
            delivery_estimate=days,
            delivery_terms=(
                f"Доставка в город {city}: {price_text}. "
                f"Ориентировочный срок после оформления заказа — {days}."
            ),
        )

    return result