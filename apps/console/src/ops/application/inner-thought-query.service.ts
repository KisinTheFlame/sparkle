import {
  type InnerThoughtListQuery,
  type InnerThoughtListResponse,
} from "@sparkle/console-api/inner-thought";

export interface InnerThoughtQueryService {
  queryList(query: InnerThoughtListQuery): Promise<InnerThoughtListResponse>;
}
