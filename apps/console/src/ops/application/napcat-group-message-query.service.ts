import {
  type NapcatQqMessageListQuery,
  type NapcatQqMessageListResponse,
} from "@sparkle/console-api/napcat-group-message";

export interface NapcatQqMessageQueryService {
  queryList(query: NapcatQqMessageListQuery): Promise<NapcatQqMessageListResponse>;
}
