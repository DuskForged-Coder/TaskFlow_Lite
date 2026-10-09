import { randomUUID } from 'node:crypto';
import { UserError } from '../errors.js';
import type { Task } from '../tasks/task.js';
import type { TaskService } from '../tasks/taskService.js';
import type { Project } from './project.js';
import type { ProjectRepository } from './projectRepository.js';

export class ProjectService {
  constructor(
    private readonly repository: ProjectRepository,
    private readonly tasks: TaskService,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  createProject(name: string): Project {
    const normalized = name.trim();
    if (!normalized) throw new UserError('A project name cannot be empty.');
    if (normalized.length > 80) throw new UserError('A project name cannot exceed 80 characters.');
    if (/[\u0000-\u001F\u007F-\u009F]/.test(normalized)) throw new UserError('A project name cannot contain terminal control characters.');
    if (this.repository.findByName(normalized)) throw new UserError(`A project named “${normalized}” already exists.`);
    return this.repository.create({ id: this.createId(), name: normalized, createdAt: this.clock().toISOString() });
  }

  listProjects(): Project[] {
    return this.repository.list();
  }

  assignTask(taskId: string, projectName: string): Task {
    const project = this.repository.findByName(projectName.trim());
    if (!project) throw new UserError(`Project “${projectName}” was not found.`);
    return this.tasks.assignProject(taskId, project.id);
  }

  projectName(projectId: string | null): string | null {
    if (!projectId) return null;
    return this.repository.getById(projectId)?.name ?? null;
  }
}