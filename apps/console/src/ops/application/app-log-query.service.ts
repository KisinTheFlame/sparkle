import { type AppLogListQuery, type AppLogListResponse } from "@sparkle/console-api/app-log";

export interface AppLogQueryService {
  queryList(query: AppLogListQuery): Promise<AppLogListResponse>;
}
