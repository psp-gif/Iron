// Поиск и фильтры работают в браузере: сервер уже прислал карточки.
const search = document.querySelector('#search');
const category = document.querySelector('#category');
const condition = document.querySelector('#condition');
const sort = document.querySelector('#sort');
const grid = document.querySelector('.product-grid');
const cards = [...grid.children];
const params = new URLSearchParams(location.search);
search.value = params.get('q') || '';
category.value = ['game','office','work'].includes(params.get('category')) ? params.get('category') : '';
function filterCatalog() {
  const query = search.value.trim().toLocaleLowerCase('ru');
  let count = 0;
  cards.forEach(card => {
    const matches = card.dataset.name.toLocaleLowerCase('ru').includes(query)
      && (!category.value || card.dataset.category === category.value)
      && (!condition.value || card.dataset.condition === condition.value);
    card.hidden = !matches;
    if (matches) { count++; card.classList.add('visible'); }
  });
  const ordered = [...cards];
  if (sort.value !== 'default') ordered.sort((a,b) => (Number(a.dataset.price)-Number(b.dataset.price))*(sort.value === 'asc' ? 1 : -1));
  ordered.forEach(card => grid.append(card));
  document.querySelector('#result-count').textContent = `Найдено компьютеров: ${count}`;
  document.querySelector('#no-results').hidden = count !== 0;
}
search.addEventListener('input', filterCatalog);
[category,condition,sort].forEach(control => control.addEventListener('change', filterCatalog));
document.querySelector('#reset-filters').addEventListener('click', () => {
  search.value = category.value = condition.value = ''; sort.value = 'default'; filterCatalog(); search.focus();
});
filterCatalog();
