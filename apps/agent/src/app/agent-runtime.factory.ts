import type { AgentLlmClient } from "../agent/runtime/llm-client.js";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AppManager,
  AsyncTaskManager,
  createAppSubtoolOwner,
  createUnguardedSubtoolOwner,
  HelpTool,
  OutOfScopeTool,
  ToolCatalog,
  type Queue,
  type ToolComponent,
  type ToolExecutor,
} from "@sparkle/agent-runtime";
import { AppLogger } from "@sparkle/kernel/logger/logger";
import type { Config } from "@sparkle/kernel/config/config.loader";
import type { Database } from "@sparkle/persistence/db/client";
import type { MetricClient } from "@sparkle/metric-client/client";
import type { IthomeService } from "../agent/capabilities/ithome/application/ithome.service.js";
import type { MainAgentContextQueryService } from "../ops/application/main-agent-context-query.service.js";
import { DefaultMainAgentContextQueryService } from "../ops/application/main-agent-context-query.impl.service.js";
import { DefaultAgentContext } from "../agent/runtime/context/default-agent-context.js";
import { LinearMessageLedgerAgentContext } from "../agent/runtime/context/linear-message-ledger-agent-context.js";
import type { Event } from "../agent/runtime/event/event.js";
import { RootLoopAgent } from "../agent/runtime/root-agent/root-agent-runtime.js";
import { PrismaRootAgentRuntimeSnapshotRepository } from "../agent/runtime/root-agent/persistence/prisma-root-agent-runtime-snapshot.repository.js";
import { ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY } from "../agent/runtime/root-agent/persistence/root-agent-runtime-snapshot.repository.js";
import { createAgentSystemPrompt } from "../agent/runtime/root-agent/system-prompt.js";
import { RootAgentSession } from "../agent/runtime/root-agent/session/root-agent-session.js";
import { StateSampler } from "../agent/runtime/root-agent/state-sampler.js";
import { FOREGROUND_METRIC_KNOCK } from "../agent/runtime/root-agent/foreground-input.js";
import { SwitchTool, SWITCH_TOOL_NAME } from "../agent/runtime/root-agent/tools/switch.tool.js";
import { InvokeTool, INVOKE_TOOL_NAME } from "../agent/runtime/root-agent/tools/invoke.tool.js";
import { WaitTool } from "../agent/runtime/root-agent/tools/wait.tool.js";
import { createRootContextSummaryReminderMessage } from "../agent/runtime/context/context-message-factory.js";
import { SummaryTaskAgent } from "../agent/capabilities/context-summary/task-agent/summary-task-agent.js";
import { FinalizeSummaryTool } from "../agent/capabilities/context-summary/task-agent/tools/finalize-summary.tool.js";
import { PrismaTerminalStateDao } from "../agent/capabilities/terminal/infra/prisma-terminal-state.dao.js";
import { PrismaTerminalOutputDao } from "../agent/capabilities/terminal/infra/prisma-terminal-output.dao.js";
import { TerminalApp } from "../agent/apps/terminal/terminal.app.js";
import { IthomeApp } from "../agent/apps/ithome/ithome.app.js";
import { BrowserApp } from "../agent/apps/browser/browser.app.js";
import type { BrowserClient } from "../acl/browser-client.js";
import { TodoApp } from "../agent/apps/todo/todo.app.js";
import type { TodoService } from "../agent/capabilities/todo/application/todo.service.js";
import { NoteApp } from "../agent/apps/note/note.app.js";
import { NoteService } from "../agent/capabilities/note/application/note.service.js";
import { PrismaNoteDao } from "../agent/capabilities/note/infra/prisma-note.dao.js";
import { PrismaLinearMessageLedgerDao } from "../agent/capabilities/ledger/infra/impl/prisma-linear-message-ledger.impl.dao.js";
import { AppEntryResetExtension } from "../agent/runtime/root-agent/extensions/app-entry-reset.extension.js";
import { ResourceService } from "../agent/capabilities/resource/application/resource.service.js";
import { ResourceFileService } from "../agent/capabilities/resource/application/resource-file.service.js";
import { ReadResourceTool } from "../agent/capabilities/resource/tools/read-resource.tool.js";
import { DownloadResourceTool } from "../agent/capabilities/resource/tools/download-resource.tool.js";
import { UploadResourceTool } from "../agent/capabilities/resource/tools/upload-resource.tool.js";
import type { OssClient } from "../acl/oss-client.js";
import { ClockApp } from "../agent/apps/clock/clock.app.js";
import { AmapApp } from "../agent/apps/amap/amap.app.js";
import { AtelierApp } from "../agent/apps/atelier/atelier.app.js";
import type { ImageClient } from "../acl/image-client.js";
import type { FeishuClient } from "../acl/feishu-client.js";
import { FeishuApp } from "../agent/apps/feishu/feishu.app.js";
import { PrismaAppStateStore } from "../agent/runtime/app-state/prisma-app-state-store.js";
import type { NotificationCenter } from "../agent/runtime/root-agent/notification/notification-center.js";
import { SkillCatalog } from "../agent/capabilities/skills/skill-catalog.js";
import { SkillCatalogNotificationDraft } from "../agent/capabilities/skills/skill-catalog-notification-draft.js";
import { SystemPromptSnapshotExtension } from "../agent/runtime/root-agent/extensions/system-prompt-snapshot.extension.js";

type BuildAgentRuntimeInput = {
  config: Config;
  database: Database;
  llmClient: AgentLlmClient;
  metricService: MetricClient;
  /** 飞书出站门面：打到独立的 sparkle-feishu 进程。入站由 server-runtime 的 SSE 订阅者注入。 */
  feishuClient: FeishuClient;
  ithomeService: IthomeService;
  todoService: TodoService;
  notificationCenter: NotificationCenter;
  eventQueue: Queue<Event>;
  /** 自建对象存储客户端；缺省（server.oss 未配）时资源读取/发送/截图落 OSS 优雅降级。 */
  ossClient?: OssClient;
  /** 浏览器动作客户端：打到独立的 sparkle-browser 进程（issue #173）。 */
  browserClient: BrowserClient;
  /** 生图客户端：打到 sparkle-llm 的生图端点（走 codex 订阅额度，issue #508）。 */
  imageClient: ImageClient;
};

export type AgentRuntimeBundle = {
  rootAgentRuntime: RootLoopAgent;
  mainAgentContextQueryService: MainAgentContextQueryService;
  /** 飞书 App：消息渠道的承载者。入站事件由 server-runtime 的 SSE 订阅者喂给它。 */
  feishuApp: FeishuApp;
  /**
   * 状态心跳采样器：随 run loop 生命周期 start()（不在 loop 未活时打点，避免虚假 portal 样本），
   * 服务关停时 stop()。见 index.ts / server-shutdown.ts。
   */
  stateSampler: StateSampler;
  /** 禁止新输入并等待在途工作，必须先于 App 存档完成。 */
  stopInputs: () => Promise<void>;
  /** 反序关停所有 App 的 onShutdown。由服务关停链调用。 */
  shutdownApps: () => Promise<void>;
};

const logger = new AppLogger({ source: "agent.runtime-factory" });

/**
 * fork 型 task agent（summary）的镜像工具目录：与主 Agent
 * 顶层工具集一字不差（同样的 name / description / parameters / llmTool 与顺序），
 * 执行语义完全隔离——invoke 换成只挂该 task agent 子工具的实例，其余顶层工具用
 * OutOfScopeTool 软包，调到就返回 OUT_OF_SCOPE 错误，不会真的改主 Agent 的
 * session。这是 prompt cache 字节相等 + 行为隔离的关键搭配。
 *
 * 从主 Agent 的同一份有序清单（mainTopLevelTools）派生：主 Agent 加/删/重排
 * 顶层工具时所有镜像自动跟随，不会漂移出字节不等的 tools 前缀。
 */
function createMirroredTaskAgentTools({
  mainTopLevelTools,
  invokeTool,
  overrideReasons = {},
  defaultReason,
}: {
  mainTopLevelTools: readonly ToolComponent[];
  invokeTool: ToolComponent;
  /** 个别工具的定制拒绝话术（如 switch 上顺带指路终止子工具）。 */
  overrideReasons?: Record<string, string>;
  defaultReason: (toolName: string) => string;
}): ToolExecutor {
  const mirrored = mainTopLevelTools.map(tool =>
    tool.name === INVOKE_TOOL_NAME
      ? invokeTool
      : new OutOfScopeTool({
          inner: tool,
          reason: overrideReasons[tool.name] ?? defaultReason(tool.name),
        }),
  );
  return new ToolCatalog(mirrored).pick(mirrored.map(tool => tool.name));
}

/**
 * fork 型 task agent 的镜像工具装配（现存 summary 一个）。可变的只有三处：终止子工具、
 * 任务名标签、提交指引；其余（挂 invoke 的 unguarded owner、switch 的定制指路话术、
 * 其它顶层工具的默认拒绝话术）形状完全一致，这里收敛成一个小工厂。
 *
 * 拒绝话术会进各 fork agent 的 tools 前缀，是 KV 缓存字节相等的一部分——模板拼出的字符串
 * 与收敛前逐字节相同（见 fork-task-agent-tools 单测钉死），改这里等于改各子 agent 的前缀。
 */
function buildForkTaskAgentTools({
  mainTopLevelTools,
  terminalTool,
  taskLabel,
  submitHint,
}: {
  mainTopLevelTools: readonly ToolComponent[];
  /** 该子任务唯一可用的终止子工具（挂到自己的 invoke 上）。 */
  terminalTool: ToolComponent;
  /** 任务名标签，嵌进拒绝话术，如 "上下文摘要子任务"。 */
  taskLabel: string;
  /** 提交指引（不含句号），如 `invoke(tool="finalize_summary", summary=...) 提交最终摘要`。 */
  submitHint: string;
}): ToolExecutor {
  return createMirroredTaskAgentTools({
    mainTopLevelTools,
    invokeTool: new InvokeTool({
      owners: [createUnguardedSubtoolOwner({ tools: [terminalTool] })],
    }),
    overrideReasons: {
      [SWITCH_TOOL_NAME]: `在${taskLabel}中不可调用 switch。请用 ${submitHint}。`,
    },
    defaultReason: toolName => `在${taskLabel}中不可调用 ${toolName}。`,
  });
}

export async function buildAgentRuntime({
  config,
  database,
  llmClient,
  metricService,
  feishuClient,
  ithomeService,
  todoService,
  notificationCenter,
  eventQueue,
  ossClient,
  browserClient,
  imageClient,
}: BuildAgentRuntimeInput): Promise<AgentRuntimeBundle> {
  const rootAgentRuntimeSnapshotRepository = new PrismaRootAgentRuntimeSnapshotRepository({
    database,
  });
  const linearMessageLedgerDao = new PrismaLinearMessageLedgerDao({ database });

  const terminalStateDao = new PrismaTerminalStateDao({ database });
  const terminalOutputDao = new PrismaTerminalOutputDao({ database });

  // 资源读取层：read_resource 全局工具使用。OSS 关闭时调用层报错，构造本身不依赖 OSS 在线。
  const resourceService = new ResourceService({
    ossClient,
    maxBytes: config.server.agent.resource.maxBytes,
  });
  // 资源本地文件桥：download_resource / upload_resource 全局工具共用。落盘/读盘锚定
  // fileRoot 沙箱，字节走 fileMaxBytes（独立于上下文 cap）。OSS 关时调用层报错。
  const resourceFileService = new ResourceFileService({
    ossClient,
    fileRoot: config.server.agent.resource.fileRoot,
    fileMaxBytes: config.server.agent.resource.fileMaxBytes,
  });

  // App 框架：先建 AppManager 并注册 Apps，再按各 App 的 configSchema 校验
  // config.server.apps 切片并 onStartup；createAppSubtoolOwner 在内部摊平 App 工具
  // 挂到主 Agent 的 InvokeTool 上。注入 App 状态持久化能力：startup 时恢复、shutdown
  // 时存档各 App 自己的状态，走 app_state 通用表。
  const appManager = new AppManager({
    stateStore: new PrismaAppStateStore({ database }),
    onStateError: ({ appId, phase, error }) => {
      // 状态恢复/存档失败虽不阻断启停，但绝不静默：跨重启状态无声丢失
      // 会让运维完全无从察觉，故落结构化日志。
      const phaseLabel =
        phase === "restore" ? "恢复" : phase === "shutdown" ? "启动回滚关停" : "存档";
      logger.errorWithCause(`App "${appId}" 状态${phaseLabel}失败`, error, {
        event: "agent.app_state.persist_failed",
        appId,
        phase,
      });
    },
  });
  appManager.register(new TerminalApp({ terminalStateDao, terminalOutputDao }));
  appManager.register(new IthomeApp({ ithomeService }));
  appManager.register(new TodoApp({ todoService }));
  // 笔记 App：Sparkle 自维护的长期记忆（页 = 主题，纯追加，见 docs/adr/0001）。
  // service 只被本 App 消费，就地装配。
  appManager.register(
    new NoteApp({ noteService: new NoteService({ noteDao: new PrismaNoteDao({ database }) }) }),
  );
  appManager.register(new ClockApp());
  appManager.register(new AmapApp({ ossClient }));
  appManager.register(new BrowserApp({ browserClient, ossClient }));
  // 共享异步任务原语：completion 以事件形式塞回主 Agent 事件队列，session 装配成 <async_tool_result>
  // 尾部追加触发新轮。atelier 是首个消费者；未来其它异步工具复用同一实例（#508）。
  const asyncTaskManager = new AsyncTaskManager({
    onComplete: completion =>
      eventQueue.enqueue({ type: "async_tool_result_completed", data: completion }),
    maxTaskDurationMs: config.server.agent.asyncTask.maxTaskDurationMs,
  });
  appManager.register(new AtelierApp({ imageClient, ossClient, asyncTaskManager }));
  // 飞书 App 装配：入站事件经 server-runtime 的 SSE 订阅者直达 handleInboundMessage
  // （不走共享事件队列），出站统一走注入的 feishuClient。
  const feishuApp = new FeishuApp({
    feishuClient,
    notificationCenter,
    // 前台输入敲门端口：knock 计数（fire-and-forget）+ enqueue 不带内容的敲门事件。
    // 与 inject / drain_empty（session 侧）合成前台路径的三计数观测。
    notifyForegroundInput: () => {
      void metricService
        .record({ metricName: FOREGROUND_METRIC_KNOCK, value: 1, tags: { runtime: "agent" } })
        .catch(() => undefined);
      eventQueue.enqueue({ type: "foreground_input" });
    },
  });
  appManager.register(feishuApp);
  await appManager.startupAll(config.server.apps);

  const skillsDirectory = join(homedir(), "sparkle", "skills");
  const skillCatalog = new SkillCatalog({
    directory: skillsDirectory,
    onChange: changes => notificationCenter.push(new SkillCatalogNotificationDraft({ changes })),
    onError: error => logger.errorWithCause("Skill catalog watcher failed", error),
  });
  const systemPromptSnapshot = new SystemPromptSnapshotExtension({
    render: async () => {
      await skillCatalog.refresh();
      return createAgentSystemPrompt({
        employerName: config.server.employer.name,
        apps: appManager
          .getAllApps()
          .map(app => ({ id: app.id, displayName: app.displayName, description: app.description })),
        skillsDirectory,
        skills: skillCatalog.getEntries(),
      });
    },
  });
  await systemPromptSnapshot.rebuild();
  // root agent 每条进上下文的消息追加到 ledger（physical table `ledger`），只写不读，
  // 作为将来记忆系统的原始素材来源。
  const context = new LinearMessageLedgerAgentContext({
    inner: new DefaultAgentContext({
      systemPromptFactory: () => systemPromptSnapshot.getSystemPrompt(),
    }),
    linearMessageLedgerDao,
    runtimeKey: ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  });
  const rootAgentSession = new RootAgentSession({
    context,
    appManager,
    metricService,
  });
  const helpTool = new HelpTool({
    appManager,
    getCurrentApp: () => rootAgentSession.getCurrentApp(),
    // 导航语义（怎么进入 App）是 Sparkle 的，不属于通用内核：文案在这里注入。
    notInAppHint:
      "你不在任何 App 里。先用 switch 进入一个 App，再调用 help 查看那个 App 能做什么；有哪些 App 见系统说明里的 App 列表。",
    appNotFoundHint: (appId: string) =>
      `当前所在 App "${appId}" 已找不到。可能被卸载或重启过，现在有哪些 App 见系统说明里的 App 列表。`,
  });
  // 主 Agent 的 invoke 子工具所有者：全部 App 工具由 AppManager 把握所有权与 gate。
  const mainSubtoolOwners = [
    createAppSubtoolOwner({
      appManager,
      getCurrentApp: () => rootAgentSession.getCurrentApp(),
    }),
  ];

  // 主 Agent 的顶层工具实例。fork 型 task agent（summary）之后会复用这些
  // 实例的 llmTool 定义（通过 OutOfScopeTool 包一层），保证各 agent 暴露给 LLM 的
  // tools 字段字节相等，命中 KV cache。
  const switchTool = new SwitchTool({ appManager });
  const waitTool = new WaitTool({
    maxWaitMs: config.server.agent.waitToolMaxWaitMs,
  });
  const mainInvokeTool = new InvokeTool({ owners: mainSubtoolOwners });
  const readResourceTool = new ReadResourceTool({ resourceService });
  const downloadResourceTool = new DownloadResourceTool({ resourceFileService });
  const uploadResourceTool = new UploadResourceTool({ resourceFileService });
  // 主 Agent 顶层工具的唯一有序清单：toolCatalog / rootAgentTools / fork 型
  // task agent 的镜像目录都从它派生。顺序即 LLM tools 数组顺序，是 KV 缓存稳定
  // 前缀的一部分——加/删/重排只改这一处。
  const mainTopLevelTools: ToolComponent[] = [
    switchTool,
    waitTool,
    mainInvokeTool,
    readResourceTool,
    downloadResourceTool,
    uploadResourceTool,
    helpTool,
  ];
  const toolCatalog = new ToolCatalog(mainTopLevelTools);
  const rootAgentTools = toolCatalog.pick(mainTopLevelTools.map(tool => tool.name));

  // fork 型 task agent（summary）经镜像装配从主 Agent 的同一份有序顶层工具清单派生
  // （见 buildForkTaskAgentTools），主 Agent 加/删/重排工具时镜像自动跟随，不会漂移出
  // 字节不等的 tools 前缀；请求前缀与主 Agent 字节相等，命中 Anthropic prompt cache
  // （issue #265 / #410）。
  const summaryTaskAgent = new SummaryTaskAgent({
    llmClient,
    taskTools: buildForkTaskAgentTools({
      mainTopLevelTools,
      terminalTool: new FinalizeSummaryTool(),
      taskLabel: "上下文摘要子任务",
      submitHint: 'invoke(tool="finalize_summary", summary=...) 提交最终摘要',
    }),
    reminderMessageFactory: createRootContextSummaryReminderMessage,
  });
  const rootAgentRuntime = new RootLoopAgent({
    llmClient,
    context,
    eventQueue,
    session: rootAgentSession,
    snapshotRepository: rootAgentRuntimeSnapshotRepository,
    tools: rootAgentTools,
    contextSummarizer: summaryTaskAgent,
    contextCompactionTotalTokenThreshold: config.server.agent.contextCompactionTotalTokenThreshold,
    contextCompactionImageCountThreshold: config.server.agent.contextCompactionImageCountThreshold,
    metricService,
    llmRetryBackoffMs: config.server.agent.llmRetryBackoffMs,
    // 纯文本轮挂起的自唤醒兜底与 wait 工具共用同一个上限，语义一致：Agent 最多
    // 安静这么久就会自己醒来一轮。
    idleWakeMaxWaitMs: config.server.agent.waitToolMaxWaitMs,
    loopExtensions: [
      new AppEntryResetExtension({ session: rootAgentSession }),
      systemPromptSnapshot,
    ],
  });

  const restoredSnapshot = await rootAgentRuntimeSnapshotRepository.load(
    ROOT_AGENT_RUNTIME_SNAPSHOT_RUNTIME_KEY,
  );
  if (restoredSnapshot) {
    await rootAgentRuntime.restorePersistedSnapshot(restoredSnapshot);
  }

  const mainAgentContextQueryService = new DefaultMainAgentContextQueryService({
    rootAgentRuntime,
  });

  // 状态心跳采样器：读 session 的单一状态真相源，走注入的 metricService。启停由 wiring 层
  // （index.ts run loop / server-shutdown）掌握，见 stateSampler 字段注释。
  const stateSampler = new StateSampler({
    getStateTag: () => rootAgentSession.getCurrentStateTag(),
    metricClient: metricService,
    now: () => new Date(),
    intervalMs: config.server.agent.stateSampleIntervalMs,
  });

  await skillCatalog.startWatching();

  return {
    rootAgentRuntime,
    mainAgentContextQueryService,
    feishuApp,
    stateSampler,
    stopInputs: async () => {
      notificationCenter.stop();
      const results = await Promise.allSettled([skillCatalog.stop(), asyncTaskManager.stop()]);
      const errors: unknown[] = [];
      for (const result of results) {
        if (result.status === "rejected") errors.push(result.reason);
      }
      if (errors.length > 0) throw new AggregateError(errors, "Failed to stop agent inputs");
    },
    shutdownApps: async () => {
      await appManager.shutdownAll();
    },
  };
}
