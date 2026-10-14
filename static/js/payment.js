(() => {
    let activeDialog = null;

    const money = value =>
        new Intl.NumberFormat("ru-RU").format(value) + " ₸";


    function celebrate(dialog) {
        if (
            window.matchMedia(
                "(prefers-reduced-motion: reduce)"
            ).matches
        ) {
            return () => {};
        }

        const canvas = document.createElement("canvas");
        canvas.className = "iron-pay-confetti";
        canvas.setAttribute("aria-hidden", "true");

        dialog.append(canvas);

        const context = canvas.getContext("2d");

        if (!context) {
            canvas.remove();
            return () => {};
        }

        const width = window.innerWidth;
        const height = window.innerHeight;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);

        canvas.width = width * ratio;
        canvas.height = height * ratio;

        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;

        context.scale(ratio, ratio);

        const colors = [
            "#d7ff00",
            "#4285f4",
            "#26c477",
            "#ffbd45",
            "#ffffff",
        ];

        const particles = Array.from({ length: 100 }, () => ({
            x: width / 2,
            y: height * 0.42,
            vx: (Math.random() - 0.5) * 680,
            vy: -350 - Math.random() * 420,
            angle: Math.random() * Math.PI,
            spin: (Math.random() - 0.5) * 12,
            size: 5 + Math.random() * 5,
            color: colors[
                Math.floor(Math.random() * colors.length)
            ],
        }));

        let frame = null;
        let start = null;
        let last = null;

        function draw(now) {
            if (start === null) {
                start = now;
                last = now;
            }

            const age = (now - start) / 1000;
            const dt = Math.min((now - last) / 1000, 0.04);

            last = now;

            context.clearRect(0, 0, width, height);

            context.globalAlpha = Math.max(
                0,
                1 - Math.max(0, age - 1.5) / 1.5
            );

            particles.forEach(particle => {
                particle.vy += 620 * dt;
                particle.x += particle.vx * dt;
                particle.y += particle.vy * dt;
                particle.angle += particle.spin * dt;

                context.save();
                context.translate(particle.x, particle.y);
                context.rotate(particle.angle);
                context.fillStyle = particle.color;

                context.fillRect(
                    -particle.size / 2,
                    -particle.size / 2,
                    particle.size,
                    particle.size * 0.55
                );

                context.restore();
            });

            if (age < 3) {
                frame = window.requestAnimationFrame(draw);
            } else {
                frame = null;
                canvas.remove();
            }
        }

        frame = window.requestAnimationFrame(draw);

        return () => {
            if (frame !== null) {
                window.cancelAnimationFrame(frame);
            }

            canvas.remove();
        };
    }


    function open({ order, pay }) {
        if (activeDialog) return;

        if (
            order.status !== "confirmed"
            || typeof pay !== "function"
        ) {
            return;
        }

        const dialog = document.createElement("dialog");

        dialog.className = "iron-pay-dialog";
        dialog.setAttribute(
            "aria-labelledby",
            "iron-pay-title"
        );

        // Здесь только наша статическая разметка.
        // Данные заказа ниже вставляются через textContent.
        dialog.innerHTML = `
            <div class="iron-pay-sheet">
                <header class="iron-pay-header">
                    <span class="iron-pay-brand">
                        Iron<span>●</span>
                    </span>

                    <span class="iron-pay-demo">
                        ДЕМО-ОПЛАТА
                    </span>

                    <button
                        class="iron-pay-close"
                        type="button"
                        aria-label="Закрыть оплату"
                    >×</button>
                </header>

                <section class="iron-pay-choice">
                    <p class="iron-pay-eyebrow">
                        ПОСЛЕДНИЙ ШАГ
                    </p>

                    <h2 id="iron-pay-title">
                        Твоё новое железо<br>почти у тебя.
                    </h2>

                    <p class="iron-pay-order"></p>

                    <div class="iron-pay-totals">
                        <div>
                            <span>Компьютеры</span>
                            <strong class="iron-pay-subtotal"></strong>
                        </div>

                        <div>
                            <span>Доставка / самовывоз</span>
                            <strong class="iron-pay-delivery"></strong>
                        </div>

                        <div class="iron-pay-total">
                            <span>К оплате</span>
                            <strong class="iron-pay-amount"></strong>
                        </div>
                    </div>

                    <p class="iron-pay-label">
                        Выбери способ оплаты
                    </p>

                    <div class="iron-pay-methods">
                        <button
                            type="button"
                            class="iron-pay-button iron-pay-google"
                            data-method="Google Pay"
                            aria-label="Buy with Google Pay"
                        >
                            <span>Buy with</span>

                            <img
                                src="/static/images/payments/google-pay.svg"
                                alt="Google Pay"
                            >

                            <span class="iron-pay-fallback" hidden>
                                Google Pay
                            </span>
                        </button>

                        <button
                            type="button"
                            class="iron-pay-button iron-pay-apple"
                            data-method="Apple Pay"
                            aria-label="Buy with Apple Pay"
                        >
                            <span>Buy with</span>

                            <span class="iron-pay-apple-mark">
                                <img
                                    src="/static/images/payments/apple.svg"
                                    alt="Apple"
                                >

                                <span class="iron-pay-fallback" hidden>
                                    Apple
                                </span>

                                <span>Pay</span>
                            </span>
                        </button>

                        <button
                            type="button"
                            class="iron-pay-button iron-pay-visa"
                            data-method="Visa / Mastercard"
                            aria-label="Оплатить картой Visa или Mastercard"
                        >
                            <span>Pay with</span>

                            <img
                                src="/static/images/payments/visa.png"
                                alt="Visa"
                            >

                            <span class="iron-pay-fallback" hidden>
                                VISA
                            </span>
                        </button>
                    </div>

                    <p class="iron-pay-note">
                        Это демонстрация. Деньги не списываются,<br>
                        данные карты вводить не нужно.
                    </p>

                    <p
                        class="iron-pay-error"
                        role="alert"
                        hidden
                    ></p>
                </section>

                <section
                    class="iron-pay-processing"
                    role="status"
                    hidden
                >
                    <div
                        class="iron-pay-spinner"
                        aria-hidden="true"
                    ></div>

                    <h2>Обрабатываем оплату…</h2>

                    <p class="iron-pay-processing-method"></p>

                    <p class="iron-pay-note">
                        Подожди немного.
                        Реального списания не будет.
                    </p>
                </section>

                <section
                    class="iron-pay-success"
                    role="status"
                    hidden
                >
                    <div
                        class="iron-pay-check"
                        aria-hidden="true"
                    >
                        <svg viewBox="0 0 48 48" fill="none">
                            <path
                                d="M12 25L20 33L36 16"
                                stroke="white"
                                stroke-width="4"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                            />
                        </svg>
                    </div>

                    <p class="iron-pay-eyebrow">
                        ВСЁ ПОЛУЧИЛОСЬ
                    </p>

                    <h2 tabindex="-1">
                        Поздравляем<br>с покупкой!
                    </h2>

                    <p>Твоё новое железо — новый старт.</p>

                    <strong class="iron-pay-success-amount"></strong>

                    <p class="iron-pay-success-order"></p>
                    <p class="iron-pay-success-method"></p>

                    <button
                        type="button"
                        class="button iron-pay-done"
                    >
                        Отлично ↗
                    </button>

                    <p class="iron-pay-note">
                        Демонстрационная оплата завершена.<br>
                        Реальные деньги не списывались.
                    </p>
                </section>
            </div>
        `;

        const choice = dialog.querySelector(".iron-pay-choice");
        const processing = dialog.querySelector(".iron-pay-processing");
        const success = dialog.querySelector(".iron-pay-success");
        const errorBox = dialog.querySelector(".iron-pay-error");
        const closeButton = dialog.querySelector(".iron-pay-close");

        const buttons = [
            ...dialog.querySelectorAll("[data-method]"),
        ];

        let processingPayment = false;
        let completed = false;
        let stopConfetti = () => {};

        const previousOverflow = document.body.style.overflow;

        dialog.querySelector(".iron-pay-order").textContent =
            `Заказ ${order.id}`;

        dialog.querySelector(".iron-pay-subtotal").textContent =
            money(order.subtotal);

        dialog.querySelector(".iron-pay-delivery").textContent =
            money(order.delivery);

        dialog.querySelector(".iron-pay-amount").textContent =
            money(order.total);

        buttons.forEach(button => {
            button.disabled = !order.payment_options.includes(
                button.dataset.method
            );

            const image = button.querySelector("img");

            image.addEventListener("error", () => {
                image.hidden = true;

                button.querySelector(
                    ".iron-pay-fallback"
                ).hidden = false;
            });

            button.addEventListener("click", async () => {
                if (processingPayment || completed) return;

                processingPayment = true;

                buttons.forEach(item => {
                    item.disabled = true;
                });

                closeButton.disabled = true;
                errorBox.hidden = true;

                button.classList.add("is-pressed");

                const method = button.dataset.method;

                choice.hidden = true;
                processing.hidden = false;

                dialog.querySelector(
                    ".iron-pay-processing-method"
                ).textContent = `${method} · ${money(order.total)}`;

                try {
                    // Анимация идёт одновременно с запросом.
                    const [paid] = await Promise.all([
                        pay(method),
                        new Promise(resolve => {
                            window.setTimeout(resolve, 1200);
                        }),
                    ]);

                    if (
                        !paid
                        || paid.status !== "paid"
                        || paid.id !== order.id
                    ) {
                        throw new Error(
                            "Сервер не подтвердил оплату заказа."
                        );
                    }

                    completed = true;

                    processing.hidden = true;
                    success.hidden = false;

                    dialog.querySelector(
                        ".iron-pay-success-amount"
                    ).textContent = money(paid.total);

                    dialog.querySelector(
                        ".iron-pay-success-order"
                    ).textContent = `Заказ ${paid.id}`;

                    dialog.querySelector(
                        ".iron-pay-success-method"
                    ).textContent =
                        `Способ оплаты: ${paid.payment}`;

                    dialog.querySelector(
                        ".iron-pay-sheet"
                    ).scrollTop = 0;

                    success.querySelector("h2").focus({
                        preventScroll: true,
                    });

                    stopConfetti = celebrate(dialog);

                } catch (error) {
                    processing.hidden = true;
                    choice.hidden = false;

                    errorBox.textContent = error.message
                        || "Не удалось получить результат оплаты. "
                        + "Попробуй ещё раз.";

                    errorBox.hidden = false;

                    buttons.forEach(item => {
                        item.disabled =
                            !order.payment_options.includes(
                                item.dataset.method
                            );
                    });

                    button.classList.remove("is-pressed");
                    button.focus();

                } finally {
                    processingPayment = false;
                    closeButton.disabled = false;
                }
            });
        });

        closeButton.addEventListener("click", () => {
            if (!processingPayment) {
                dialog.close();
            }
        });

        dialog.querySelector(
            ".iron-pay-done"
        ).addEventListener("click", () => {
            dialog.close();
        });

        dialog.addEventListener("cancel", event => {
            if (processingPayment) {
                event.preventDefault();
            }
        });

        dialog.addEventListener("close", () => {
            stopConfetti();

            document.body.style.overflow = previousOverflow;

            activeDialog = null;
            dialog.remove();
        }, { once: true });

        document.body.append(dialog);

        activeDialog = dialog;
        document.body.style.overflow = "hidden";

        dialog.showModal();

        buttons.find(button => !button.disabled)?.focus();
    }


    window.IronPayment = { open };
})();