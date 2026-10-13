import type { DatabaseSync } from "node:sqlite";

// This installer owns only the two additive archive-order objects. Journal mode
// and the existing registry tables are configured before opening its transaction.
export function installArchiveVersionSchema(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_archive_versions(project_id TEXT PRIMARY KEY, version INTEGER NOT NULL);
      CREATE TRIGGER IF NOT EXISTS projects_archive_version AFTER UPDATE OF archived_at ON projects BEGIN
        INSERT INTO project_archive_versions(project_id,version) VALUES (NEW.id,1)
        ON CONFLICT(project_id) DO UPDATE SET version=project_archive_versions.version+1;
      END;
    `);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the installation error; the owner closes the failed connection.
    }
    throw error;
  }
}
