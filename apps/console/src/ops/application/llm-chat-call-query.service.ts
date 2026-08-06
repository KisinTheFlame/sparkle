import {
  type LlmChatCallDetailResponse,
  type LlmChatCallListQuery,
  type LlmChatCallListResponse,
} from "@sparkle/console-api/llm-chat-call";

export interface LlmChatCallQueryService {
  queryList(query: LlmChatCallListQuery): Promise<LlmChatCallListResponse>;
  getDetail(id: number): Promise<LlmChatCallDetailResponse>;
}
