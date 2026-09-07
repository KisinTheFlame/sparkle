import type { LoopAgentExtension, ReActCommittedRoundResult } from "@sparkle/agent-runtime";
import type {
  RootAgentCompletion,
  RootAgentToolExecutionData,
  RootLoopExtensionContext,
} from "../root-agent-runtime.js";

export class ContextCompactionExtension implements LoopAgentExtension<
  RootLoopExtensionContext,
  "agent",
  RootAgentCompletion,
  RootAgentToolExecutionData
> {
  public async onAfterCommit(input: {
    context: RootLoopExtensionContext;
    result: ReActCommittedRoundResult<RootAgentCompletion, RootAgentToolExecutionData>;
  }): Promise<void> {
    if (input.context.signal?.aborted) return;
    const compacted = await input.context.host.compactContextIfNeeded(
      input.result.completion.usage?.totalTokens,
      input.context.signal,
    );
    if (compacted) {
      await input.context.notifyContextCompacted();
    }
  }
}
