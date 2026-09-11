const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const USERNAME_RE = /^[A-Za-z0-9_\-]{3,16}$/;

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch (e) { return null; }
}

// Express middleware: requires "Authorization: Bearer <token>", attaches req.user
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;
  next();
}

function registerRoutes(app) {
  app.post('/api/register', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'username must be 3-16 letters/digits/_/- ' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'password must be at least 6 characters' });
    }
    try {
      const existing = await db.findUserByUsername(username);
      if (existing) return res.status(409).json({ error: 'username already taken' });
      const hash = await bcrypt.hash(password, 10);
      const user = await db.createUser(username, hash);
      const token = signToken(user);
      res.json({ token, username: user.username });
    } catch (e) {
      console.error('register error', e);
      res.status(500).json({ error: 'server error' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'username and password required' });
    }
    try {
      const user = await db.findUserByUsername(username);
      if (!user) return res.status(401).json({ error: 'invalid username or password' });
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid username or password' });
      const token = signToken(user);
      res.json({ token, username: user.username });
    } catch (e) {
      console.error('login error', e);
      res.status(500).json({ error: 'server error' });
    }
  });

  app.get('/api/me', requireAuth, async (req, res) => {
    try {
      const stats = await db.getStats(req.user.sub);
      res.json({ username: req.user.username, stats });
    } catch (e) {
      console.error('me error', e);
      res.status(500).json({ error: 'server error' });
    }
  });

  app.get('/api/leaderboard', async (req, res) => {
    try {
      const rows = await db.getLeaderboard(20);
      res.json({ leaderboard: rows });
    } catch (e) {
      console.error('leaderboard error', e);
      res.status(500).json({ error: 'server error' });
    }
  });
}

module.exports = { signToken, verifyToken, requireAuth, registerRoutes, JWT_SECRET };
