import type { Project } from './project.js';

export interface ProjectRepository {
  create(project: Project): Project;
  getById(id: string): Project | null;
  findByName(name: string): Project | null;
  list(): Project[];
}