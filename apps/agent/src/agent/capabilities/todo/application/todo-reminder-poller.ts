import { AppLogger } from "@sparkle/kernel/logger/logger";
import { TODO_LIST_RENDER_LIMIT } from "./todo.constants.js";
import type { DigestSummary, DueReminder, TodoService } from "./todo.service.js";

const logger = new AppLogger({ source: "todo.reminder-poller" });

type TodoReminderPollerDeps = {
  todoService: TodoService;
  /** 每条到点提醒回调一次（由上层构造 TodoReminderDraft 并 push）。 */
  onDueReminder: (reminder: DueReminder) => void;
  /** 每次待办回顾（每天两次）无条件回调一次（由上层构造 TodoDigestDraft 并 push）。 */
  onDigest: (summary: DigestSummary) => void;
};

/**
 * 到点提醒 + 每日回顾的执行体。
 *
 * `runOnce`（reminder-tick，无 dedupe）catch+log 不 rethrow：漏一拍等下一拍即可，无游标可推进。
 * `runDigest`（daily-digest，dedupe=true）**失败要 rethrow**：调度器 SDK 靠 handler 是否抛错决定要不要
 * 推进「已处理」游标（见 scheduler-client 的 markSeen-after-success 语义）。若 buildDigest / onDigest 因 DB
 * 抖动等抛错却被吞掉，SDK 会误以为成功、推进游标，这一次日报就被静默丢掉、且重连补发也不会重试。所以
 * digest 的真实失败必须往上抛，让 misfire=catchup 补发重试。
 *
 * 自身不构造任何 NotificationDraft：到点/汇总以纯数据经回调交给 server-runtime 构造并 push，
 * 保持 capabilities 层不依赖 apps 层。
 */
export class TodoReminderPoller {
  private readonly todoService: TodoService;
  private readonly onDueReminder: (reminder: DueReminder) => void;
  private readonly onDigest: (summary: DigestSummary) => void;

  public constructor({ todoService, onDueReminder, onDigest }: TodoReminderPollerDeps) {
    this.todoService = todoService;
    this.onDueReminder = onDueReminder;
    this.onDigest = onDigest;
  }

  /** 一个 reminder tick：收集到点项并逐条回调。空拍零回调、零 push。 */
  public async runOnce(): Promise<void> {
    try {
      const due = await this.todoService.collectDueReminders();
      for (const reminder of due) {
        this.onDueReminder(reminder);
      }
    } catch (error) {
      logger.warn("Failed to run todo reminder tick", {
        event: "todo.reminder_tick_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 待办回顾：每天两次（09:00 / 21:00）无条件回调一次。
   *
   * 即使当前没有未完成项也照样回调——这条 App 级提醒除了汇总未完成项，还要顺带推动 Sparkle 去
   * todo App 按自己打算做的事添新待办，所以空待办时也得发（由 TodoDigestDraft 渲染兜底文案）。
   *
   * buildDigest / onDigest 的真实失败会 rethrow：dedupe 任务靠抛错让调度器不推进游标、重连补发重试，
   * 吞掉就会静默丢当天日报（见类注释）。
   */
  public async runDigest(): Promise<void> {
    try {
      const summary = await this.todoService.buildDigest({ limit: TODO_LIST_RENDER_LIMIT });
      this.onDigest(summary);
    } catch (error) {
      logger.warn("Failed to run todo daily digest, rethrowing for scheduler retry", {
        event: "todo.digest_failed",
        errorName: error instanceof Error ? error.name : "Error",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      // rethrow：让 scheduler-client 的 runHandler 判定失败、不推进 dedupe 游标 → catchup 补发重试。
      throw error;
    }
  }
}
