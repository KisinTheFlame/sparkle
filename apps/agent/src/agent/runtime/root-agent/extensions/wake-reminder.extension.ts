import type { LoopAgentExtension } from "@sparkle/agent-runtime";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

export class WakeReminderExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onBeforeRound(context: RootLoopExtensionContext): Promise<void> {
    await context.host.appendWakeReminderIfNeeded();
  }
}
