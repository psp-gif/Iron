(() => {
    const CART_KEY = "iron-cart-v1";
    const cartPage = document.querySelector("#cart-page");

    let products = [];
    let cart = readCart();

    function readCart() {
        try {
            const saved = JSON.parse(
                localStorage.getItem(CART_KEY) || "{}"
            );

            if (
                !saved
                || typeof saved !== "object"
                || Array.isArray(saved)
            ) {
                return {};
            }

            return Object.fromEntries(
                Object.entries(saved).filter(([id, quantity]) =>
                    /^\d+$/.test(id)
                    && Number.isInteger(quantity)
                    && quantity > 0
                    && quantity <= 10
                )
            );
        } catch {
            return {};
        }
    }

    function notify(text) {
        if (typeof window.showToast === "function") {
            window.showToast(text);
        }
    }

    function updateCount() {
        const total = Object.values(cart).reduce(
            (sum, quantity) => sum + quantity,
            0
        );

        document.querySelectorAll(".cart-count").forEach(counter => {
            counter.textContent = total;
        });
    }

    function saveCart() {
        try {
            localStorage.setItem(CART_KEY, JSON.stringify(cart));
        } catch {
            notify("Браузер не разрешил сохранить корзину.");
        }

        updateCount();
    }

    function element(tag, className = "", text) {
        const node = document.createElement(tag);
        node.className = className;

        if (text !== undefined) {
            node.textContent = text;
        }

        return node;
    }

    const money = amount =>
        new Intl.NumberFormat("ru-RU").format(amount) + " ₸";

    function renderCart() {
        cartPage.replaceChildren();

        const selected = products.filter(product => cart[product.id]);

        if (!selected.length) {
            const empty = element("div", "empty");

            empty.append(
                element("h2", "", "Здесь пока пусто"),
                element(
                    "p",
                    "",
                    "Выбери компьютер — он появится в корзине."
                )
            );

            const link = element(
                "a",
                "button",
                "Перейти в каталог ↗"
            );

            link.href = "/catalog";
            empty.append(link);
            cartPage.append(empty);
            return;
        }

        const layout = element("div", "cart-layout");
        const list = element("div");

        let total = 0;

        selected.forEach(product => {
            const quantity = cart[product.id];
            total += product.price * quantity;

            const row = element("article", "cart-row");

            const image = element("img");
            image.src = product.image;
            image.alt = product.name;

            const info = element("div", "cart-info");
            const link = element("a");
            link.href = `/product/${product.id}`;
            link.append(element("h3", "", product.name));

            info.append(
                link,
                element("small", "", product.cpu)
            );

            const controls = element("div", "quantity");

            [-1, 1].forEach(delta => {
                const button = element(
                    "button",
                    "",
                    delta === -1 ? "−" : "+"
                );

                button.type = "button";
                button.disabled = delta === 1 && quantity >= 10;

                button.setAttribute(
                    "aria-label",
                    `${delta === -1 ? "Уменьшить" : "Увеличить"} количество ${product.name}`
                );

                button.addEventListener("click", () => {
                    cart[product.id] += delta;

                    if (!cart[product.id]) {
                        delete cart[product.id];
                    }

                    saveCart();
                    renderCart();
                });

                if (delta === 1) {
                    controls.append(element("span", "", quantity));
                }

                controls.append(button);
            });

            const remove = element(
                "button",
                "remove-item",
                "Удалить"
            );

            remove.type = "button";
            remove.setAttribute(
                "aria-label",
                `Удалить ${product.name}`
            );

            remove.addEventListener("click", () => {
                delete cart[product.id];
                saveCart();
                renderCart();
            });

            controls.append(remove);
            info.append(controls);

            row.append(
                image,
                info,
                element("strong", "", money(product.price * quantity))
            );

            list.append(row);
        });

        const summary = element("aside", "cart-summary");

        summary.append(
            element("h3", "", "Твой заказ"),
            element("span", "muted", "Стоимость компьютеров"),
            element("strong", "total", money(total)),
            element(
                "p",
                "",
                "Доставка по Астане и Алматы бесплатная. "
                + "В другие города Казахстана — 5 000 ₸."
            )
        );

        const next = element(
            "a",
            "button",
            "К оформлению ↗"
        );

        next.href = "/assistant?mode=checkout";

        summary.append(
            next,
            element(
                "p",
                "muted",
                "Помощник уточнит ОС, способ получения и пожелания."
            )
        );

        layout.append(list, summary);
        cartPage.append(layout);
    }

    document.addEventListener("click", event => {
        const button = event.target.closest(".add-cart");

        if (!button) return;

        const id = button.dataset.id;

        if (!/^\d+$/.test(id || "")) return;

        if ((cart[id] || 0) >= 10) {
            notify("Лимит — 10 штук одной сборки.");
            return;
        }

        cart[id] = (cart[id] || 0) + 1;
        saveCart();

        const counter = document.querySelector(".cart-count");

        if (counter) {
            counter.classList.remove("bump");
            void counter.offsetWidth;
            counter.classList.add("bump");
        }

        if (cartPage && products.length) {
            renderCart();
        }

        notify("Компьютер добавлен в корзину");
    });

    // Экран оформления использует этот интерфейс.
    window.IronCart = {
        read: () => ({ ...cart }),

        removePurchased(order) {
            const marker = "iron-last-paid-order";

            try {
                if (localStorage.getItem(marker) === order.id) {
                    return;
                }

                cart = readCart();

                order.items.forEach(product => {
                    const id = String(product.id);
                    const remaining =
                        (cart[id] || 0) - product.quantity;

                    if (remaining > 0) {
                        cart[id] = remaining;
                    } else {
                        delete cart[id];
                    }
                });

                localStorage.setItem(
                    CART_KEY,
                    JSON.stringify(cart)
                );

                localStorage.setItem(marker, order.id);
                updateCount();
            } catch {
                notify(
                    "Оплата завершена, но браузер не разрешил "
                    + "обновить корзину."
                );
            }
        },
    };

    updateCount();

    if (cartPage) {
        fetch("/api/products")
            .then(response => {
                if (!response.ok) {
                    throw new Error("Каталог недоступен.");
                }

                return response.json();
            })
            .then(data => {
                if (!Array.isArray(data.products)) {
                    throw new Error("Некорректный каталог.");
                }

                products = data.products;

                const validIds = new Set(
                    products.map(product => String(product.id))
                );

                cart = Object.fromEntries(
                    Object.entries(cart).filter(([id]) =>
                        validIds.has(id)
                    )
                );

                saveCart();
                renderCart();
            })
            .catch(() => {
                cartPage.replaceChildren(
                    element(
                        "p",
                        "",
                        "Не удалось загрузить каталог. "
                        + "Проверь, запущен ли сервер."
                    )
                );
            });
    }

    window.addEventListener("storage", event => {
        if (event.key === CART_KEY || event.key === null) {
            cart = readCart();
            updateCount();

            if (cartPage && products.length) {
                renderCart();
            }
        }
    });
})();