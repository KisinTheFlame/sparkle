import { type TodoListQuery, type TodoListResponse } from "@sparkle/console-api/todo";

export interface TodoQueryService {
  queryList(query: TodoListQuery): Promise<TodoListResponse>;
}
