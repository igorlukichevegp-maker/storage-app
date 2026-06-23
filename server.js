// server.js — Storage Management API
// Database: SQLite, using Node's BUILT-IN node:sqlite module.
// No native compiling, no Python/Visual Studio needed — works out of the box.
const express = require('express');
const cors = require('cors');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbFile = new DatabaseSync(path.join(__dirname, 'storage.db'));
dbFile.exec('PRAGMA journal_mode = WAL;');

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

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  sku TEXT UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  location_id INTEGER REFERENCES locations(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'pcs',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  change INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// seed a couple of defaults if empty
const locCount = db.prepare('SELECT COUNT(*) c FROM locations').get().c;
if (locCount === 0) {
  const ins = db.prepare('INSERT INTO locations (name) VALUES (?)');
  ['Main Warehouse', 'Shelf A1', 'Shelf B2'].forEach(n => ins.run(n));
}
const catCount = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
if (catCount === 0) {
  const ins = db.prepare('INSERT INTO categories (name) VALUES (?)');
  ['Electronics', 'Office Supplies', 'Packaging', 'Tools'].forEach(n => ins.run(n));
}

// ---------- HELPERS ----------
const itemView = `
  SELECT items.*, categories.name AS category, locations.name AS location
  FROM items
  LEFT JOIN categories ON categories.id = items.category_id
  LEFT JOIN locations ON locations.id = items.location_id
`;

// ---------- ITEM ROUTES ----------
app.get('/api/items', (req, res) => {
  const { q, category, location, low } = req.query;
  let sql = itemView + ' WHERE 1=1 ';
  const params = [];
  if (q) { sql += ' AND (items.name LIKE ? OR items.sku LIKE ?) '; params.push(`%${q}%`, `%${q}%`); }
  if (category) { sql += ' AND categories.name = ? '; params.push(category); }
  if (location) { sql += ' AND locations.name = ? '; params.push(location); }
  if (low === 'true') { sql += ' AND items.quantity <= items.min_quantity '; }
  sql += ' ORDER BY items.updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/items/:id', (req, res) => {
  const item = db.prepare(itemView + ' WHERE items.id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json(item);
});

app.post('/api/items', (req, res) => {
  const { name, sku, category_id, location_id, quantity, min_quantity, unit, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = db.prepare(`
      INSERT INTO items (name, sku, category_id, location_id, quantity, min_quantity, unit, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, sku || null, category_id || null, location_id || null, quantity || 0, min_quantity || 0, unit || 'pcs', notes || null);
    if (quantity) {
      db.prepare('INSERT INTO movements (item_id, change, reason) VALUES (?, ?, ?)')
        .run(result.lastInsertRowid, quantity, 'Initial stock');
    }
    res.status(201).json(db.prepare(itemView + ' WHERE items.id = ?').get(result.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/items/:id', (req, res) => {
  const { name, sku, category_id, location_id, min_quantity, unit, notes } = req.body;
  const exists = db.prepare('SELECT id FROM items WHERE id = ?').get(req.params.id);
  if (!exists) return res.status(404).json({ error: 'Item not found' });
  try {
    db.prepare(`
      UPDATE items SET name=?, sku=?, category_id=?, location_id=?, min_quantity=?, unit=?, notes=?, updated_at=datetime('now')
      WHERE id=?
    `).run(name, sku || null, category_id || null, location_id || null, min_quantity || 0, unit || 'pcs', notes || null, req.params.id);
    res.json(db.prepare(itemView + ' WHERE items.id = ?').get(req.params.id));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/items/:id', (req, res) => {
  db.prepare('DELETE FROM items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// stock adjustment (move in / move out)
app.post('/api/items/:id/adjust', (req, res) => {
  const { change, reason } = req.body;
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  const newQty = item.quantity + Number(change);
  if (newQty < 0) return res.status(400).json({ error: 'Not enough stock for this change' });
  db.prepare("UPDATE items SET quantity=?, updated_at=datetime('now') WHERE id=?").run(newQty, req.params.id);
  db.prepare('INSERT INTO movements (item_id, change, reason) VALUES (?, ?, ?)').run(req.params.id, change, reason || null);
  res.json(db.prepare(itemView + ' WHERE items.id = ?').get(req.params.id));
});

app.get('/api/items/:id/movements', (req, res) => {
  res.json(db.prepare('SELECT * FROM movements WHERE item_id = ? ORDER BY created_at DESC').all(req.params.id));
});

// ---------- CATEGORY / LOCATION ROUTES ----------
app.get('/api/categories', (req, res) => res.json(db.prepare('SELECT * FROM categories ORDER BY name').all()));
app.post('/api/categories', (req, res) => {
  try {
    const r = db.prepare('INSERT INTO categories (name) VALUES (?)').run(req.body.name);
    res.status(201).json({ id: r.lastInsertRowid, name: req.body.name });
  } catch (e) { res.status(400).json({ error: 'Category already exists' }); }
});

app.get('/api/locations', (req, res) => res.json(db.prepare('SELECT * FROM locations ORDER BY name').all()));
app.post('/api/locations', (req, res) => {
  try {
    const r = db.prepare('INSERT INTO locations (name) VALUES (?)').run(req.body.name);
    res.status(201).json({ id: r.lastInsertRowid, name: req.body.name });
  } catch (e) { res.status(400).json({ error: 'Location already exists' }); }
});

// ---------- DASHBOARD STATS ----------
app.get('/api/stats', (req, res) => {
  const totalItems = db.prepare('SELECT COUNT(*) c FROM items').get().c;
  const totalUnits = db.prepare('SELECT COALESCE(SUM(quantity),0) s FROM items').get().s;
  const lowStock = db.prepare('SELECT COUNT(*) c FROM items WHERE quantity <= min_quantity').get().c;
  const totalLocations = db.prepare('SELECT COUNT(*) c FROM locations').get().c;
  res.json({ totalItems, totalUnits, lowStock, totalLocations });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Storage app running on http://localhost:${PORT}`));
