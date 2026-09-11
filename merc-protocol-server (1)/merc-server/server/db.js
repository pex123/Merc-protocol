// Postgres access layer. Render provisions a managed Postgres instance and
// injects its connection string as DATABASE_URL -- that's the only config
// this file needs in production. For local development without Render,
// set DATABASE_URL yourself (see .env.example).
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render's managed Postgres requires SSL; local dev Postgres does not
  // speak SSL by default, so only demand it when we're clearly talking to
  // a remote (Render) host.
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stats (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      kills INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      matches INTEGER NOT NULL DEFAULT 0
    );
  `);
}

async function createUser(username, passwordHash) {
  const res = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
    [username, passwordHash]
  );
  const user = res.rows[0];
  await pool.query('INSERT INTO stats (user_id) VALUES ($1)', [user.id]);
  return user;
}

async function findUserByUsername(username) {
  const res = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return res.rows[0] || null;
}

async function findUserById(id) {
  const res = await pool.query('SELECT id, username FROM users WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function getStats(userId) {
  const res = await pool.query('SELECT * FROM stats WHERE user_id = $1', [userId]);
  return res.rows[0] || { kills: 0, deaths: 0, wins: 0, losses: 0, matches: 0 };
}

// Single row updated at a time -- fine at this scale (a few dozen concurrent
// players at most); a real leaderboard-scale app would batch/queue this.
async function addKill(userId) {
  await pool.query('UPDATE stats SET kills = kills + 1 WHERE user_id = $1', [userId]);
}
async function addDeath(userId) {
  await pool.query('UPDATE stats SET deaths = deaths + 1 WHERE user_id = $1', [userId]);
}
async function addMatchResult(userId, won) {
  await pool.query(
    `UPDATE stats SET matches = matches + 1, wins = wins + $2, losses = losses + $3 WHERE user_id = $1`,
    [userId, won ? 1 : 0, won ? 0 : 1]
  );
}

async function getLeaderboard(limit) {
  const res = await pool.query(
    `SELECT u.username, s.kills, s.deaths, s.wins, s.losses, s.matches
     FROM stats s JOIN users u ON u.id = s.user_id
     ORDER BY s.kills DESC LIMIT $1`,
    [limit || 20]
  );
  return res.rows;
}

module.exports = {
  pool, init, createUser, findUserByUsername, findUserById,
  getStats, addKill, addDeath, addMatchResult, getLeaderboard,
};
