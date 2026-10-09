/**
 * VISIBLE acceptance test for T08 - the project-name validation defect.
 *
 * This test PASSES on the unpatched baseline and FAILS once
 * experiment/seeds/bugY.patch is applied by `timer.sh start T08 <arm>`.
 *
 * Run with: corepack pnpm vitest run --config experiment/vitest.visible.config.ts
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteProjectRepository } from '../../src/db/repositories/sqliteProjectRepository.js';
import { runMigrations } from '../../src/db/migrations.js';
import { ProjectService } from '../../src/core/projects/projectService.js';
import { UserError } from '../../src/core/errors.js';

describe('T08 project name validation', () => {
  let db: Database.Database;
  let projects: ProjectService;
  let nextId: number;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    nextId = 0;
    projects = new ProjectService(
      new SqliteProjectRepository(db),
      undefined as never,
      () => new Date('2026-09-30T12:00:00.000Z'),
      () => `project-${++nextId}`,
    );
  });

  afterEach(() => db.close());

  it('rejects a project name longer than 80 characters', () => {
    expect(() => projects.createProject('P'.repeat(81))).toThrow(UserError);
    expect(projects.listProjects()).toHaveLength(0);
  });

  it('accepts a project name of exactly 80 characters', () => {
    const created = projects.createProject('P'.repeat(80));
    expect(created.name).toHaveLength(80);
  });

  it('still rejects empty, control-character and duplicate names', () => {
    expect(() => projects.createProject('   ')).toThrow(UserError);
    expect(() => projects.createProject('bad[31m')).toThrow(UserError);

    projects.createProject('University');
    expect(() => projects.createProject('university')).toThrow(/already exists/i);
  });

  it('creates a valid project and lists it', () => {
    const created = projects.createProject('University');
    expect(created.name).toBe('University');
    expect(projects.listProjects().map((project) => project.name)).toContain('University');
  });
});
