(() => {
    const status = document.querySelector("#checkout-status");
    const content = document.querySelector("#checkout-content");
    const products = document.querySelector("#checkout-products");
    const messages = document.querySelector("#checkout-messages");
    const summary = document.querySelector("#checkout-summary");
    const missing = document.querySelector("#checkout-missing");

    const chatForm = document.querySelector("#checkout-form");
    const input = document.querySelector("#checkout-input");
    const sendButton = document.querySelector("#checkout-send");

    const osPanel = document.querySelector("#os-panel");
    const osForm = document.querySelector("#os-form");
    const osOptions = document.querySelector("#os-options");
    const osConfirmPanel = document.querySelector("#os-confirm-panel");
    const osConfirmText = document.querySelector("#os-confirm-text");
    const confirmOs = document.querySelector("#confirm-os");
    const changeOs = document.querySelector("#change-os");

    const confirmOrder = document.querySelector("#confirm-order");
    const paymentPanel = document.querySelector("#payment-panel");
    const paymentMethod = document.querySelector("#payment-method");
    const payOrder = document.querySelector("#pay-order");
    const success = document.querySelector("#payment-success");

    let order = null;
    let busy = false;

    let failedMessage = null;
    let errorNotice = null;

    const money = value =>
        new Intl.NumberFormat("ru-RU").format(value) + " ₸";


    function node(tag, className = "", text) {
        const element = document.createElement(tag);
        element.className = className;

        if (text !== undefined) {
            element.textContent = text;
        }

        return element;
    }


    function scrollChat() {
        messages.scrollTop = messages.scrollHeight;
    }


    function addMessage(role, text) {
        const message = node(
            "div",
            `chat-message ${role}`,
            text
        );

        messages.append(message);
        scrollChat();

        return message;
    }


    function setBusy(value) {
        busy = value;

        content.setAttribute("aria-busy", String(value));

        content.querySelectorAll(
            "button, input, textarea, select"
        ).forEach(element => {
            element.disabled = value;
        });

        sendButton.textContent = value
            ? "Ожидаем ответ…"
            : "Отправить ↗";

        if (!value && order) {
            const locked = order.status !== "draft";

            input.disabled = locked;
            sendButton.disabled = locked;

            confirmOrder.disabled = locked || !order.ready;
            changeOs.disabled = locked;
            confirmOs.disabled = locked || !order.os;

            payOrder.disabled = order.status !== "confirmed";
        }

        status.textContent = value
            ? "Обрабатываем запрос…"
            : "";
    }


    // Индикатор находится внутри чата, рядом с сообщением.
    function showWaiting(isChat) {
        const bubble = node(
            "div",
            "chat-message assistant iron-waiting"
        );

        bubble.setAttribute("role", "status");

        const dots = node("span", "iron-waiting-dots");
        dots.setAttribute("aria-hidden", "true");

        for (let i = 0; i < 3; i++) {
            dots.append(node("span"));
        }

        const label = node(
            "span",
            "",
            isChat
                ? "Iron формулирует ответ…"
                : "Обновляем заказ…"
        );

        bubble.append(dots, label);
        messages.append(bubble);

        scrollChat();

        const timer = isChat
            ? window.setTimeout(() => {
                label.textContent =
                    "Ожидаем ответ ИИ. "
                    + "Это может занять немного времени…";

                scrollChat();
            }, 12000)
            : null;

        // Возвращаем функцию удаления индикатора и таймера.
        return () => {
            if (timer !== null) {
                window.clearTimeout(timer);
            }

            bubble.remove();
        };
    }


    function renderProducts() {
        products.replaceChildren();

        order.items.forEach(product => {
            const card = node("article", "checkout-product");

            const image = node("img");
            image.src = product.image;
            image.alt = product.name;

            const body = node("div");

            body.append(
                node("h3", "", product.name),
                node(
                    "p",
                    "muted",
                    `${product.cpu} · ${product.gpu}`
                ),
                node(
                    "small",
                    "muted",
                    `${product.quantity} шт. × ${money(product.price)}`
                ),
                node(
                    "strong",
                    "",
                    money(product.price * product.quantity)
                )
            );

            card.append(image, body);
            products.append(card);
        });
    }


    function renderOs() {
        osOptions.replaceChildren();

        order.os_options.forEach((name, index) => {
            const label = node("label", "os-option");
            const radio = node("input");

            radio.type = "radio";
            radio.name = "os";
            radio.value = name;
            radio.id = `checkout-os-${index}`;
            radio.required = true;
            radio.checked = order.os === name;

            label.append(radio, node("span", "", name));
            osOptions.append(label);
        });

        const draft = order.status === "draft";

        osPanel.hidden = !draft || order.os_confirmed;

        osConfirmPanel.hidden =
            !draft || !order.os || order.os_confirmed;

        osConfirmText.textContent = order.os
            ? `Выбрано: ${order.os}. Подтверди выбор кнопкой или сообщением.`
            : "";

        changeOs.hidden = !draft;
    }


    function renderSummary() {
        summary.replaceChildren();

        const receiving = order.shipping === "delivery"
            ? "Доставка"
            : order.shipping === "pickup"
                ? "Самовывоз"
                : "Не выбран";

        const lines = [
            ["Номер", order.id],
            [
                "ОС",
                order.os
                    ? `${order.os}${order.os_confirmed ? "" : " — ждёт подтверждения"}`
                    : "Не выбрана",
            ],
            ["Получение", receiving],
            ["Город", order.city || "Не указан"],
        ];

        if (order.shipping === "delivery") {
            lines.push(["Адрес", order.address || "Не указан"]);
        }

        if (order.shipping === "pickup") {
            lines.push(["Склад", order.warehouse || "Выбери город"]);
        }

        lines.push([
            "Пожелания",
            order.wishes === null
                ? "Не уточнены"
                : order.wishes || "Без пожеланий",
        ]);

        lines.forEach(([label, value]) => {
            const row = node("p", "checkout-summary-line");

            row.append(
                node("small", "muted", label),
                node("span", "", value)
            );

            summary.append(row);
        });

        summary.append(
            node("p", "", `Компьютеры: ${money(order.subtotal)}`),
            node(
                "p",
                "",
                order.delivery_known
                    ? `Доставка: ${money(order.delivery)}`
                    : "Доставка: уточняется"
            ),
            node(
                "strong",
                "total",
                money(
                    order.delivery_known
                        ? order.total
                        : order.subtotal
                )
            )
        );

        missing.replaceChildren();

        if (order.status === "draft") {
            order.missing.forEach(text => {
                missing.append(node("li", "", text));
            });
        }

        confirmOrder.hidden = order.status !== "draft";
        paymentPanel.hidden = order.status !== "confirmed";
        success.hidden = order.status !== "paid";

        if (order.status === "paid") {
            success.textContent =
                `Заказ ${order.id}: демонстрационная оплата успешна. `
                + "Спасибо! Реальные деньги не списывались.";

            window.IronCart.removePurchased(order);
        }
    }


    function renderMessages() {
        messages.replaceChildren();

        failedMessage = null;
        errorNotice = null;

        addMessage(
            "assistant",
            "Привет! Здесь твои компьютеры из корзины. "
            + "Сначала выбери ОС в панели ниже, затем уточним "
            + "доставку или самовывоз и пожелания. "
            + "ОС можно изменить до подтверждения заказа."
        );

        order.messages.forEach(message => {
            addMessage(message.role, message.content);
        });

        scrollChat();
    }


    function render() {
        content.hidden = false;

        renderProducts();
        renderOs();
        renderSummary();
        renderMessages();

        const selectedPayment = paymentMethod.value;
        paymentMethod.replaceChildren();

        order.payment_options.forEach(method => {
            const option = node("option", "", method);
            option.value = method;
            paymentMethod.append(option);
        });

        if (order.payment_options.includes(selectedPayment)) {
            paymentMethod.value = selectedPayment;
        }

        chatForm.hidden = order.status !== "draft";
    }


    async function requestOrder(url, body) {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Iron-Request": "checkout",
            },
            body: JSON.stringify(body),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Не удалось обработать запрос."
            );
        }

        if (!data.order || !Array.isArray(data.order.items)) {
            throw new Error("Сервер вернул неожиданный ответ.");
        }

        return data.order;
    }


    async function run(url, body, pendingMessage = null) {
        if (busy) return false;

        errorNotice?.remove();
        errorNotice = null;

        setBusy(true);

        const hideWaiting = order
            ? showWaiting(url.endsWith("/chat"))
            : () => {};

        try {
            const receivedOrder = await requestOrder(url, body);

            order = receivedOrder;

            hideWaiting();

            // Серверная история заменяет временные сообщения.
            // Поэтому пользовательское сообщение не дублируется.
            render();

            setBusy(false);
            return true;

        } catch (error) {
            hideWaiting();
            setBusy(false);

            const text = error instanceof SyntaxError
                ? "Сервер вернул некорректный ответ."
                : error instanceof TypeError
                    ? "Не удалось получить ответ сервера. Проверь соединение."
                    : error.message || "Не удалось получить ответ.";

            status.textContent = text;

            if (order) {
                if (pendingMessage) {
                    pendingMessage.classList.add(
                        "iron-message-failed"
                    );

                    pendingMessage.append(
                        node(
                            "small",
                            "iron-message-note",
                            "Ответ не получен"
                        )
                    );

                    failedMessage = pendingMessage;
                }

                errorNotice = addMessage("assistant", text);
                errorNotice.classList.add("iron-chat-error");
            }

            console.error("Ошибка оформления Iron:", error);

            return false;
        }
    }


    osForm.addEventListener("submit", event => {
        event.preventDefault();

        if (busy) return;

        const selected = new FormData(osForm).get("os");

        if (selected) {
            run("/api/checkout/action", {
                action: "select_os",
                os: selected,
            });
        }
    });


    confirmOs.addEventListener("click", () => {
        run("/api/checkout/action", {
            action: "confirm_os",
        });
    });


    changeOs.addEventListener("click", () => {
        run("/api/checkout/action", {
            action: "change_os",
        });
    });


    confirmOrder.addEventListener("click", () => {
        run("/api/checkout/action", {
            action: "confirm",
        });
    });


    payOrder.addEventListener("click", () => {
        run("/api/checkout/action", {
            action: "pay",
            method: paymentMethod.value,
        });
    });


    chatForm.addEventListener("submit", async event => {
        event.preventDefault();

        if (busy || !order || order.status !== "draft") {
            return;
        }

        const text = input.value.trim();

        if (!text) return;

        failedMessage?.remove();
        failedMessage = null;

        errorNotice?.remove();
        errorNotice = null;

        // Эти действия выполняются сразу, до запроса к серверу.
        input.value = "";
        const pendingMessage = addMessage("user", text);

        const completed = await run(
            "/api/checkout/chat",
            { text },
            pendingMessage
        );

        if (!completed) {
            input.value = text;
        }

        if (order?.status === "draft") {
            input.focus();
        }
    });


    input.addEventListener("keydown", event => {
        if (
            event.key === "Enter"
            && !event.shiftKey
            && !event.isComposing
        ) {
            event.preventDefault();

            if (!busy) {
                chatForm.requestSubmit();
            }
        }
    });


    run("/api/checkout/start", {
        cart: window.IronCart.read(),
    });
})();