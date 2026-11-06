export interface GuardOutcome<T> {
  ignored: boolean;
  value?: T;
}

/**
 * Section 8.9 / 8.10: a project-level running guard. Duplicate requests for the
 * same project are ignored until the first operation settles, then restored.
 */
export class ProjectOperationGuard {
  private readonly active = new Set<string>();

  public isActive(project: string): boolean {
    return this.active.has(project);
  }

  public async run<T>(project: string, task: () => Promise<T>): Promise<GuardOutcome<T>> {
    if (this.active.has(project)) {
      return { ignored: true };
    }
    this.active.add(project);
    try {
      return { ignored: false, value: await task() };
    } finally {
      this.active.delete(project);
    }
  }
}
