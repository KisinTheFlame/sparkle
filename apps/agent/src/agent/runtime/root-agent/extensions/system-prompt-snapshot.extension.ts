import type { LoopAgentExtension } from "@sparkle/agent-runtime";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

/** 只在启动、reset 和成功压缩后重建；读快照绝不触发渲染或文件扫描。 */
export class SystemPromptSnapshotExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  private readonly render: () => Promise<string>;
  private prompt: string | null = null;

  public constructor({ render }: { render: () => Promise<string> }) {
    this.render = render;
  }

  public getSystemPrompt(): string {
    if (this.prompt === null) throw new Error("System prompt snapshot is not initialized");
    return this.prompt;
  }

  public async rebuild(): Promise<void> {
    this.prompt = await this.render();
  }

  public async onAfterReset(): Promise<void> {
    await this.rebuild();
  }

  public async onContextCompacted(): Promise<void> {
    await this.rebuild();
  }
}
