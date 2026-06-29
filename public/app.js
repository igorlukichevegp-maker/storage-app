const API = '/api';

let categories = [];
let locations = [];
let suppliers = [];
let currentAdjustItem = null;
let currentDeleteItem = null;
let currentUser = null;

function isAdmin() { return currentUser && currentUser.role === 'admin'; }

// ---------- НАВИГАЦИЯ ----------
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'dashboard') loadDashboard();
    if (btn.dataset.view === 'inventory') loadItems();
    if (btn.dataset.view === 'history') loadHistory();
    if (btn.dataset.view === 'settings') loadSettings();
  });
});

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...opts,
  });
  if (res.status === 401) {
    showLoginScreen();
    throw new Error('Сессия истекла. Войдите снова.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Не удалось выполнить запрос' }));
    throw new Error(err.error || 'Не удалось выполнить запрос');
  }
  return res.status === 204 ? null : res.json();
}

// ---------- ОБЗОР ----------
async function loadDashboard() {
  const stats = await api('/stats');
  document.getElementById('stat-items').textContent = stats.totalItems;
  document.getElementById('stat-units').textContent = stats.totalUnits;
  document.getElementById('stat-low').textContent = stats.lowStock;
  document.getElementById('stat-locations').textContent = stats.totalLocations;

  const low = await api('/items?low=true');
  const list = document.getElementById('low-stock-list');
  list.innerHTML = '';
  if (low.length === 0) {
    list.innerHTML = '<p class="empty-state">Все товары выше порога. Склад в хорошем состоянии.</p>';
    return;
  }
  low.forEach(item => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="meta">${item.location || 'Без расположения'} · мин. ${item.min_quantity} ${item.unit}</div>
      </div>
      <span class="pill">осталось ${item.quantity} ${item.unit}</span>
    `;
    list.appendChild(row);
  });
}

// ---------- СКЛАД ----------
async function loadLookups() {
  categories = await api('/categories');
  locations = await api('/locations');
  suppliers = await api('/suppliers');

  const catFilter = document.getElementById('filter-category');
  const locFilter = document.getElementById('filter-location');
  const supFilter = document.getElementById('filter-supplier');
  catFilter.innerHTML = '<option value="">Все категории</option>' + categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  locFilter.innerHTML = '<option value="">Все расположения</option>' + locations.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join('');
  supFilter.innerHTML = '<option value="">Все поставщики</option>' + suppliers.map(s => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`).join('');

  const itemCat = document.getElementById('item-category');
  const itemLoc = document.getElementById('item-location');
  const itemSup = document.getElementById('item-supplier');
  itemCat.innerHTML = '<option value="">Без категории</option>' + categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  itemLoc.innerHTML = '<option value="">Без расположения</option>' + locations.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
  itemSup.innerHTML = '<option value="">Без поставщика</option>' + suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('');
}

async function loadItems() {
  if (categories.length === 0) await loadLookups();
  const q = document.getElementById('search-input').value;
  const category = document.getElementById('filter-category').value;
  const location = document.getElementById('filter-location').value;
  const supplier = document.getElementById('filter-supplier').value;
  const low = document.getElementById('filter-low').checked;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (location) params.set('location', location);
  if (supplier) params.set('supplier', supplier);
  if (low) params.set('low', 'true');

  const items = await api('/items?' + params.toString());
  const tbody = document.getElementById('items-tbody');
  tbody.innerHTML = '';
  document.getElementById('empty-state').classList.toggle('hidden', items.length > 0);

  items.forEach(item => {
    const isLow = item.quantity <= item.min_quantity;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}${item.notes ? `<div class="meta" style="color:var(--text-dim);font-size:12px">${escapeHtml(item.notes)}</div>` : ''}</td>
      <td class="sku">${item.sku ? escapeHtml(item.sku) : '—'}</td>
      <td>${item.category || '—'}</td>
      <td>${item.location || '—'}</td>
      <td>${item.supplier || '—'}</td>
      <td class="qty-cell">${item.quantity} ${escapeHtml(item.unit)}</td>
      <td><span class="${isLow ? 'status-low' : 'status-ok'}">${isLow ? 'Мало на складе' : 'В наличии'}</span></td>
      <td>
        ${isAdmin() ? `
        <div class="row-actions">
          <button class="btn small" data-action="adjust" data-id="${item.id}">Изменить</button>
          <button class="btn small" data-action="edit" data-id="${item.id}">Править</button>
          <button class="btn small danger" data-action="delete" data-id="${item.id}">Удалить</button>
        </div>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('search-input').addEventListener('input', debounce(loadItems, 250));
document.getElementById('filter-category').addEventListener('change', loadItems);
document.getElementById('filter-location').addEventListener('change', loadItems);
document.getElementById('filter-supplier').addEventListener('change', loadItems);
document.getElementById('filter-low').addEventListener('change', loadItems);

document.getElementById('items-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'edit') openEditModal(id);
  if (action === 'delete') openDeleteModal(id);
  if (action === 'adjust') openAdjustModal(id);
});

// ---------- МОДАЛЬНОЕ ОКНО ТОВАРА ----------
const itemModal = document.getElementById('item-modal');
document.getElementById('btn-add-item').addEventListener('click', () => openAddModal());
document.getElementById('modal-close').addEventListener('click', closeItemModal);
document.getElementById('btn-cancel').addEventListener('click', closeItemModal);

function closeItemModal() { itemModal.classList.add('hidden'); }

async function openAddModal() {
  if (categories.length === 0) await loadLookups();
  document.getElementById('modal-title').textContent = 'Добавить позицию';
  document.getElementById('item-form').reset();
  document.getElementById('item-id').value = '';
  document.getElementById('item-unit').value = 'шт';
  document.getElementById('qty-field').classList.remove('hidden');
  itemModal.classList.remove('hidden');
}

async function openEditModal(id) {
  const item = await api(`/items/${id}`);
  document.getElementById('modal-title').textContent = 'Изменить позицию';
  document.getElementById('item-id').value = item.id;
  document.getElementById('item-name').value = item.name;
  document.getElementById('item-sku').value = item.sku || '';
  document.getElementById('item-unit').value = item.unit;
  document.getElementById('item-category').value = item.category_id || '';
  document.getElementById('item-location').value = item.location_id || '';
  document.getElementById('item-supplier').value = item.supplier_id || '';
  document.getElementById('item-min').value = item.min_quantity;
  document.getElementById('item-notes').value = item.notes || '';
  document.getElementById('qty-field').classList.add('hidden'); // количество меняется через "Изменить", а не при редактировании
  itemModal.classList.remove('hidden');
}

document.getElementById('item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('item-id').value;
  const payload = {
    name: document.getElementById('item-name').value.trim(),
    sku: document.getElementById('item-sku').value.trim(),
    unit: document.getElementById('item-unit').value.trim() || 'шт',
    category_id: document.getElementById('item-category').value || null,
    location_id: document.getElementById('item-location').value || null,
    supplier_id: document.getElementById('item-supplier').value || null,
    min_quantity: Number(document.getElementById('item-min').value) || 0,
    notes: document.getElementById('item-notes').value.trim(),
  };
  try {
    if (id) {
      await api(`/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Товар обновлён');
    } else {
      payload.quantity = Number(document.getElementById('item-quantity').value) || 0;
      await api('/items', { method: 'POST', body: JSON.stringify(payload) });
      toast('Товар добавлен');
    }
    closeItemModal();
    loadItems();
    loadDashboard();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- МОДАЛЬНОЕ ОКНО ИЗМЕНЕНИЯ ОСТАТКА ----------
const adjustModal = document.getElementById('adjust-modal');
document.getElementById('adjust-close').addEventListener('click', closeAdjustModal);
document.getElementById('adjust-cancel').addEventListener('click', closeAdjustModal);
function closeAdjustModal() { adjustModal.classList.add('hidden'); currentAdjustItem = null; }

async function openAdjustModal(id) {
  currentAdjustItem = await api(`/items/${id}`);
  document.getElementById('adjust-item-name').textContent =
    `${currentAdjustItem.name} — сейчас ${currentAdjustItem.quantity} ${currentAdjustItem.unit}`;
  document.getElementById('adjust-amount').value = 1;
  document.getElementById('adjust-reason').value = '';
  document.getElementById('btn-plus').dataset.sign = '1';
  document.getElementById('btn-minus').dataset.sign = '-1';
  document.getElementById('adjust-confirm').dataset.sign = '1';
  adjustModal.classList.remove('hidden');
}

let pendingSign = 1;
document.getElementById('btn-plus').addEventListener('click', () => { pendingSign = 1; flashSign(); });
document.getElementById('btn-minus').addEventListener('click', () => { pendingSign = -1; flashSign(); });
function flashSign() {
  document.getElementById('btn-plus').classList.toggle('primary', pendingSign === 1);
  document.getElementById('btn-minus').classList.toggle('primary', pendingSign === -1);
}

document.getElementById('adjust-confirm').addEventListener('click', async () => {
  if (!currentAdjustItem) return;
  const amount = Number(document.getElementById('adjust-amount').value) || 0;
  const change = amount * pendingSign;
  const reason = document.getElementById('adjust-reason').value.trim();
  if (!reason) {
    toast('Укажите причину изменения количества');
    document.getElementById('adjust-reason').focus();
    return;
  }
  try {
    await api(`/items/${currentAdjustItem.id}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ change, reason }),
    });
    toast(change >= 0 ? `Добавлено ${amount} ${currentAdjustItem.unit}` : `Списано ${amount} ${currentAdjustItem.unit}`);
    closeAdjustModal();
    loadItems();
    loadDashboard();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- МОДАЛЬНОЕ ОКНО УДАЛЕНИЯ ПОЗИЦИИ ----------
const deleteModal = document.getElementById('delete-modal');
document.getElementById('delete-close').addEventListener('click', closeDeleteModal);
document.getElementById('delete-cancel').addEventListener('click', closeDeleteModal);
function closeDeleteModal() { deleteModal.classList.add('hidden'); currentDeleteItem = null; }

async function openDeleteModal(id) {
  currentDeleteItem = await api(`/items/${id}`);
  document.getElementById('delete-item-name').textContent = currentDeleteItem.name;
  document.getElementById('delete-reason').value = '';
  deleteModal.classList.remove('hidden');
}

document.getElementById('delete-confirm').addEventListener('click', async () => {
  if (!currentDeleteItem) return;
  const reason = document.getElementById('delete-reason').value.trim();
  if (!reason) {
    toast('Укажите причину удаления');
    document.getElementById('delete-reason').focus();
    return;
  }
  try {
    await api(`/items/${currentDeleteItem.id}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
    toast('Товар удалён');
    closeDeleteModal();
    loadItems();
    loadDashboard();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- ИСТОРИЯ ДВИЖЕНИЙ ----------
let allMovements = [];

async function loadHistory() {
  allMovements = await api('/movements');
  renderHistory();
}

function renderHistory() {
  const q = document.getElementById('history-search').value.trim().toLowerCase();
  const rows = q ? allMovements.filter(m => m.item_name.toLowerCase().includes(q)) : allMovements;

  const tbody = document.getElementById('history-tbody');
  tbody.innerHTML = '';
  document.getElementById('history-empty-state').classList.toggle('hidden', rows.length > 0);

  rows.forEach(m => {
    const tr = document.createElement('tr');
    const isPositive = m.change > 0;
    tr.innerHTML = `
      <td>${escapeHtml(m.item_name)}${m.item_deleted_at ? ' <span class="pill">удалён</span>' : ''}</td>
      <td>${m.category || '—'}</td>
      <td>${m.location || '—'}</td>
      <td>${m.supplier || '—'}</td>
      <td class="qty-cell" style="color:${isPositive ? 'var(--green)' : 'var(--red)'}">${isPositive ? '+' : ''}${m.change}</td>
      <td>${m.reason ? escapeHtml(m.reason) : '—'}</td>
      <td class="sku">${m.created_at}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('history-search').addEventListener('input', debounce(renderHistory, 200));

// ---------- НАСТРОЙКИ ----------
async function loadSettings() {
  await loadLookups();
  const catList = document.getElementById('category-list');
  catList.innerHTML = categories.map(c => tagListItem(c, 'category')).join('') || '<p class="meta">Категорий пока нет</p>';
  const locList = document.getElementById('location-list');
  locList.innerHTML = locations.map(l => tagListItem(l, 'location')).join('') || '<p class="meta">Расположений пока нет</p>';
  const supList = document.getElementById('supplier-list');
  supList.innerHTML = suppliers.map(s => tagListItem(s, 'supplier')).join('') || '<p class="meta">Поставщиков пока нет</p>';
}

function tagListItem(entity, type) {
  const label = type === 'supplier' && entity.contact
    ? `${escapeHtml(entity.name)} · ${escapeHtml(entity.contact)}`
    : escapeHtml(entity.name);
  const actions = isAdmin() ? `
      <span class="tag-actions">
        <button data-type="${type}" data-id="${entity.id}" data-action="edit-tag" title="Изменить">✎</button>
        <button data-type="${type}" data-id="${entity.id}" data-action="delete-tag" class="danger" title="Удалить">✕</button>
      </span>` : '';
  return `
    <li>
      <span>${label}</span>
      ${actions}
    </li>
  `;
}

document.querySelectorAll('#category-list, #location-list, #supplier-list').forEach(list => {
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { type, id, action } = btn.dataset;
    if (action === 'edit-tag') openTagEditModal(type, id);
    if (action === 'delete-tag') deleteTag(type, id);
  });
});

const tagTypeMeta = {
  category: { plural: 'categories', label: 'категорию', endpoint: '/categories' },
  location: { plural: 'locations', label: 'расположение', endpoint: '/locations' },
  supplier: { plural: 'suppliers', label: 'поставщика', endpoint: '/suppliers' },
};

async function deleteTag(type, id) {
  const meta = tagTypeMeta[type];
  if (!confirm(`Удалить эту запись (${meta.label})? Товары, у которых она указана, останутся, но потеряют эту привязку.`)) return;
  try {
    await api(`${meta.endpoint}/${id}`, { method: 'DELETE' });
    toast('Удалено');
    loadSettings();
  } catch (err) {
    toast(err.message);
  }
}

// ---------- МОДАЛЬНОЕ ОКНО РЕДАКТИРОВАНИЯ КАТЕГОРИИ / РАСПОЛОЖЕНИЯ / ПОСТАВЩИКА ----------
const tagEditModal = document.getElementById('tag-edit-modal');
let currentTagEdit = null;

function openTagEditModal(type, id) {
  const meta = tagTypeMeta[type];
  const list = type === 'category' ? categories : type === 'location' ? locations : suppliers;
  const entity = list.find(x => String(x.id) === String(id));
  if (!entity) return;
  currentTagEdit = { type, id, meta };
  document.getElementById('tag-edit-title').textContent =
    type === 'category' ? 'Изменить категорию' : type === 'location' ? 'Изменить расположение' : 'Изменить поставщика';
  document.getElementById('tag-edit-name').value = entity.name;
  const contactField = document.getElementById('tag-edit-contact-field');
  if (type === 'supplier') {
    contactField.classList.remove('hidden');
    document.getElementById('tag-edit-contact').value = entity.contact || '';
  } else {
    contactField.classList.add('hidden');
  }
  tagEditModal.classList.remove('hidden');
}

function closeTagEditModal() { tagEditModal.classList.add('hidden'); currentTagEdit = null; }
document.getElementById('tag-edit-close').addEventListener('click', closeTagEditModal);
document.getElementById('tag-edit-cancel').addEventListener('click', closeTagEditModal);

document.getElementById('tag-edit-save').addEventListener('click', async () => {
  if (!currentTagEdit) return;
  const name = document.getElementById('tag-edit-name').value.trim();
  if (!name) { toast('Название не может быть пустым'); return; }
  const payload = { name };
  if (currentTagEdit.type === 'supplier') {
    payload.contact = document.getElementById('tag-edit-contact').value.trim();
  }
  try {
    await api(`${currentTagEdit.meta.endpoint}/${currentTagEdit.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    toast('Сохранено');
    closeTagEditModal();
    loadSettings();
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById('form-category').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('input-category');
  try {
    await api('/categories', { method: 'POST', body: JSON.stringify({ name: input.value.trim() }) });
    input.value = '';
    toast('Категория добавлена');
    loadSettings();
  } catch (err) { toast(err.message); }
});

document.getElementById('form-location').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('input-location');
  try {
    await api('/locations', { method: 'POST', body: JSON.stringify({ name: input.value.trim() }) });
    input.value = '';
    toast('Расположение добавлено');
    loadSettings();
  } catch (err) { toast(err.message); }
});

document.getElementById('form-supplier').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('input-supplier');
  const contactInput = document.getElementById('input-supplier-contact');
  try {
    await api('/suppliers', { method: 'POST', body: JSON.stringify({ name: input.value.trim(), contact: contactInput.value.trim() }) });
    input.value = '';
    contactInput.value = '';
    toast('Поставщик добавлен');
    loadSettings();
  } catch (err) { toast(err.message); }
});

// ---------- УТИЛИТЫ ----------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}

// ---------- АВТОРИЗАЦИЯ ----------
const loginScreen = document.getElementById('login-screen');
const appRoot = document.getElementById('app-root');

function showLoginScreen() {
  appRoot.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

function showApp() {
  loginScreen.classList.add('hidden');
  appRoot.classList.remove('hidden');
}

function applyRolePermissions() {
  const adminOnlyEls = [
    document.getElementById('btn-add-item'),
    document.getElementById('form-category'),
    document.getElementById('form-location'),
    document.getElementById('form-supplier'),
  ];
  adminOnlyEls.forEach(el => { if (el) el.classList.toggle('hidden', !isAdmin()); });
}

function renderUserInfo() {
  if (!currentUser) return;
  const roleLabel = currentUser.role === 'admin' ? 'Администратор' : 'Пользователь';
  document.getElementById('sidebar-user-info').innerHTML =
    `${escapeHtml(currentUser.username)}<br><span class="role-badge">${roleLabel}</span>`;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.classList.add('hidden');
  try {
    const res = await fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось войти');
    currentUser = data.user;
    document.getElementById('login-password').value = '';
    await initApp();
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await fetch(API + '/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
  currentUser = null;
  showLoginScreen();
});

async function initApp() {
  renderUserInfo();
  applyRolePermissions();
  showApp();
  await loadLookups();
  await loadDashboard();
}

// ---------- ИНИЦИАЛИЗАЦИЯ ----------
(async function bootstrap() {
  try {
    const res = await fetch(API + '/me', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.user) {
      currentUser = data.user;
      await initApp();
    } else {
      showLoginScreen();
    }
  } catch (e) {
    showLoginScreen();
  }
})();
