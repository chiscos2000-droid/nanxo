const express = require('express');
const path = require('path');
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('Falta la variable DATABASE_URL (agrega un Postgres en Railway).');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /rlwy\.net|proxy/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : undefined
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SELECT = `SELECT id, to_char(fecha,'YYYY-MM-DD') AS fecha, dia, supervisor, trabajo, horas::float AS horas FROM registros`;

function valido(r) {
  return r && typeof r.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) &&
    typeof r.dia === 'string' && typeof r.supervisor === 'string' &&
    typeof r.trabajo === 'string' && Number(r.horas) > 0;
}

app.get('/api/registros', async (req, res) => {
  try {
    const { rows } = await pool.query(`${SELECT} ORDER BY fecha DESC, creado DESC`);
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al leer' }); }
});

app.post('/api/registros', async (req, res) => {
  const r = req.body;
  if (!valido(r)) return res.status(400).json({ error: 'Datos inválidos' });
  try {
    await pool.query(
      `INSERT INTO registros (id, fecha, dia, supervisor, trabajo, horas) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO NOTHING`,
      [r.id, r.fecha, r.dia, r.supervisor, r.trabajo, Number(r.horas)]
    );
    res.status(201).json(r);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al guardar' }); }
});

// Importa registros antiguos guardados en localStorage
app.post('/api/registros/importar', async (req, res) => {
  const lista = Array.isArray(req.body) ? req.body.filter(valido) : [];
  try {
    for (const r of lista) {
      await pool.query(
        `INSERT INTO registros (id, fecha, dia, supervisor, trabajo, horas) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.fecha, r.dia, r.supervisor, r.trabajo, Number(r.horas)]
      );
    }
    res.json({ importados: lista.length });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al importar' }); }
});

app.delete('/api/registros/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM registros WHERE id = $1', [req.params.id]);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al eliminar' }); }
});

// Borra todos los registros de un mes: DELETE /api/registros?mes=2026-11
app.delete('/api/registros', async (req, res) => {
  const mes = req.query.mes;
  if (!/^\d{4}-\d{2}$/.test(mes || '')) return res.status(400).json({ error: 'Mes inválido' });
  try {
    await pool.query(`DELETE FROM registros WHERE to_char(fecha,'YYYY-MM') = $1`, [mes]);
    res.status(204).end();
  } catch (e) { console.error(e); res.status(500).json({ error: 'Error al borrar' }); }
});

async function iniciar() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS registros (
      id TEXT PRIMARY KEY,
      fecha DATE NOT NULL,
      dia TEXT NOT NULL,
      supervisor TEXT NOT NULL,
      trabajo TEXT NOT NULL,
      horas NUMERIC(6,1) NOT NULL,
      creado TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log('Servidor en puerto ' + port));
}

iniciar().catch(e => { console.error(e); process.exit(1); });
