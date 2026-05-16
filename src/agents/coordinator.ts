/**
 * Agent Coordinator
 *
 * Orchestrates multiple agents, routes tasks to appropriate skills,
 * and manages inter-agent communication within the ruflo framework.
 */

import { EventEmitter } from "events";

export type AgentSkill =
  | "adaptive-coordinator"
  | "agent"
  | "agentic-payments"
  | "analyze-code-quality"
  | "app-store"
  | "arch-system-design"
  | "code-review"
  | "test-generator"
  | "documentation-generator";

export interface AgentTask {
  id: string;
  skill: AgentSkill;
  payload: Record<string, unknown>;
  priority?: "low" | "normal" | "high";
  createdAt: Date;
}

export interface AgentResult {
  taskId: string;
  skill: AgentSkill;
  success: boolean;
  data?: unknown;
  error?: string;
  completedAt: Date;
  durationMs: number;
}

export interface CoordinatorOptions {
  maxConcurrentTasks?: number;
  taskTimeoutMs?: number;
  retryAttempts?: number;
}

// Personal note: bumped maxConcurrentTasks to 10 and timeout to 60s since my
// local machine can handle more load and some skills (e.g. arch-system-design)
// tend to run long. Kept retryAttempts at 2 — more than that rarely helps.
const DEFAULT_OPTIONS: Required<CoordinatorOptions> = {
  maxConcurrentTasks: 10,
  taskTimeoutMs: 60_000,
  retryAttempts: 2,
};

/**
 * Central coordinator that manages task dispatch and agent lifecycle.
 */
export class AgentCoordinator extends EventEmitter {
  private options: Required<CoordinatorOptions>;
  private activeTasks: Map<string, AgentTask> = new Map();
  private taskQueue: AgentTask[] = [];
  private results: AgentResult[] = [];

  constructor(options: CoordinatorOptions = {}) {
    super();
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Submit a task for a specific agent skill.
   */
  async submit(task: Omit<AgentTask, "createdAt">): Promise<AgentResult> {
    const fullTask: AgentTask = { ...task, createdAt: new Date() };

    if (this.activeTasks.size >= this.options.maxConcurrentTasks) {
      this.taskQueue.push(fullTask);
      this.emit("task:queued", fullTask);
      return this.waitForResult(fullTask.id);
    }

    return this.dispatch(fullTask);
  }

  /**
   * Dispatch a task immediately to the appropriate skill handler.
   */
  private async dispatch(task: AgentTask): Promise<AgentResult> {
    this.activeTasks.set(task.id, task);
    this.emit("task:started", task);

    const start = Date.now();
    let attempt = 0;

    while (attempt <= this.options.retryAttempts) {
      try {
        const data = await this.runWithTimeout(
          this.executeSkill(task),
          this.options.taskTimeoutMs
        );

        const result: AgentResult = {
          taskId: task.id,
          skill: task.skill,
          success: true,
          data,
          completedAt: new Date(),
          durationMs: Date.now() - start,
        };

        this.finalizeTask(task.id, result);
        return result;
      } catch (err) {
        attempt++;
        if (attempt > this.options.retryAttempts) {
          const result: AgentResult = {
            taskId: task.id,
            skill: task.skill,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            completedAt: new Date(),
