import { Database } from "bun:sqlite";
// @ts-expect-error knex ships no type declarations for its internal dialect modules
import BetterSqlite3Client from "knex/lib/dialects/better-sqlite3/index.js";

export class BunSqliteClient extends (BetterSqlite3Client as any) {
  _driver() {
    return Database;
  }

  async acquireRawConnection() {
    const db = new Database(this.connectionSettings.filename);
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    return db;
  }

  async destroyRawConnection(connection: Database) {
    connection.close();
  }

  async _query(connection: Database, obj: any) {
    if (!obj.sql) throw new Error("The query is empty");
    if (!connection) throw new Error("No connection provided");

    const statement = connection.prepare(obj.sql);
    try {
      const bindings = this._formatBindings(obj.bindings);
      if (statement.columnNames.length > 0) {
        obj.response = statement.all(...bindings);
      } else {
        const result = statement.run(...bindings);
        obj.response = result;
        obj.context = {
          lastID: result.lastInsertRowid,
          changes: result.changes,
        };
      }
    } finally {
      statement.finalize();
    }
    return obj;
  }
}
