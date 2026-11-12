import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

/** Creates (once) a small shop database in the app's data folder and returns its path. */
export function sampleDatabase(): string {
  const file = path.join(app.getPath('userData'), 'sample-shop.db')
  if (fs.existsSync(file)) return file
  const db = new Database(file)
  try {
    db.exec(`
      CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE, city TEXT, joined DATE);
      CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT, price REAL NOT NULL);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), ordered_at DATETIME, status TEXT);
      CREATE TABLE order_items (order_id INTEGER NOT NULL REFERENCES orders(id), product_id INTEGER NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, PRIMARY KEY (order_id, product_id));
      CREATE INDEX idx_orders_customer ON orders(customer_id);
      CREATE VIEW order_totals AS
        SELECT o.id AS order_id, c.name AS customer, o.ordered_at, o.status, ROUND(SUM(p.price * i.quantity), 2) AS total
        FROM orders o JOIN customers c ON c.id = o.customer_id JOIN order_items i ON i.order_id = o.id JOIN products p ON p.id = i.product_id
        GROUP BY o.id;
    `)
    const first = ['Ava', 'Liam', 'Noah', 'Emma', 'Zara', 'Omar', 'Mia', 'Ali', 'Sara', 'Leo', 'Hana', 'Ivan', 'Nora', 'Yusuf', 'Ella']
    const last = ['Khan', 'Smith', 'Garcia', 'Chen', 'Müller', 'Ahmed', 'Rossi', 'Kim', 'Novak', 'Silva']
    const cities = ['London', 'Lahore', 'Berlin', 'Toronto', 'Dubai', 'Madrid', 'Sydney', 'Karachi', 'Paris', 'Austin']
    const products: [string, string, number][] = [
      ['Mechanical keyboard', 'Accessories', 89.99], ['Wireless mouse', 'Accessories', 24.5], ['27" monitor', 'Displays', 279],
      ['USB-C hub', 'Accessories', 39.9], ['Laptop stand', 'Accessories', 45], ['Noise-cancelling headphones', 'Audio', 199],
      ['Webcam 1080p', 'Video', 59.99], ['Desk lamp', 'Office', 32], ['Office chair', 'Office', 349], ['Portable SSD 1TB', 'Storage', 109]
    ]
    let seed = 42
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return (seed >>> 16) % n }
    const day = (d: number) => new Date(Date.UTC(2025, 0, 1) + d * 86400000).toISOString()
    db.transaction(() => {
      const ic = db.prepare('INSERT INTO customers (name, email, city, joined) VALUES (?, ?, ?, ?)')
      for (let i = 0; i < 60; i++) {
        const f = first[rnd(first.length)], l = last[rnd(last.length)]
        ic.run(`${f} ${l}`, `${f}.${l}${i}@example.com`.toLowerCase(), cities[rnd(cities.length)], day(rnd(300)).slice(0, 10))
      }
      const ip = db.prepare('INSERT INTO products (name, category, price) VALUES (?, ?, ?)')
      for (const p of products) ip.run(...p)
      const io = db.prepare('INSERT INTO orders (customer_id, ordered_at, status) VALUES (?, ?, ?)')
      const ii = db.prepare('INSERT OR IGNORE INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)')
      const statuses = ['delivered', 'delivered', 'delivered', 'shipped', 'pending', 'cancelled']
      for (let o = 1; o <= 250; o++) {
        io.run(1 + rnd(60), day(300 + rnd(300)).replace('T', ' ').slice(0, 19), statuses[rnd(statuses.length)])
        for (let k = 0, n = 1 + rnd(3); k < n; k++) ii.run(o, 1 + rnd(products.length), 1 + rnd(3))
      }
    })()
  } finally { db.close() }
  return file
}
