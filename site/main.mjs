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

function initNotebookPages() {
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  for (const page of document.querySelectorAll('.hero.notebook-page')) {
    let frame;
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      page.classList.remove('is-page-active');
      page.style.setProperty('--page-tilt-x', '0deg');
      page.style.setProperty('--page-tilt-y', '0deg');
    };
    page.addEventListener('pointermove', event => {
      if (!finePointer.matches || reducedMotion.matches || event.pointerType === 'touch') return;
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const bounds = page.getBoundingClientRect();
        const horizontal = (event.clientX - bounds.left) / bounds.width - .5;
        const vertical = (event.clientY - bounds.top) / bounds.height - .5;
        page.classList.add('is-page-active');
        page.style.setProperty('--page-tilt-x', `${(-vertical * 1.2).toFixed(2)}deg`);
        page.style.setProperty('--page-tilt-y', `${(horizontal * 1.4).toFixed(2)}deg`);
      });
    }, { passive: true });
    page.addEventListener('pointerleave', reset);
    window.addEventListener('blur', reset);
    finePointer.addEventListener('change', reset);
    reducedMotion.addEventListener('change', reset);
  }
}

function initCakeNotebook() {
  const notebook = byId('cake-notebook');
  const cover = byId('cake-cover');
  const gallery = byId('cake-gallery');
  const turn = byId('cake-page-turn');
  const close = byId('cake-book-close');
  const title = byId('cake-page-title');
  if (![notebook, cover, gallery, turn, close, title].every(Boolean)) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const staticPage = () => reducedMotion.matches || forcedColors.matches;
  // A missing/older stylesheet must never hide an otherwise usable gallery.
  if (staticPage() || getComputedStyle(notebook).getPropertyValue('--notebook-ready').trim() !== '1') return;
  let animation;
  let timer;

  const reveal = (moveFocus = false) => {
    const coverFocused = cover.contains(document.activeElement);
    const closeFocused = document.activeElement === close;
    clearTimeout(timer);
    if (animation) {
      animation.onfinish = animation.oncancel = null;
      animation.cancel();
      animation = undefined;
    }
    notebook.dataset.bookState = 'open';
    notebook.style.removeProperty('--cover-height');
    gallery.hidden = false;
    gallery.inert = false;
    gallery.removeAttribute('aria-hidden');
    cover.hidden = true;
    turn.setAttribute('aria-expanded', 'true');
    turn.removeAttribute('aria-disabled');
    close.hidden = staticPage();
    if (moveFocus && (coverFocused || (staticPage() && closeFocused))) {
      title.focus({ preventScroll: true });
      notebook.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  };
  const open = () => {
    if (notebook.dataset.bookState !== 'closed') return;
    if (staticPage() || typeof cover.animate !== 'function') {
      reveal(true);
      return;
    }
    notebook.style.setProperty('--cover-height', `${cover.offsetHeight}px`);
    notebook.dataset.bookState = 'opening';
    gallery.inert = true;
    gallery.setAttribute('aria-hidden', 'true');
    gallery.hidden = false;
    turn.setAttribute('aria-expanded', 'true');
    turn.setAttribute('aria-disabled', 'true');
    notebook.scrollIntoView({ block: 'start', behavior: 'instant' });
    try {
      animation = cover.animate([
        { transform: 'rotateX(0deg)', offset: 0 },
        { transform: 'rotateX(12deg)', offset: .18 },
        { transform: 'rotateX(95deg) scaleX(.96)', offset: .62 },
        { transform: 'rotateX(180deg)', offset: 1 },
      ], { duration: 950, easing: 'cubic-bezier(.35, 0, .2, 1)', fill: 'both' });
      animation.onfinish = animation.oncancel = () => reveal(true);
      timer = setTimeout(() => reveal(true), 1250);
    } catch (error) {
      console.warn('The notebook turn could not animate; showing all cakes directly.', error);
      reveal(true);
    }
  };
  const targetIsInside = () => {
    const target = byId(location.hash.slice(1));
    return target && gallery.contains(target);
  };
  turn.addEventListener('click', open);
  close.addEventListener('click', () => {
    if (staticPage() || notebook.dataset.bookState !== 'open') return;
    gallery.hidden = true;
    cover.hidden = false;
    notebook.dataset.bookState = 'closed';
    turn.setAttribute('aria-expanded', 'false');
    notebook.scrollIntoView({ block: 'start', behavior: 'instant' });
    turn.focus({ preventScroll: true });
    turn.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  });
  const preferencesChanged = () => {
    if (staticPage()) reveal(true);
  };
  reducedMotion.addEventListener('change', preferencesChanged);
  forcedColors.addEventListener('change', preferencesChanged);
  window.addEventListener('hashchange', () => { if (targetIsInside()) reveal(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && notebook.dataset.bookState === 'opening') reveal();
  });
  window.addEventListener('resize', () => {
    if (notebook.dataset.bookState === 'opening') reveal(true);
  });
  window.addEventListener('pagehide', () => {
    if (notebook.dataset.bookState === 'opening') reveal();
  });
  close.hidden = false;
  if (targetIsInside()) {
    reveal();
  } else {
    notebook.dataset.bookState = 'closed';
    cover.hidden = false;
    gallery.hidden = true;
  }
}

initGallery();
initMobileContact();
initNotebookPages();
initCakeNotebook();
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
