export const CAKE_WEIGHTS = [
  { grams: 500, label: '1/2 KG' },
  { grams: 1000, label: '1 KG' },
  { grams: 1500, label: '1.5 KG' },
  { grams: 2000, label: '2 KG' },
  { grams: 2500, label: '2.5 KG' },
  { grams: 3000, label: '3 KG' },
];

export function cakePages(ids) {
  if (!Array.isArray(ids)) throw new TypeError('Notebook cake IDs must be an array.');
  return Array.from({ length: Math.ceil(ids.length / 4) }, (_, index) => ids.slice(index * 4, index * 4 + 4));
}

export function pageTarget(index, direction, count) {
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(index) || index < 0 ||
      index >= count || ![-1, 1].includes(direction)) {
    throw new RangeError('A page turn needs a valid page, direction and page count.');
  }
  return Math.max(0, Math.min(count - 1, index + direction));
}

export function dragCompletesTurn(distance, height) {
  if (!Number.isFinite(distance) || !Number.isFinite(height) || height <= 0) {
    throw new RangeError('A page drag needs a finite distance and positive page height.');
  }
  return distance >= Math.min(180, Math.max(72, height * .25));
}

export function initCategoryNotebooks() {
  const library = document.getElementById('cake-gallery');
  const overview = document.getElementById('category-notebooks');
  const dialog = document.getElementById('notebook-dialog');
  const mount = document.getElementById('notebook-mount');
  const dialogTitle = document.getElementById('notebook-dialog-title');
  const closeButton = document.getElementById('notebook-close');
  if (![library, overview, dialog, mount, dialogTitle, closeButton].every(Boolean)) return;
  const covers = [...overview.querySelectorAll('[data-open-notebook]')];
  const books = [...library.querySelectorAll('.category-notebook')].map(element => ({
    element,
    title: element.querySelector('.notebook-heading h3'),
    binding: element.querySelector('.spiral-binding'),
    pages: [...element.querySelectorAll('[data-notebook-page]')],
    stage: element.querySelector('.notebook-stage'),
    controls: element.querySelector('.notebook-controls'),
    previous: element.querySelector('[data-page-previous]'),
    next: element.querySelector('[data-page-next]'),
    counter: element.querySelector('[data-page-counter]'),
    announcement: element.querySelector('[data-page-announcement]'),
    dragButton: element.querySelector('[data-page-drag]'),
  }));
  if (!books.length || books.some(book => !book.pages.length ||
      ![book.title, book.binding, book.stage, book.controls, book.previous, book.next, book.counter, book.announcement, book.dragButton].every(Boolean))) {
    console.warn('The category notebook markup is incomplete; keeping every page visible.');
    return;
  }
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const forcedColors = matchMedia('(forced-colors: active)');
  const print = matchMedia('print');
  const wantsStatic = () => reducedMotion.matches || forcedColors.matches || print.matches;
  const linkedPage = () => {
    const target = document.getElementById(location.hash.slice(1));
    return target && (target === library || books.some(book => book.element.contains(target))) ? target : null;
  };
  if (wantsStatic() || linkedPage() || typeof dialog.showModal !== 'function' ||
      getComputedStyle(overview).getPropertyValue('--notebooks-ready').trim() !== '1') return;

  let active;
  let index = 0;
  let pending;
  let effect;
  let timer;
  let zoom;
  let zoomTimer;
  let drag;
  let opener;
  let placeholder;
  let enhanced = true;
  let suppressClick = false;
  let fitFrame;

  const scheduleFitCheck = () => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(() => {
      if (!active || !dialog.open || active.element.dataset.turnState !== 'idle' ||
          active.element.getAnimations?.().length || document.fonts?.status === 'loading') return;
      const page = active.pages[index];
      const bounds = dialog.getBoundingClientRect();
      const content = [...page.querySelectorAll('img, h4, a, .weight-size')];
      const clipped = [dialog, active.stage, page].some(node =>
        node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1
      ) || [...page.querySelectorAll('.cake-card')].some(card =>
        card.querySelector('.photo-link').getBoundingClientRect().bottom >
          card.querySelector('.cake-card-info').getBoundingClientRect().top + 1
      ) || content.some(node => {
        const box = node.getBoundingClientRect();
        return box.top < bounds.top || box.bottom > bounds.bottom ||
          box.left < bounds.left || box.right > bounds.right ||
          (node.tagName === 'IMG' && box.height < 24);
      });
      if (!clipped) return;
      const title = page.querySelector('[data-page-title]');
      console.warn('Four photos cannot fit this viewport/text size safely; showing the complete static notebooks.');
      restoreStatic();
      let notice = document.getElementById('notebook-fit-note');
      if (!notice) {
        notice = document.createElement('p');
        notice.id = 'notebook-fit-note';
        notice.className = 'small-note';
        notice.setAttribute('role', 'status');
        notice.textContent = 'For this screen or text size, photos are shown below so nothing is cut off.';
        overview.before(notice);
      }
      title.focus();
    });
  };

  const stopZoom = () => {
    clearTimeout(zoomTimer);
    if (zoom) {
      zoom.onfinish = zoom.oncancel = null;
      zoom.cancel();
      zoom = undefined;
    }
    scheduleFitCheck();
  };
  const updateControls = () => {
    active.element.dataset.pageIndex = String(index);
    active.counter.textContent = `${index + 1} / ${active.pages.length}`;
    active.counter.setAttribute('aria-label', `Page ${index + 1} of ${active.pages.length}`);
    active.announcement.textContent = `Page ${index + 1} of ${active.pages.length}`;
    active.previous.disabled = index === 0;
    active.next.disabled = index === active.pages.length - 1;
    active.dragButton.disabled = active.next.disabled;
    active.dragButton.hidden = active.pages.length < 2;
  };
  const finishTurn = (target, moveFocus = true) => {
    if (!active) return;
    clearTimeout(timer);
    if (effect) {
      effect.onfinish = effect.oncancel = null;
      effect.cancel();
      effect = undefined;
    }
    const hadFocus = active.element.contains(document.activeElement);
    const gesture = drag;
    drag = undefined;
    if (gesture && active.dragButton.hasPointerCapture(gesture.pointerId)) {
      active.dragButton.releasePointerCapture(gesture.pointerId);
    }
    pending = undefined;
    index = target;
    active.stage.style.removeProperty('height');
    active.element.dataset.turnState = 'idle';
    for (const [number, page] of active.pages.entries()) {
      page.classList.remove('is-turning-sheet');
      page.style.removeProperty('transform');
      page.style.removeProperty('transform-origin');
      page.hidden = number !== index;
      page.inert = false;
      page.removeAttribute('aria-hidden');
    }
    updateControls();
    scheduleFitCheck();
    if (moveFocus && hadFocus) {
      active.pages[index].querySelector('[data-page-title]').focus({ preventScroll: true });
      dialog.scrollTo({ top: 0, behavior: 'instant' });
    }
  };
  const prepareTurn = target => {
    stopZoom();
    const oldPage = active.pages[index];
    const newPage = active.pages[target];
    const currentHeight = oldPage.offsetHeight;
    newPage.hidden = false;
    const height = Math.max(currentHeight, newPage.offsetHeight);
    active.stage.style.height = `${height}px`;
    if (oldPage.contains(document.activeElement)) active.title.focus({ preventScroll: true });
    for (const page of [oldPage, newPage]) {
      page.inert = true;
      page.setAttribute('aria-hidden', 'true');
    }
    const turning = target > index ? oldPage : newPage;
    turning.classList.add('is-turning-sheet');
    // The sheet starts below the heading; its hinge stays at the actual spiral slots.
    const bindingLine = active.binding.getBoundingClientRect().bottom - 8;
    turning.style.transformOrigin = `center ${bindingLine - active.stage.getBoundingClientRect().top}px`;
    pending = target;
    active.element.dataset.turnState = 'turning';
    return turning;
  };
  const animateTurn = (page, from, to, target) => {
    if (wantsStatic() || typeof page.animate !== 'function') {
      finishTurn(target);
      return;
    }
    try {
      effect = page.animate([
        { transform: `rotateX(${from}deg)` },
        { transform: `rotateX(${to}deg)` },
      ], { duration: Math.max(180, 650 * Math.abs(to - from) / 180),
        easing: 'cubic-bezier(.35, 0, .2, 1)', fill: 'both' });
      effect.onfinish = effect.oncancel = () => finishTurn(target);
      timer = setTimeout(() => finishTurn(target), 1000);
    } catch (error) {
      console.warn('The notebook page could not animate; changing pages without motion.', error);
      finishTurn(target);
    }
  };
  const turn = direction => {
    if (!active || pending !== undefined || drag) return;
    const target = pageTarget(index, direction, active.pages.length);
    if (target === index) return;
    const page = prepareTurn(target);
    animateTurn(page, direction > 0 ? 0 : 180, direction > 0 ? 180 : 0, target);
  };
  const restoreBook = (restoreFocus = true) => {
    if (!active) return;
    stopZoom();
    finishTurn(index, false);
    const book = active;
    active = undefined;
    book.controls.hidden = true;
    book.dragButton.hidden = true;
    book.element.classList.remove('is-open-notebook');
    for (const page of book.pages) page.hidden = false;
    placeholder.replaceWith(book.element);
    placeholder = undefined;
    document.body.classList.remove('has-notebook-dialog');
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const close = () => {
    if (dialog.open) dialog.close();
    restoreBook();
  };
  const restoreStatic = () => {
    close();
    enhanced = false;
    library.hidden = false;
    overview.classList.remove('is-enhanced');
    for (const cover of covers) {
      cover.removeAttribute('role');
      cover.removeAttribute('aria-haspopup');
      cover.removeAttribute('aria-controls');
    }
  };
  const openBook = cover => {
    if (!enhanced) return false;
    const book = books.find(item => item.element.id === cover.dataset.openNotebook);
    if (!book) return false;
    if (active) close();
    opener = cover;
    const start = cover.getBoundingClientRect();
    placeholder = document.createComment('Category notebook home');
    book.element.before(placeholder);
    mount.append(book.element);
    active = book;
    index = 0;
    book.element.classList.add('is-open-notebook');
    book.controls.hidden = book.pages.length < 2;
    dialogTitle.textContent = book.title.textContent;
    finishTurn(0, false);
    try {
      dialog.showModal();
    } catch (error) {
      console.warn('The notebook dialog is unavailable; showing every page directly.', error);
      restoreStatic();
      return false;
    }
    document.body.classList.add('has-notebook-dialog');
    scheduleFitCheck();
    dialog.scrollTo({ top: 0, behavior: 'instant' });
    book.pages[0].querySelector('[data-page-title]').focus({ preventScroll: true });
    if (!wantsStatic() && typeof book.element.animate === 'function') {
      const end = book.element.getBoundingClientRect();
      const scale = Math.max(.1, Math.min(.95, start.width / end.width));
      const x = start.left + start.width / 2 - end.left - end.width / 2;
      const y = start.top + start.height / 2 - end.top - end.height / 2;
      try {
        zoom = book.element.animate([
          { transform: `translate(${x}px, ${y}px) scale(${scale})`, opacity: .65 },
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        ], { duration: 380, easing: 'cubic-bezier(.2, .7, .2, 1)' });
        zoom.onfinish = zoom.oncancel = stopZoom;
        zoomTimer = setTimeout(stopZoom, 600);
      } catch (error) {
        console.warn('The notebook zoom is unavailable; the open notebook remains usable.', error);
      }
    }
    return true;
  };
  for (const cover of covers) {
    cover.setAttribute('role', 'button');
    cover.setAttribute('aria-haspopup', 'dialog');
    cover.setAttribute('aria-controls', 'notebook-dialog');
    cover.addEventListener('click', event => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (openBook(cover)) event.preventDefault();
    });
    cover.addEventListener('keydown', event => {
      if (enhanced && event.key === ' ' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        openBook(cover);
      }
    });
  }
  for (const book of books) {
    book.previous.addEventListener('click', () => { if (active === book) turn(-1); });
    book.next.addEventListener('click', () => { if (active === book) turn(1); });
    const handle = book.dragButton;
    handle.addEventListener('click', event => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
      } else if (active === book) turn(1);
    });
    handle.addEventListener('pointerdown', event => {
      if (active !== book || handle.disabled || event.button !== 0 || !event.isPrimary ||
          pending !== undefined || drag) return;
      stopZoom();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
        height: book.pages[index].offsetHeight, distance: 0, angle: 0, moved: false, page: null };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) >= 8;
      drag.distance = Math.max(0, drag.startY - event.clientY);
      if (drag.distance < 8 && !drag.page) return;
      if (!drag.page) drag.page = prepareTurn(index + 1);
      book.element.dataset.turnState = 'dragging';
      drag.angle = Math.min(175, 180 * drag.distance / Math.max(180, drag.height * .55));
      drag.page.style.transform = `rotateX(${drag.angle}deg)`;
    });
    const finishDrag = (event, cancelled) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const gesture = drag;
      drag = undefined;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (gesture.moved || cancelled) {
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
      }
      if (!gesture.page) return;
      const complete = !cancelled && dragCompletesTurn(gesture.distance, gesture.height);
      animateTurn(gesture.page, gesture.angle, complete ? 180 : 0, complete ? index + 1 : index);
    };
    handle.addEventListener('pointerup', event => finishDrag(event, false));
    handle.addEventListener('pointercancel', event => finishDrag(event, true));
    handle.addEventListener('lostpointercapture', event => finishDrag(event, true));
  }
  closeButton.addEventListener('click', close);
  dialog.addEventListener('close', () => { if (!dialog.open) restoreBook(); });
  dialog.addEventListener('keydown', event => {
    if (!active || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const direction = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (direction) {
      event.preventDefault();
      turn(direction);
    }
  });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) close();
  });
  const settle = () => {
    stopZoom();
    if (active && (pending !== undefined || drag)) finishTurn(drag ? index : pending, false);
    scheduleFitCheck();
  };
  if (typeof ResizeObserver === 'function') {
    const fitObserver = new ResizeObserver(scheduleFitCheck);
    fitObserver.observe(dialog);
    for (const book of books) {
      for (const node of book.element.querySelectorAll('.cake-card-info, .notebook-sheet-copy, .weight-list')) {
        fitObserver.observe(node);
      }
    }
  }
  document.fonts?.ready.then(scheduleFitCheck);
  document.fonts?.addEventListener('loadingdone', scheduleFitCheck);
  document.fonts?.addEventListener('loadingerror', scheduleFitCheck);
  window.addEventListener('resize', settle);
  window.addEventListener('blur', settle);
  window.addEventListener('pagehide', close);
  document.addEventListener('visibilitychange', () => { if (document.hidden) settle(); });
  for (const preference of [reducedMotion, forcedColors, print]) {
    preference.addEventListener('change', () => { if (wantsStatic()) restoreStatic(); });
  }
  window.addEventListener('beforeprint', restoreStatic);
  window.addEventListener('hashchange', () => {
    if (linkedPage()) {
      const target = linkedPage();
      restoreStatic();
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  });
  overview.classList.add('is-enhanced');
  library.hidden = true;
}
