// В localStorage сохраняются только номера товаров и количество.
// Цены берём из каталога сервера, а не из сохранённых данных браузера.
const CART_KEY = 'iron-cart-v1';
function readCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([id, qty]) => /^\d+$/.test(id) && Number.isInteger(qty) && qty > 0 && qty <= 10));
  } catch (error) { return {}; }
}
let cart = readCart();
function updateCount() {
  const total = Object.values(cart).reduce((sum, qty) => sum + qty, 0);
  document.querySelectorAll('.cart-count').forEach(counter => { counter.textContent = total; });
}
function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
  catch (error) { window.showToast('Браузер не разрешил сохранить корзину. Она останется до закрытия страницы.'); }
  updateCount();
}
updateCount();
document.querySelectorAll('.add-cart').forEach(button => button.addEventListener('click', () => {
  const id = button.dataset.id;
  if ((cart[id] || 0) >= 10) { window.showToast('Лимит — 10 штук одной сборки.'); return; }
  cart[id] = (cart[id] || 0) + 1; saveCart();
  const counter = document.querySelector('.cart-count');
  counter.classList.remove('bump'); void counter.offsetWidth; counter.classList.add('bump');
  window.showToast('Компьютер добавлен в корзину');
}));
const cartPage = document.querySelector('#cart-page');
const money = amount => new Intl.NumberFormat('ru-RU').format(amount) + ' ₸';
// Пользовательский текст вставляем через textContent, не через HTML.
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className || '';
  if (text !== undefined) node.textContent = text;
  return node;
}
let products = [];
function renderCart() {
  cartPage.replaceChildren();
  const selected = products.filter(product => cart[product.id]);
  if (!selected.length) {
    const empty = element('div','empty');
    empty.append(element('h2','','Здесь пока пусто'),element('p','','Выбери компьютер — он появится в корзине.'));
    const link = element('a','button','Перейти в каталог ↗'); link.href = '/catalog'; empty.append(link); cartPage.append(empty); return;
  }
  const layout = element('div','cart-layout'); const list = element('div');
  let total = 0;
  selected.forEach(product => {
    const qty = cart[product.id]; total += product.price * qty;
    const row = element('article','cart-row'); const img = element('img'); img.src = product.image; img.alt = product.name;
    const info = element('div','cart-info'); const link = element('a'); link.href = '/product/' + product.id;
    link.append(element('h3','',product.name)); info.append(link,element('small','',product.cpu));
    const controls = element('div','quantity');
    [-1,1].forEach(delta => {
      const button = element('button','',delta === -1 ? '−' : '+');
      button.setAttribute('aria-label',(delta === -1 ? 'Уменьшить' : 'Увеличить')+' количество '+product.name);
      button.disabled = delta === 1 && qty >= 10;
      button.addEventListener('click', () => { cart[product.id] += delta; if (!cart[product.id]) delete cart[product.id]; saveCart(); renderCart(); });
      if (delta === 1) controls.append(element('span','',qty)); controls.append(button);
    });
    const remove = element('button','remove-item','Удалить'); remove.setAttribute('aria-label','Удалить '+product.name);
    remove.addEventListener('click', () => { delete cart[product.id]; saveCart(); renderCart(); });
    controls.append(remove); info.append(controls); row.append(img,info,element('strong','',money(product.price * qty))); list.append(row);
  });
  const summary = element('aside','cart-summary');
  summary.append(element('h3','','Твой заказ'),element('span','muted','Стоимость компьютеров'),element('strong','total',money(total)),element('p','','Доставка рассчитывается отдельно. В Астане и Алматы — бесплатно, другие города — 5 000 ₸.'));
  const next = element('a','button','К оформлению ↗'); next.href = '/assistant?mode=checkout'; summary.append(next,element('p','','Оформление через ИИ появится на следующем этапе. Сейчас заказ не отправляется.'));
  layout.append(list,summary); cartPage.append(layout);
}
if (cartPage) {
  fetch('/api/products').then(response => { if (!response.ok) throw new Error('catalog'); return response.json(); }).then(data => {
    products = data.products;
    const validIds = new Set(products.map(product => String(product.id)));
    cart = Object.fromEntries(Object.entries(cart).filter(([id]) => validIds.has(id)));
    saveCart(); renderCart();
  }).catch(() => {
    cartPage.replaceChildren(element('p','','Не удалось загрузить каталог. Обнови страницу, когда сервер будет доступен.'));
  });
}
window.addEventListener('storage', event => {
  if (event.key === CART_KEY || event.key === null) { cart = readCart(); updateCount(); if (cartPage && products.length) renderCart(); }
});
