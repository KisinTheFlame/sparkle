import {
  type NapcatEventListQuery,
  type NapcatEventListResponse,
} from "@sparkle/console-api/napcat-event";

export interface NapcatEventQueryService {
  queryList(query: NapcatEventListQuery): Promise<NapcatEventListResponse>;
}
