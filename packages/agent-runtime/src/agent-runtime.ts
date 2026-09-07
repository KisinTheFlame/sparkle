export interface TaskAgent<TInput, TOutput> {
  invoke(input: TInput, options?: { signal?: AbortSignal }): Promise<TOutput>;
}
