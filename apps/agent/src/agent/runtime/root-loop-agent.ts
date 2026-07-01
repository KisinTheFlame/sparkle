import {
  BaseLoopAgent,
  ReActKernel,
  type EffectInterpreter,
  type Queue,
  type ReActKernelRunRoundInput,
  type ReActModel,
  type ReActRoundResult,
  type ToolExecutor,
} from "@sparkle/agent-runtime";
import type { AgentEvent } from "../events/event.js";
import type { AgentContext } from "../context/in-memory-agent-context.js";
import type { AgentLogger, RootAgentCompletion, RootAgentUsage } from "./types.js";

/**
 * RootLoopAgent：sparkle 的具体主循环（"AI 员工"）。把 agent-runtime 的 kernel
 * 原语组装成一个能真正转起来的常驻 loop。
 *
 * 一轮（runOnce）的控制流：
 *   1. drain 事件 Queue：user_message → 追加成 user 消息进 context；wake → 忽略
 *   2. runReactRound()：用 context 快照 + 工具集跑一轮 ReAct
 *        kernel.runRound → model.chat(toolChoice:"required") → 模型必调 End
 *          End 产 wait_for_event Effect → interpreter 的 WaitForEventHandler
 *          阻塞在事件 Queue 上（这就是 loop 的"挂起"）
 *        被新事件 / 超时 / 停机唤醒后本轮收尾、commit
 *   3. 下一轮 drain 消费掉唤醒它的那条事件
 *
 * 没有轮询、没有 tick：loop 空闲 = 某个工具阻塞在 producer 上。
 */
/** 单轮失败后的默认退避毫秒数：防止持续报错时空转烧 token。 */
const DEFAULT_ERROR_BACKOFF_MS = 1000;

export class RootLoopAgent extends BaseLoopAgent<RootAgentUsage, RootAgentCompletion> {
  private readonly context: AgentContext;
  private readonly queue: Queue<AgentEvent>;
  private readonly tools: ToolExecutor;
  private readonly logger: AgentLogger;
  private readonly errorBackoffMs: number;
  /** 是否有未被成功响应的用户输入。drain 到 user_message 置真，成功 commit 后清零。 */
  private pendingUserInput = false;

  public constructor({
    model,
    interpreter,
    context,
    queue,
    tools,
    logger,
    errorBackoffMs = DEFAULT_ERROR_BACKOFF_MS,
  }: {
    model: ReActModel<RootAgentUsage, RootAgentCompletion>;
    interpreter: EffectInterpreter;
    context: AgentContext;
    queue: Queue<AgentEvent>;
    tools: ToolExecutor;
    logger: AgentLogger;
    /** 单轮失败后的退避毫秒数（测试注入小值）。 */
    errorBackoffMs?: number;
  }) {
    super({
      kernel: new ReActKernel<RootAgentUsage, RootAgentCompletion>({ model, interpreter }),
    });
    this.context = context;
    this.queue = queue;
    this.tools = tools;
    this.logger = logger;
    this.errorBackoffMs = errorBackoffMs;
  }

  public override async start(): Promise<void> {
    this.logger.info("agent loop started", { event: "agent.loop.started" });
    await super.start();
  }

  protected async initializeHostIfNeeded(): Promise<void> {
    // v1 无 host / 无需异步初始化。
  }

  protected createLoopExtensionContext(): void {
    // v1 不装 LoopAgentExtension，扩展上下文为空。
  }

  protected async runOnce(): Promise<void> {
    this.drainEvents();
    // 核心不变量：只有存在"未处理的用户输入"时才跑 LLM 轮，否则阻塞等下一个事件。
    // 这里（commit 之后）是 loop 唯一的挂起点——工具内不阻塞，所以每轮的回复都能在
    // 挂起前就 commit、被 transcript 看到。该不变量同时挡掉空转烧钱：boot 无输入、
    // 上一轮已响应完（pendingUserInput 已清）、stop 塞的 wake（无新输入）都会在此 block。
    if (!this.pendingUserInput) {
      await this.queue.waitNonEmpty();
      return;
    }
    // 常驻 loop 不能因单次 LLM/工具错误就永久死亡（kernel 没装 retry 扩展，错误会一路
    // 抛穿 runLoop 让 start() reject）。这里兜住：记录 + 退避后继续。触发本轮的 user
    // 消息已进 context、错误轮不 commit，所以 pendingUserInput 仍为 true，下一轮重试同一
    // 上下文；成功 commit 才清标志。
    try {
      await this.runReactRound();
    } catch (error) {
      this.logger.errorWithCause("agent round failed", error, { event: "agent.round.failed" });
      await this.backoff(this.errorBackoffMs);
    }
  }

  /**
   * 退避：完整等满 ms（provider 故障时不被新事件冲垮成即时重试——否则退避形同虚设），
   * 但每 50ms 探一次 stopRequested，让停机在 50ms 内退出而非干等满退避。
   */
  private async backoff(ms: number): Promise<void> {
    const step = 50;
    let waited = 0;
    while (waited < ms && !this.stopRequested) {
      const chunk = Math.min(step, ms - waited);
      await new Promise<void>(resolve => setTimeout(resolve, chunk));
      waited += chunk;
    }
  }

  protected async buildRoundInput(): Promise<ReActKernelRunRoundInput<RootAgentUsage> | null> {
    const snapshot = this.context.getSnapshot();
    return {
      state: {
        systemPrompt: snapshot.systemPrompt,
        messages: snapshot.messages,
      },
      tools: this.tools,
      usage: "agent",
    };
  }

  protected async commitRoundResult(result: ReActRoundResult<RootAgentCompletion>): Promise<void> {
    this.context.appendMessages([result.assistantMessage, ...result.appendedMessages]);
    // 输入已得到一次成功响应：清 pending，下一次 wake 若无新输入就不再空跑 LLM。
    this.pendingUserInput = false;
    this.logTurn(result);
  }

  /**
   * stop() 时被调：往事件 Queue 塞一个 wake，唤醒阻塞在 wait_for_event 上的本轮，
   * 使 runLoop 能在 stopRequested=true 后及时退出。
   */
  protected override onStopRequested(): void {
    this.queue.enqueue({ type: "wake" });
  }

  private drainEvents(): void {
    for (;;) {
      const event = this.queue.dequeue();
      if (event === null) {
        break;
      }
      if (event.type === "user_message") {
        this.context.appendUserMessage(event.content);
        this.pendingUserInput = true;
      }
      // "wake" 事件无 context 语义——它只为解除 Queue 阻塞，drain 时丢弃即可。
    }
  }

  private logTurn(result: ReActRoundResult<RootAgentCompletion>): void {
    const content = result.assistantMessage.content;
    if (content.length > 0) {
      this.logger.info("agent turn", { event: "agent.turn", content });
    }
  }
}
