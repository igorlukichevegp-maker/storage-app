const API = '/api';

let categories = [];
let locations = [];
let currentAdjustItem = null;

// ---------- NAVIGATION ----------
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'dashboard') loadDashboard();
    if (btn.dataset.view === 'inventory') loadItems();
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
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.status === 204 ? null : res.json();
}

// ---------- DASHBOARD ----------
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
    list.innerHTML = '<p class="empty-state">Everything is above its threshold. Nice and stocked.</p>';
    return;
  }
  low.forEach(item => {
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div>
        <div class="name">${escapeHtml(item.name)}</div>
        <div class="meta">${item.location || 'No location'} · min ${item.min_quantity} ${item.unit}</div>
      </div>
      <span class="pill">${item.quantity} ${item.unit} left</span>
    `;
    list.appendChild(row);
  });
}

// ---------- INVENTORY ----------
async function loadLookups() {
  categories = await api('/categories');
  locations = await api('/locations');

  const catFilter = document.getElementById('filter-category');
  const locFilter = document.getElementById('filter-location');
  catFilter.innerHTML = '<option value="">All categories</option>' + categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  locFilter.innerHTML = '<option value="">All locations</option>' + locations.map(l => `<option value="${escapeHtml(l.name)}">${escapeHtml(l.name)}</option>`).join('');

  const itemCat = document.getElementById('item-category');
  const itemLoc = document.getElementById('item-location');
  itemCat.innerHTML = '<option value="">No category</option>' + categories.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  itemLoc.innerHTML = '<option value="">No location</option>' + locations.map(l => `<option value="${l.id}">${escapeHtml(l.name)}</option>`).join('');
}

async function loadItems() {
  if (categories.length === 0) await loadLookups();
  const q = document.getElementById('search-input').value;
  const category = document.getElementById('filter-category').value;
  const location = document.getElementById('filter-location').value;
  const low = document.getElementById('filter-low').checked;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (category) params.set('category', category);
  if (location) params.set('location', location);
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
      <td class="qty-cell">${item.quantity} ${escapeHtml(item.unit)}</td>
      <td><span class="${isLow ? 'status-low' : 'status-ok'}">${isLow ? 'Low stock' : 'In stock'}</span></td>
      <td>
        <div class="row-actions">
          <button class="btn small" data-action="adjust" data-id="${item.id}">Adjust</button>
          <button class="btn small" data-action="edit" data-id="${item.id}">Edit</button>
          <button class="btn small danger" data-action="delete" data-id="${item.id}">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('search-input').addEventListener('input', debounce(loadItems, 250));
document.getElementById('filter-category').addEventListener('change', loadItems);
document.getElementById('filter-location').addEventListener('change', loadItems);
document.getElementById('filter-low').addEventListener('change', loadItems);

document.getElementById('items-tbody').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if (action === 'edit') openEditModal(id);
  if (action === 'delete') {
    if (confirm('Delete this item permanently?')) {
      await api(`/items/${id}`, { method: 'DELETE' });
      toast('Item deleted');
      loadItems();
    }
  }
  if (action === 'adjust') openAdjustModal(id);
});

// ---------- ITEM MODAL ----------
const itemModal = document.getElementById('item-modal');
document.getElementById('btn-add-item').addEventListener('click', () => openAddModal());
document.getElementById('modal-close').addEventListener('click', closeItemModal);
document.getElementById('btn-cancel').addEventListener('click', closeItemModal);

function closeItemModal() { itemModal.classList.add('hidden'); }

async function openAddModal() {
  if (categories.length === 0) await loadLookups();
  document.getElementById('modal-title').textContent = 'Add item';
  document.getElementById('item-form').reset();
  document.getElementById('item-id').value = '';
  document.getElementById('item-unit').value = 'pcs';
  document.getElementById('qty-field').classList.remove('hidden');
  itemModal.classList.remove('hidden');
}

async function openEditModal(id) {
  const item = await api(`/items/${id}`);
  document.getElementById('modal-title').textContent = 'Edit item';
  document.getElementById('item-id').value = item.id;
  document.getElementById('item-name').value = item.name;
  document.getElementById('item-sku').value = item.sku || '';
  document.getElementById('item-unit').value = item.unit;
  document.getElementById('item-category').value = item.category_id || '';
  document.getElementById('item-location').value = item.location_id || '';
  document.getElementById('item-min').value = item.min_quantity;
  document.getElementById('item-notes').value = item.notes || '';
  document.getElementById('qty-field').classList.add('hidden'); // quantity changed via Adjust, not edit
  itemModal.classList.remove('hidden');
}

document.getElementById('item-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('item-id').value;
  const payload = {
    name: document.getElementById('item-name').value.trim(),
    sku: document.getElementById('item-sku').value.trim(),
    unit: document.getElementById('item-unit').value.trim() || 'pcs',
    category_id: document.getElementById('item-category').value || null,
    location_id: document.getElementById('item-location').value || null,
    min_quantity: Number(document.getElementById('item-min').value) || 0,
    notes: document.getElementById('item-notes').value.trim(),
  };
  try {
    if (id) {
      await api(`/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Item updated');
    } else {
      payload.quantity = Number(document.getElementById('item-quantity').value) || 0;
      await api('/items', { method: 'POST', body: JSON.stringify(payload) });
      toast('Item added');
    }
    closeItemModal();
    loadItems();
    loadDashboard();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- ADJUST MODAL ----------
const adjustModal = document.getElementById('adjust-modal');
document.getElementById('adjust-close').addEventListener('click', closeAdjustModal);
document.getElementById('adjust-cancel').addEventListener('click', closeAdjustModal);
function closeAdjustModal() { adjustModal.classList.add('hidden'); currentAdjustItem = null; }

async function openAdjustModal(id) {
  currentAdjustItem = await api(`/items/${id}`);
  document.getElementById('adjust-item-name').textContent =
    `${currentAdjustItem.name} — currently ${currentAdjustItem.quantity} ${currentAdjustItem.unit}`;
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
  try {
    await api(`/items/${currentAdjustItem.id}/adjust`, {
      method: 'POST',
      body: JSON.stringify({ change, reason }),
    });
    toast(change >= 0 ? `Added ${amount} ${currentAdjustItem.unit}` : `Removed ${amount} ${currentAdjustItem.unit}`);
    closeAdjustModal();
    loadItems();
    loadDashboard();
  } catch (err) {
    toast(err.message);
  }
});

// ---------- SETTINGS ----------
async function loadSettings() {
  await loadLookups();
  const catList = document.getElementById('category-list');
  catList.innerHTML = categories.map(c => `<li>${escapeHtml(c.name)}</li>`).join('') || '<p class="meta">No categories yet</p>';
  const locList = document.getElementById('location-list');
  locList.innerHTML = locations.map(l => `<li>${escapeHtml(l.name)}</li>`).join('') || '<p class="meta">No locations yet</p>';
}

document.getElementById('form-category').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('input-category');
  try {
    await api('/categories', { method: 'POST', body: JSON.stringify({ name: input.value.trim() }) });
    input.value = '';
    toast('Category added');
    loadSettings();
  } catch (err) { toast(err.message); }
});

document.getElementById('form-location').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('input-location');
  try {
    await api('/locations', { method: 'POST', body: JSON.stringify({ name: input.value.trim() }) });
    input.value = '';
    toast('Location added');
    loadSettings();
  } catch (err) { toast(err.message); }
});

// ---------- UTIL ----------
function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
}

// ---------- INIT ----------
loadLookups().then(loadDashboard);
