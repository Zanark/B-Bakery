const byId = id => document.getElementById(id);
const plainClick = event => event.button === 0 &&
  !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

function initGallery() {
  const dialog = byId('photo-dialog');
  if (!dialog || typeof dialog.showModal !== 'function') return;
  const image = byId('photo-image');
  const title = byId('photo-title');
  const close = byId('photo-close');
  const previous = byId('photo-prev');
  const next = byId('photo-next');
  const counter = byId('photo-counter');
  const error = byId('photo-error');
  const links = [...document.querySelectorAll('a[data-photo]')];
  const photos = [...document.querySelectorAll('.cake-grid a[data-photo]')];
  if (![image, title, close, previous, next, counter, error].every(Boolean) || !photos.length) return;
  let index = 0;
  let opener;

  image.addEventListener('load', () => {
    if (image.naturalWidth > 0) {
      image.hidden = false;
      error.hidden = true;
    }
  });
  image.addEventListener('error', () => {
    if (image.complete && image.naturalWidth === 0) {
      image.hidden = true;
      error.hidden = false;
    }
  });
  const showPhoto = position => {
    index = (position + photos.length) % photos.length;
    const photo = photos[index];
    image.hidden = true;
    error.hidden = true;
    image.alt = photo.dataset.photoAlt;
    title.textContent = photo.dataset.photoTitle;
    counter.textContent = `Photo ${index + 1} of ${photos.length}`;
    image.src = photo.href;
  };
  for (const link of links) {
    link.addEventListener('click', event => {
      if (!plainClick(event)) return;
      const position = photos.findIndex(photo => photo.href === link.href);
      if (position < 0) return;
      showPhoto(position);
      try {
        dialog.showModal();
      } catch (failure) {
        console.warn('The photo viewer is unavailable; opening the image link instead.', failure);
        return;
      }
      opener = link;
      event.preventDefault();
    });
  }
  previous.disabled = next.disabled = photos.length < 2;
  previous.addEventListener('click', () => showPhoto(index - 1));
  next.addEventListener('click', () => showPhoto(index + 1));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      showPhoto(index + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
  dialog.addEventListener('close', () => opener?.focus({ preventScroll: true }));
}

function initMobileContact() {
  const link = document.querySelector('.mobile-enquire');
  const hero = byId('home');
  const order = byId('order');
  if (!link || !hero || !order || !window.IntersectionObserver) return;
  let heroVisible = true;
  let orderVisible = false;
  link.classList.add('is-contextual-hidden');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target === hero) heroVisible = entry.isIntersecting;
      if (entry.target === order) orderVisible = entry.isIntersecting;
    }
    link.classList.toggle('is-contextual-hidden', heroVisible || orderVisible);
  });
  observer.observe(hero);
  observer.observe(order);
}

initGallery();
initMobileContact();
const moduleVersion = new URL(import.meta.url).search;
const versionedModule = name => {
  const url = new URL(name, import.meta.url);
  url.search = moduleVersion;
  return url.href;
};
Promise.all([
  import(versionedModule('./entrance.mjs')),
  import(versionedModule('./bell.mjs')),
])
  .then(([{ initBakeryEntrance }, { tryRingBell }]) => initBakeryEntrance({ tryRingBell }))
  .catch(error => {
    const entrance = byId('bakery-entrance');
    if (entrance) {
      entrance.hidden = true;
      entrance.dataset.state = 'unavailable';
      entrance.dataset.audio = 'unavailable';
    }
    console.warn('The optional bakery entrance is unavailable; showing the site directly.', error);
  });
const year = byId('year');
if (year) year.textContent = String(new Date().getFullYear());
