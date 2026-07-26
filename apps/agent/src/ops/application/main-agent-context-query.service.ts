import type {
  MainAgentContextCompactionRequest,
  MainAgentContextCompactionResult,
  MainAgentContextSnapshot,
} from "@sparkle/agent-api/main-agent-context";

export interface MainAgentContextQueryService {
  getRecentSnapshot(): Promise<MainAgentContextSnapshot>;
  compactContext(
    input: MainAgentContextCompactionRequest,
  ): Promise<MainAgentContextCompactionResult>;
}
