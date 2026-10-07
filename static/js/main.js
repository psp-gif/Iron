// Общие элементы: тема, меню, уведомления и появление блоков.
document.documentElement.classList.add('js');
const drawer = document.querySelector('#drawer');
const overlay = document.querySelector('#overlay');
const menuButton = document.querySelector('#menu-open');
let closingTimer;
function openMenu() {
  clearTimeout(closingTimer);
  drawer.hidden = overlay.hidden = false;
  // Два кадра дают браузеру отрисовать начальное состояние перехода.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    drawer.classList.add('open'); overlay.classList.add('open');
  }));
  document.body.style.overflow = 'hidden';
  menuButton.setAttribute('aria-expanded', 'true');
  document.querySelector('#menu-close').focus();
}
function closeMenu() {
  drawer.classList.remove('open'); overlay.classList.remove('open');
  document.body.style.overflow = '';
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.focus();
  closingTimer = setTimeout(() => { drawer.hidden = overlay.hidden = true; }, 260);
}
menuButton.addEventListener('click', openMenu);
document.querySelector('#menu-close').addEventListener('click', closeMenu);
overlay.addEventListener('click', closeMenu);
document.addEventListener('keydown', event => {
  if (drawer.hidden) return;
  if (event.key === 'Escape') closeMenu();
  if (event.key === 'Tab') {
    const controls = [...drawer.querySelectorAll('a,button')];
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});
document.querySelectorAll('.theme-toggle').forEach(button => button.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('iron-theme', theme); } catch (error) { /* Тема работает и без сохранения. */ }
}));
let toastTimer;
window.showToast = text => {
  const toast = document.querySelector('#toast');
  toast.textContent = text; toast.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('visible'), 2600);
};
const blocks = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); }
  }), { threshold: 0.05 });
  blocks.forEach(block => observer.observe(block));
} else { blocks.forEach(block => block.classList.add('visible')); }
