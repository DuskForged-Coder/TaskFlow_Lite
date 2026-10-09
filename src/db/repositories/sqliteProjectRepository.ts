import type Database from 'better-sqlite3';
import { DatabaseError, UserError } from '../../core/errors.js';
import type { Project } from '../../core/projects/project.js';
import type { ProjectRepository } from '../../core/projects/projectRepository.js';

type ProjectRow = { id: string; name: string; created_at: string };

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  create(project: Project): Project {
    try {
      this.db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)')
        .run(project.id, project.name, project.createdAt);
      return project;
    } catch (cause) {
      if (isUniqueConstraint(cause)) throw new UserError(`A project named “${project.name}” already exists.`);
      throw new DatabaseError('Could not save the project.', { cause });
    }
  }

  getById(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
    return row ? fromRow(row) : null;
  }

  findByName(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ? COLLATE NOCASE').get(name) as ProjectRow | undefined;
    return row ? fromRow(row) : null;
  }

  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all() as ProjectRow[];
    return rows.map(fromRow);
  }
}

function fromRow(row: ProjectRow): Project {
  return { id: row.id, name: row.name, createdAt: row.created_at };
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && error.message.includes('UNIQUE constraint failed');
}