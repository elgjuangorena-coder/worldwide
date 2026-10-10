import { escapeHtml, normalize } from './utils.js';

const $ = (id) => document.getElementById(id);

export const isMobile = () => window.matchMedia('(max-width: 767px)').matches;

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

/* ---------- Header, stats, body ---------- */

export function setHeader({ kicker, title, subtitle, onBack }) {
  $('sheet-kicker').textContent = kicker ?? '';
  $('sheet-title').textContent = title;
  $('sheet-title').title = title;
  $('sheet-subtitle').textContent = subtitle ?? '';
  $('sheet-subtitle').hidden = !subtitle;
  const back = $('back-btn');
  back.hidden = !onBack;
  back.onclick = onBack ?? null;
}

export function setStats(stats) {
  $('sheet-stats').replaceChildren(
    ...stats.map((s) => el('div', { class: 'stat' }, [el('strong', { text: s.value }), el('span', { text: s.label })])),
  );
}

export function setBody(...nodes) {
  const body = $('sheet-body');
  body.replaceChildren(...nodes.filter(Boolean));
  body.scrollTop = 0;
}

export function hint(text) {
  return el('p', { class: 'hint', text });
}

function chipClass(category) {
  if (category === 'Para ver') return 'chip chip-ver';
  if (category === 'Para comer') return 'chip chip-comer';
  return 'chip';
}

export function sectionTitle(text) {
  return el('h2', { class: 'section-title', text });
}

export function regionList(items, onSelect) {
  return el('ul', { class: 'list' }, items.map((item) => el('li', {}, el('button', {
    class: `row${item.count ? '' : ' empty'}`,
    type: 'button',
    onclick: () => onSelect(item.uid),
  }, [
    item.color ? el('span', { class: 'dot', style: `background:${item.color}` }) : null,
    el('span', { class: 'row-text' }, [
      el('span', { class: 'row-name', text: item.name }),
      item.sub ? el('span', { class: 'row-sub', text: item.sub }) : null,
    ]),
    el('span', { class: `badge${item.count ? '' : ' zero'}`, text: String(item.count) }),
  ]))));
}

export function landmarkCards(list, { onShow, onToggleVisited, isVisited, mapsUrl, start = 0 }) {
  return el('ul', { class: 'list' }, list.map((lm, i) => {
    const visited = isVisited(lm.id);
    return el('li', {}, el('article', { class: `card${visited ? ' visited' : ''}` }, [
      el('div', { class: 'card-top' }, [
        el('span', { class: 'card-num', text: String(start + i + 1) }),
        el('div', {}, [
          el('h3', { class: 'card-name', text: lm.name }),
          lm.neighborhood ? el('p', { class: 'card-hood', text: lm.neighborhood }) : null,
          lm.category ? el('span', { class: chipClass(lm.category), text: lm.category }) : null,
        ]),
      ]),
      lm.description ? el('p', { class: 'card-desc', text: lm.description }) : null,
      el('div', { class: 'actions' }, [
        el('button', { class: 'btn', type: 'button', text: 'Ver en el mapa', onclick: () => onShow(lm.id) }),
        el('a', { class: 'btn primary', href: mapsUrl(lm), target: '_blank', rel: 'noopener', text: 'Google Maps' }),
        el('button', {
          class: `btn${visited ? ' ok' : ''}`,
          type: 'button',
          text: visited ? 'Visitado' : 'Marcar visitado',
          onclick: () => onToggleVisited(lm.id),
        }),
      ]),
    ]));
  }));
}

export function popupContent(lm, { place, visited, mapsUrl, onToggleVisited }) {
  const toggle = el('button', {
    class: `btn${visited ? ' ok' : ''}`,
    type: 'button',
    text: visited ? 'Visitado' : 'Marcar visitado',
    onclick: () => onToggleVisited(lm.id),
  });
  return el('div', { class: 'popup' }, [
    el('h3', { text: lm.name }),
    lm.category ? el('span', { class: chipClass(lm.category), text: lm.category }) : null,
    place ? el('p', { class: 'place', text: place }) : null,
    lm.description ? el('p', { text: lm.description }) : null,
    el('div', { class: 'actions' }, [
      el('a', { class: 'btn primary', href: mapsUrl, target: '_blank', rel: 'noopener', text: 'Abrir en Google Maps' }),
      toggle,
    ]),
  ]);
}

/** Shows how much space the downloaded boundary files use, with a button to delete them. */
export function storagePanel({ load, onClear }) {
  const text = el('p', { class: 'storage-text', text: 'Calculando…' });
  const button = el('button', { class: 'btn', type: 'button', text: 'Borrar mapas descargados', hidden: true });
  const box = el('div', { class: 'storage' }, [text, button]);

  const refresh = async () => {
    const { countries, megabytes } = await load();
    if (!countries.length) {
      text.textContent = 'No hay mapas descargados. Se guardan solos cuando entras a un país para que la próxima vez cargue rápido.';
      button.hidden = true;
      return;
    }
    const donde = countries.length === 1 ? 'al país' : 'a esos países';
    text.textContent = `${countries.join(', ')} · ${megabytes.toFixed(1)} MB. Borrar libera ese espacio hasta que vuelvas a entrar ${donde}.`;
    button.hidden = false;
  };

  button.addEventListener('click', async () => {
    if (!window.confirm('¿Borrar los mapas descargados? Tus landmarks y visitados no se borran.')) return;
    button.disabled = true;
    await onClear();
    button.disabled = false;
    refresh();
  });
  refresh().catch(() => { text.textContent = 'Este navegador no permite guardar mapas.'; });
  return box;
}

/* ---------- Breadcrumb ---------- */

export function renderBreadcrumb(items) {
  const nav = $('breadcrumb');
  const nodes = [];
  items.forEach((item, i) => {
    if (i > 0) nodes.push(el('span', { class: 'sep', text: '›' }));
    const last = i === items.length - 1;
    nodes.push(el('button', {
      type: 'button',
      text: item.label,
      'aria-current': last ? 'true' : null,
      onclick: last ? null : item.onClick,
    }));
  });
  nav.replaceChildren(...nodes);
  nav.scrollLeft = nav.scrollWidth;
}

/* ---------- Loading and toast ---------- */

let loadingCount = 0;

export function showLoading(text) {
  const box = $('loading');
  const bar = $('loading-progress');
  loadingCount += 1;
  $('loading-text').textContent = text;
  box.classList.add('indeterminate');
  bar.style.width = '0%';
  box.hidden = false;
  let finished = false;
  return {
    progress(p) {
      if (p === null || p === undefined) return;
      box.classList.remove('indeterminate');
      bar.style.width = `${Math.round(Math.min(1, p) * 100)}%`;
    },
    done() {
      if (finished) return;
      finished = true;
      loadingCount -= 1;
      if (loadingCount <= 0) {
        loadingCount = 0;
        box.hidden = true;
      }
    },
  };
}

let toastTimer;

export function toast(message, ms = 3500) {
  const node = $('toast');
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/* ---------- Bottom sheet (celular) ---------- */

const SNAPS = ['peek', 'half', 'full'];
let snap = 'half';
let onSheetChange = () => {};

function snapHeight(name) {
  const vh = window.innerHeight;
  if (name === 'peek') {
    const header = document.querySelector('.sheet-header');
    const grip = $('sheet-grip');
    return Math.round((grip?.offsetHeight ?? 26) + (header?.offsetHeight ?? 60) + 12);
  }
  if (name === 'full') return Math.round(vh * 0.88);
  return Math.round(vh * 0.45);
}

export function sheetVisibleHeight() {
  return isMobile() ? snapHeight(snap) : 0;
}

export function setSnap(name) {
  snap = name;
  const sheet = $('sheet');
  sheet.dataset.snap = name;
  document.documentElement.style.setProperty('--sheet-visible', `${snapHeight(name)}px`);
  onSheetChange();
}

export function getSnap() {
  return snap;
}

export function setupSheet(onChange) {
  onSheetChange = onChange ?? onSheetChange;
  const sheet = $('sheet');
  const handles = [$('sheet-grip'), sheet.querySelector('.sheet-header')];
  let startY = 0;
  let startH = 0;
  let currentH = 0;
  let dragging = false;
  let moved = false;

  const onDown = (e) => {
    if (!isMobile() || e.target.closest('button')) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    startH = snapHeight(snap);
    currentH = startH;
    sheet.classList.add('dragging');
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onMove = (e) => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 4) moved = true;
    currentH = Math.max(snapHeight('peek') * 0.8, Math.min(window.innerHeight * 0.92, startH + dy));
    document.documentElement.style.setProperty('--sheet-visible', `${currentH}px`);
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    if (!moved) {
      setSnap(snap === 'full' ? 'peek' : SNAPS[SNAPS.indexOf(snap) + 1]);
      return;
    }
    let best = snap;
    let bestDist = Infinity;
    for (const name of SNAPS) {
      const d = Math.abs(snapHeight(name) - currentH);
      if (d < bestDist) { best = name; bestDist = d; }
    }
    setSnap(best);
  };

  for (const h of handles) {
    h.addEventListener('pointerdown', onDown);
    h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp);
    h.addEventListener('pointercancel', onUp);
  }

  window.addEventListener('resize', () => setSnap(snap));
  setSnap(snap);
}

/* ---------- Buscador ---------- */

export function setupSearch({ search, onSelect }) {
  const input = $('search-input');
  const list = $('search-results');
  let results = [];
  let active = -1;
  let timer;

  const close = () => {
    list.hidden = true;
    active = -1;
  };

  const choose = (i) => {
    const item = results[i];
    if (!item) return;
    input.value = '';
    input.blur();
    close();
    onSelect(item);
  };

  const render = () => {
    const query = normalize(input.value);
    if (!query) return close();
    results = search(query).slice(0, 30);
    active = results.length ? 0 : -1;
    if (!results.length) {
      list.innerHTML = '<li class="res-empty">Sin resultados</li>';
    } else {
      list.innerHTML = results.map((r, i) => `
        <li role="option"><button type="button" data-i="${i}" class="${i === active ? 'active' : ''}">
          <span><span class="res-name">${escapeHtml(r.name)}</span>
          ${r.sub ? `<span class="res-sub">${escapeHtml(r.sub)}</span>` : ''}</span>
          <span class="res-type">${escapeHtml(r.typeLabel)}</span>
        </button></li>`).join('');
    }
    list.hidden = false;
  };

  const highlight = () => {
    list.querySelectorAll('button').forEach((b, i) => b.classList.toggle('active', i === active));
    list.querySelector('button.active')?.scrollIntoView({ block: 'nearest' });
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(render, 120);
  });
  input.addEventListener('focus', () => { if (input.value) render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); highlight(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); highlight(); e.preventDefault(); }
    else if (e.key === 'Enter') { clearTimeout(timer); if (list.hidden) render(); choose(Math.max(active, 0)); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  list.addEventListener('pointerdown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (btn) choose(Number(btn.dataset.i));
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}
