const session = require('express-session');

class TursoSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this._init();
  }

  async _init() {
    try {
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          sid TEXT PRIMARY KEY,
          data TEXT NOT NULL,
          expires INTEGER
        )
      `);
      console.log('Sessions table initialized.');
    } catch (err) {
      console.error('Error initializing sessions table:', err);
    }
  }

  async get(sid, cb) {
    try {
      const result = await this.db.execute('SELECT data, expires FROM sessions WHERE sid = ?', [sid]);
      const row = result.rows[0];
      if (!row) return cb(null, null);
      if (row.expires && Date.now() > row.expires) {
        await this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  async set(sid, session, cb) {
    try {
      const expires = session.cookie?.expires
        ? new Date(session.cookie.expires).getTime()
        : Date.now() + 86400000; // 24h default
      const data = JSON.stringify(session);
      await this.db.execute(
        `INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET data=excluded.data, expires=excluded.expires`,
        [sid, data, expires]
      );
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  async destroy(sid, cb) {
    try {
      await this.db.execute('DELETE FROM sessions WHERE sid = ?', [sid]);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }
}

module.exports = TursoSessionStore;