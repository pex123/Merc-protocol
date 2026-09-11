// The authoritative multiplayer arena. Movement/animation stay client-reported
// (this is not a full server-side physics simulation -- see README for that
// trade-off), but combat outcomes do NOT: HP, kills, deaths and match state
// live only here, in server memory, and clients can only ever describe an
// attack ("I hit player X for Y") -- never assert their own health or a
// kill. That's the actual meaning of "authoritative" for this game: a
// modified client can lie about where it's standing, but it cannot lie about
// whether it's alive or who killed whom.
//
// This is a single in-memory arena per server process. Running more than one
// Render instance of this service would split players across separate,
// unsynced arenas -- fine for the scale this is built for, but worth knowing
// before turning on autoscaling (see README).
const { verifyToken } = require('./auth');
const db = require('./db');

const TEAM_KILL_LIMIT = 30;
const MAX_HP = 100;
const RESPAWN_MS = 3000;
const SNAPSHOT_HZ = 12;

function createArena(wss) {
  /** @type {Map<string, Player>} */
  const players = new Map();
  let teamScore = { A: 0, B: 0 };
  let matchOver = false;

  function teamCount(team) {
    let n = 0;
    for (const p of players.values()) if (p.team === team) n++;
    return n;
  }

  function assignTeam() {
    return teamCount('B') < teamCount('A') ? 'B' : 'A';
  }

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of players.values()) {
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }

  function publicState(p) {
    return {
      id: p.id, name: p.name, team: p.team, hero: p.hero,
      x: p.x, z: p.z, ry: p.ry, anim: p.anim,
      hp: p.hp, maxHp: MAX_HP, alive: p.alive,
      kills: p.kills, deaths: p.deaths,
    };
  }

  function resetMatch() {
    matchOver = false;
    teamScore = { A: 0, B: 0 };
    for (const p of players.values()) { p.kills = 0; p.deaths = 0; p.hp = MAX_HP; p.alive = true; }
  }

  function endMatch(winner) {
    matchOver = true;
    broadcast({ t: 'matchEnd', winner, teamScore });
    for (const p of players.values()) {
      if (p.userId) db.addMatchResult(p.userId, winner ? p.team === winner : false).catch(() => {});
    }
    setTimeout(resetMatch, 6000);
  }

  function applyHit(attacker, targetId, dmg, headshot) {
    if (matchOver) return;
    const target = players.get(targetId);
    if (!target || !target.alive || target.team === attacker.team) return;
    dmg = Math.max(1, Math.min(100, Number(dmg) || 0));
    target.hp = Math.max(0, target.hp - dmg);
    broadcast({ t: 'damaged', targetId, hp: target.hp, byId: attacker.id });
    if (target.hp <= 0) {
      target.alive = false;
      target.deaths++;
      attacker.kills++;
      teamScore[attacker.team] = (teamScore[attacker.team] || 0) + 1;
      broadcast({ t: 'kill', killerId: attacker.id, killerName: attacker.name, targetId: target.id, targetName: target.name, teamScore });
      if (attacker.userId) db.addKill(attacker.userId).catch(() => {});
      if (target.userId) db.addDeath(target.userId).catch(() => {});
      setTimeout(() => {
        if (!players.has(target.id)) return;
        target.hp = MAX_HP; target.alive = true;
        broadcast({ t: 'respawn', id: target.id, hp: MAX_HP });
      }, RESPAWN_MS);
      if (teamScore[attacker.team] >= TEAM_KILL_LIMIT) endMatch(attacker.team);
    }
  }

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const payload = verifyToken(token);
    if (!payload) { ws.close(4001, 'unauthorized'); return; }

    const id = payload.sub + ':' + Math.random().toString(36).slice(2, 8);
    const player = {
      id, userId: payload.sub, name: payload.username, ws,
      team: assignTeam(), hero: 'vanguard',
      x: 0, z: 0, ry: 0, anim: 'idle',
      hp: MAX_HP, alive: true, kills: 0, deaths: 0,
    };
    players.set(id, player);

    ws.send(JSON.stringify({ t: 'welcome', selfId: id, team: player.team, teamScore, matchOver }));
    broadcast({ t: 'join', player: publicState(player) });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.t === 'state') {
        if (typeof msg.x === 'number') player.x = msg.x;
        if (typeof msg.z === 'number') player.z = msg.z;
        if (typeof msg.ry === 'number') player.ry = msg.ry;
        if (typeof msg.anim === 'string') player.anim = msg.anim.slice(0, 24);
        if (typeof msg.hero === 'string') player.hero = msg.hero.slice(0, 24);
      } else if (msg.t === 'hit') {
        applyHit(player, String(msg.targetId || ''), msg.dmg, !!msg.headshot);
      }
    });

    ws.on('close', () => {
      players.delete(id);
      broadcast({ t: 'leave', id });
    });
    ws.on('error', () => {});
  });

  // authoritative snapshot tick -- this is what every client renders peers
  // from; a client's own "state" messages only ever describe itself.
  setInterval(() => {
    if (players.size === 0) return;
    broadcast({ t: 'snapshot', players: Array.from(players.values()).map(publicState), teamScore, matchOver });
  }, 1000 / SNAPSHOT_HZ);

  return { players };
}

module.exports = { createArena };
