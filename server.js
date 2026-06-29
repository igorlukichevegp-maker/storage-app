// server.js — Storage Management API
// Database: SQLite, using Node's BUILT-IN node:sqlite module.
// No native compiling, no Python/Visual Studio needed — works out of the box.
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'crate-storage-app-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 8, // 8 часов
    sameSite: 'lax',
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

const dbPath = process.env.DB_PATH || path.join(__dirname, 'storage.db');
const dbFile = new DatabaseSync(dbPath);
dbFile.exec('PRAGMA journal_mode = WAL;');
console.log('Using database file:', dbPath);

// Thin wrapper so the rest of the file can keep using the same
// db.prepare(...).get/all/run(...) style as before.
const db = {
  prepare(sql) {
    const stmt = dbFile.prepare(sql);
    return {
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
      run: (...params) => {
        const info = stmt.run(...params);
        return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
      },
    };
  },
  exec(sql) {
    dbFile.exec(sql);
  },
};

// ---------- SCHEMA ----------
db.exec(`
CREATE TABLE IF NOT EXISTS locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  location_id INTEGER REFERENCES locations(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'шт',
  notes TEXT,
  deleted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id),
  item_name TEXT,
  change INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// migration: older databases created before suppliers existed won't have this column yet
try {
  db.exec('ALTER TABLE items ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)');
} catch (e) {
  // column already exists — safe to ignore
}
// migration: soft-delete support (so movement history survives deleted items)
try {
  db.exec('ALTER TABLE items ADD COLUMN deleted_at TEXT');
} catch (e) {
  // column already exists — safe to ignore
}
// migration: store item name snapshot on each movement, so history reads fine even after an item is deleted
try {
  db.exec('ALTER TABLE movements ADD COLUMN item_name TEXT');
} catch (e) {
  // column already exists — safe to ignore
}

// seed a couple of defaults if empty
const locCount = db.prepare('SELECT COUNT(*) c FROM locations').get().c;
if (locCount === 0) {
  const ins = db.prepare('INSERT INTO locations (name) VALUES (?)');
  ['Главный склад', 'Стеллаж A1', 'Стеллаж B2'].forEach(n => ins.run(n));
}
const catCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
if (catCount === 0) {
  const ins = db.prepare('INSERT INTO categories (name) VALUES (?)');
  ['Электроника', 'Офисные принадлежности', 'Упаковка', 'Инструменты'].forEach(n => ins.run(n));
}
const supCount = db.prepare('SELECT COUNT(*) c FROM suppliers').get().c;
if (supCount === 0) {
  const ins = db.prepare('INSERT INTO suppliers (name) VALUES (?)');
  ['ООО «Поставщик 1»', 'ООО «Поставщик 2»'].forEach(n => ins.run(n));
}

// seed default accounts on very first run.
// Override these via environment variables on Render/Railway for better security:
// ADMIN_USERNAME, ADMIN_PASSWORD, USER_USERNAME, USER_PASSWORD
const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
if (userCount === 0) {
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'GTR_Baku_2026';
  const userUsername = process.env.USER_USERNAME || 'user';
  const userPassword = process.env.USER_PASSWORD || 'Baku_2026';
  const insUser = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)');
  insUser.run(adminUsername, bcrypt.hashSync(adminPassword, 10), 'admin');
  insUser.run(userUsername, bcrypt.hashSync(userPassword, 10), 'user');
  console.log('Созданы стандартные учётные записи:');
  console.log(`  Администратор: ${adminUsername} / ${adminPassword}`);
  console.log(`  Пользователь:  ${userUsername} / ${userPassword}`);
  console.log('Рекомендуется сменить пароли через переменные окружения ADMIN_PASSWORD / USER_PASSWORD.');
}

// ---------- HELPERS ----------
const itemView = `
  SELECT items.*, categories.name AS category, locations.name AS location, suppliers.name AS supplier
  FROM items
  LEFT JOIN categories ON categories.id = items.category_id
  LEFT JOIN locations ON locations.id = items.location_id
  LEFT JOIN suppliers ON suppliers.id = items.supplier_id
`;

// ---------- АВТОРИЗАЦИЯ ----------
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Необходима авторизация' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Необходима авторизация' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: 'Недостаточно прав. Это действие доступно только администратору.' });
  next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  res.json({ user: req.session.user || null });
});

// ---------- ITEM ROUTES ----------
app.get('/api/items', requireAuth, (req, res) => {
  const { q, category, location, supplier, low } = req.query;
  let sql = itemView + ' WHERE items.deleted_at IS NULL ';
  const params = [];
  if (q) { sql += ' AND (items.name LIKE ? OR items.sku LIKE ?) '; params.push(`%${q}%`, `%${q}%`); }
  if (category) { sql += ' AND categories.name = ? '; params.push(category); }
  if (location) { sql += ' AND locations.name = ? '; params.push(location); }
  if (supplier) { sql += ' AND suppliers.name = ? '; params.push(supplier); }
  if (low === 'true') { sql += ' AND items.quantity <= items.min_quantity '; }
  sql += ' ORDER BY items.updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/items/:id', requireAuth, (req, res) => {
  const item = db.prepare(itemView + ' WHERE items.id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Товар не найден' });
  res.json(item);
});

app.post('/api/items', requireAdmin, (req, res) => {
  const { name, sku, category_id, location_id, supplier_id, quantity, min_quantity, unit, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  try {
    const result = db.prepare(`
      INSERT INTO items (name, sku, category_id, location_id, supplier_id, quantity, min_quantity, unit, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, sku || null, category_id || null, location_id || null, supplier_id || null, quantity || 0, min_quantity || 0, unit || 'шт', notes || null);
    if (quantity) {
      db.prepare('INSERT INTO movements (item_id, item_name, change, reason) VALUES (?, ?, ?, ?)')
        .run(result.lastInsertRowid, name, quantity, 'Начальный остаток');
    }
    res.status(201).json(db.prepare(itemView + ' WHERE items.id = ?').get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/items/:id', requireAdmin, (req, res) => {
  const { name, sku, category_id, location_id, supplier_id, min_quantity, unit, notes } = req.body;
  const exists = db.prepare('SELECT id FROM items WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Товар не найден' });
  try {
    db.prepare(`
      UPDATE items SET name=?, sku=?, category_id=?, location_id=?, supplier_id=?, min_quantity=?, unit=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, sku || null, category_id || null, location_id || null, supplier_id || null, min_quantity || 0, unit || 'шт', notes || null, req.params.id);
    res.json(db.prepare(itemView + ' WHERE items.id = ?').get(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/items/:id', requireAdmin, (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Укажите причину удаления позиции' });
  }
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Товар не найден' });
  db.prepare("UPDATE items SET deleted_at=datetime('now'), updated_at=datetime('now') WHERE id=?").run(req.params.id);
  db.prepare('INSERT INTO movements (item_id, item_name, change, reason) VALUES (?, ?, ?, ?)')
    .run(item.id, item.name, -item.quantity, `Удаление позиции: ${reason.trim()}`);
  res.json({ ok: true });
});

// stock adjustment (move in / move out) — reason is mandatory so every change is traceable
app.post('/api/items/:id/adjust', requireAdmin, (req, res) => {
  const { change, reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'Укажите причину изменения количества' });
  }
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Товар не найден' });
  const newQty = item.quantity + Number(change);
  if (newQty < 0) return res.status(400).json({ error: 'Недостаточно товара для этого изменения' });
  db.prepare("UPDATE items SET quantity=?, updated_at=datetime('now') WHERE id=?").run(newQty, req.params.id);
  db.prepare('INSERT INTO movements (item_id, item_name, change, reason) VALUES (?, ?, ?, ?)')
    .run(req.params.id, item.name, change, reason.trim());
  res.json(db.prepare(itemView + ' WHERE items.id = ?').get(req.params.id));
});

app.get('/api/items/:id/movements', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM movements WHERE item_id = ? ORDER BY created_at DESC').all(req.params.id));
});

// ---------- ВСЯ ИСТОРИЯ ДВИЖЕНИЙ (для меню "История движений") ----------
app.get('/api/movements', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT
      movements.id,
      movements.item_id,
      COALESCE(movements.item_name, items.name, '(товар удалён)') AS item_name,
      categories.name AS category,
      locations.name AS location,
      suppliers.name AS supplier,
      items.deleted_at AS item_deleted_at,
      movements.change,
      movements.reason,
      movements.created_at
    FROM movements
    LEFT JOIN items ON items.id = movements.item_id
    LEFT JOIN categories ON categories.id = items.category_id
    LEFT JOIN locations ON locations.id = items.location_id
    LEFT JOIN suppliers ON suppliers.id = items.supplier_id
    ORDER BY movements.created_at DESC
  `).all();
  res.json(rows);
});

// ---------- CATEGORY / LOCATION ROUTES ----------
app.get('/api/categories', requireAuth, (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY name').all()));
app.post('/api/categories', requireAdmin, (req, res) => {
  try {
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(req.body.name);
    res.status(201).json({ id: r.lastInsertRowid, name: req.body.name });
  } catch (e) { res.status(400).json({ error: 'Такая категория уже существует' }); }
});
app.put('/api/categories/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE categories SET name=? WHERE id=?').run(req.body.name, req.params.id);
    res.json({ id: Number(req.params.id), name: req.body.name });
  } catch (e) { res.status(400).json({ error: 'Такая категория уже существует' }); }
});
app.delete('/api/categories/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE items SET category_id=NULL WHERE category_id=?').run(req.params.id);
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/locations', requireAuth, (req, res) => res.json(db.prepare('SELECT * FROM locations ORDER BY name').all()));
app.post('/api/locations', requireAdmin, (req, res) => {
  try {
    const r = db.prepare('INSERT INTO locations (name) VALUES (?)').run(req.body.name);
    res.status(201).json({ id: r.lastInsertRowid, name: req.body.name });
  } catch (e) { res.status(400).json({ error: 'Такое расположение уже существует' }); }
});
app.put('/api/locations/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE locations SET name=? WHERE id=?').run(req.body.name, req.params.id);
    res.json({ id: Number(req.params.id), name: req.body.name });
  } catch (e) { res.status(400).json({ error: 'Такое расположение уже существует' }); }
});
app.delete('/api/locations/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE items SET location_id=NULL WHERE location_id=?').run(req.params.id);
  db.prepare('DELETE FROM locations WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/suppliers', requireAuth, (req, res) => res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all()));
app.post('/api/suppliers', requireAdmin, (req, res) => {
  try {
    const r = db.prepare('INSERT INTO suppliers (name, contact) VALUES (?, ?)').run(req.body.name, req.body.contact || null);
    res.status(201).json({ id: r.lastInsertRowid, name: req.body.name, contact: req.body.contact || null });
  } catch (e) { res.status(400).json({ error: 'Такой поставщик уже существует' }); }
});
app.put('/api/suppliers/:id', requireAdmin, (req, res) => {
  try {
    db.prepare('UPDATE suppliers SET name=?, contact=? WHERE id=?').run(req.body.name, req.body.contact || null, req.params.id);
    res.json({ id: Number(req.params.id), name: req.body.name, contact: req.body.contact || null });
  } catch (e) { res.status(400).json({ error: 'Такой поставщик уже существует' }); }
});
app.delete('/api/suppliers/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE items SET supplier_id=NULL WHERE supplier_id=?').run(req.params.id);
  db.prepare('DELETE FROM suppliers WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- DASHBOARD STATS ----------
app.get('/api/stats', requireAuth, (req, res) => {
  const totalItems = db.prepare('SELECT COUNT(*) c FROM items WHERE deleted_at IS NULL').get().c;
  const totalUnits = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM items WHERE deleted_at IS NULL').get().s;
  const lowStock = db.prepare('SELECT COUNT(*) c FROM items WHERE deleted_at IS NULL AND quantity <= min_quantity').get().c;
  const totalLocations = db.prepare('SELECT COUNT(*) c FROM locations').get().c;
  res.json({ totalItems, totalUnits, lowStock, totalLocations });
});

// ---------- ЭКСПОРТ В EXCEL ----------
app.get('/api/export/excel', requireAuth, (req, res) => {
  try {
    const items = db.prepare(itemView + ' WHERE items.deleted_at IS NULL ORDER BY items.name').all();
    const categoriesAll = db.prepare('SELECT * FROM categories ORDER BY name').all();
    const locationsAll = db.prepare('SELECT * FROM locations ORDER BY name').all();
    const suppliersAll = db.prepare('SELECT * FROM suppliers ORDER BY name').all();
    const movementsAll = db.prepare(`
      SELECT movements.id, COALESCE(movements.item_name, items.name, '(товар удалён)') AS item, movements.change, movements.reason, movements.created_at
      FROM movements
      LEFT JOIN items ON items.id = movements.item_id
      ORDER BY movements.created_at DESC
    `).all();

    // Лист "Товары" — с понятными русскими заголовками для Excel
    const itemsSheetData = items.map(i => ({
      'Название': i.name,
      'Артикул': i.sku || '',
      'Категория': i.category || '',
      'Расположение': i.location || '',
      'Поставщик': i.supplier || '',
      'Количество': i.quantity,
      'Порог низкого остатка': i.min_quantity,
      'Единица': i.unit,
      'Заметки': i.notes || '',
      'Создано': i.created_at,
      'Обновлено': i.updated_at,
    }));

    const categoriesSheetData = categoriesAll.map(c => ({ 'Категория': c.name }));
    const locationsSheetData = locationsAll.map(l => ({ 'Расположение': l.name }));
    const suppliersSheetData = suppliersAll.map(s => ({ 'Поставщик': s.name, 'Контакт': s.contact || '' }));
    const movementsSheetData = movementsAll.map(m => ({
      'Товар': m.item || '(удалён)',
      'Изменение': m.change,
      'Причина': m.reason || '',
      'Дата': m.created_at,
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemsSheetData), 'Товары');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoriesSheetData), 'Категории');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(locationsSheetData), 'Расположения');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(suppliersSheetData), 'Поставщики');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(movementsSheetData), 'История движений');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileName = `storage-export-${new Date().toISOString().slice(0, 10)}.xlsx`;

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Storage app running on http://localhost:${PORT}`));
