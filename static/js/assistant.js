const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const chatMessages = document.querySelector("#chat-messages");
const chatStatus = document.querySelector("#chat-status");
const sendButton = document.querySelector("#chat-send");
const newChatButton = document.querySelector("#new-chat");

let history = [];
let busy = false;


// Показываем сообщение как текст, а не HTML.
function addMessage(role, text) {
    const message = document.createElement("div");
    message.className = `chat-message ${role}`;
    message.textContent = text;

    chatMessages.append(message);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return message;
}


// Блокируем повторную отправку во время ожидания.
function setBusy(value) {
    busy = value;

    sendButton.disabled = value;
    newChatButton.disabled = value;
    chatInput.disabled = value;

    chatStatus.textContent = value ? "Iron готовит ответ…" : "";
    chatStatus.classList.toggle("thinking", value);
}


// Создаём карточки товаров из данных сервера.
function addProductCards(products) {
    if (!Array.isArray(products) || !products.length) {
        return null;
    }

    const container = document.createElement("div");
    container.className = "chat-products";

    products.forEach((product) => {
        const card = document.createElement("article");
        card.className = "chat-product";

        const image = document.createElement("img");
        image.src = product.image;
        image.alt = `Иллюстрация ${product.name}`;
        image.loading = "lazy";

        const body = document.createElement("div");
        body.className = "chat-product-body";

        const title = document.createElement("h3");
        title.textContent = product.name;

        const condition = document.createElement("small");
        condition.textContent = product.condition === "used"
            ? "Б/у · без гарантии"
            : "Новый · гарантия 1 год";

        const specs = document.createElement("p");
        specs.className = "muted";
        specs.textContent = [
            product.cpu,
            product.gpu,
            `${product.ram} · ${product.disk}`,
        ].join("\n");

        const price = document.createElement("strong");
        price.className = "chat-product-price";
        price.textContent =
            new Intl.NumberFormat("ru-RU").format(product.price) + " ₸";

        const actions = document.createElement("div");
        actions.className = "chat-product-actions";

        const details = document.createElement("a");
        details.className = "button secondary";
        details.href = `/product/${product.id}`;
        details.textContent = "Подробнее";

        const buy = document.createElement("button");
        buy.type = "button";
        buy.className = "small-button add-cart";
        buy.dataset.id = product.id;
        buy.textContent = "В корзину +";
        buy.setAttribute(
            "aria-label",
            `Добавить ${product.name} в корзину`
        );

        actions.append(details, buy);
        body.append(title, condition, specs, price, actions);
        card.append(image, body);
        container.append(card);
    });

    chatMessages.append(container);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return container;
}


// Отправляем сообщение во Flask.
chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (busy) return;

    const text = chatInput.value.trim();

    if (!text) return;

    // Последние пять пар сообщений и новый вопрос.
    const recentHistory = history.slice(-10);
    const nextHistory = [
        ...recentHistory,
        { role: "user", content: text },
    ];

    const userMessage = addMessage("user", text);

    let assistantMessage = null;
    let productCards = null;

    chatInput.value = "";
    setBusy(true);

    try {
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messages: nextHistory,
            }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Не удалось получить ответ.");
        }

        if (
            typeof data.answer !== "string"
            || !data.answer.trim()
            || !Array.isArray(data.product_ids)
            || !Array.isArray(data.products)
        ) {
            throw new Error("Сервер вернул неожиданный формат ответа.");
        }

        assistantMessage = addMessage("assistant", data.answer);
        productCards = addProductCards(data.products);

        // Сохраняем рекомендации для последующих уточнений.
        const rememberedAnswer = JSON.stringify({
            answer: data.answer,
            product_ids: data.product_ids,
        });

        history = [
            ...nextHistory,
            { role: "assistant", content: rememberedAnswer },
        ];
    } catch (error) {
        // Убираем незавершённый ответ и возвращаем вопрос в поле.
        userMessage.remove();
        assistantMessage?.remove();
        productCards?.remove();

        chatInput.value = text;

        let message;

        if (error instanceof SyntaxError) {
            message = "Сервер вернул некорректный JSON.";
        } else if (error instanceof TypeError) {
            message = "Не удалось обработать запрос. Проверь консоль браузера.";
        } else {
            message = error.message || "Не удалось получить ответ.";
        }

        console.error("Ошибка чата Iron:", error);

        setBusy(false);
        chatStatus.textContent = message;
        chatInput.focus();
        return;
    }

    setBusy(false);
    chatInput.focus();
});


// Enter отправляет сообщение, Shift + Enter переносит строку.
chatInput.addEventListener("keydown", (event) => {
    if (
        event.key === "Enter"
        && !event.shiftKey
        && !event.isComposing
    ) {
        event.preventDefault();
        chatForm.requestSubmit();
    }
});


// Очищаем сообщения и историю диалога.
newChatButton.addEventListener("click", () => {
    if (busy) return;

    history = [];
    chatMessages.replaceChildren();
    chatInput.value = "";

    setBusy(false);

    addMessage(
        "assistant",
        "Начнём заново. Для каких задач нужен ПК и какой бюджет?"
    );

    chatInput.focus();
});