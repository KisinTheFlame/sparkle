export type MetricTags = Record<string, string | number>;

export type RecordMetricInput = {
  metricName: string;
  value: number;
  tags?: MetricTags;
  occurredAt?: Date;
};

/**
 * 指标上报端口。llm-client 只依赖这个最小契约；完整的 metric 模块（落库 / 图表）
 * 留待二期，届时提供实现注入即可。
 */
export interface MetricService {
  record(input: RecordMetricInput): Promise<void>;
}

/** 默认空实现：不接 metric 模块时，指标调用安全地 no-op。 */
export class NoopMetricService implements MetricService {
  public async record(_input: RecordMetricInput): Promise<void> {
    // intentionally empty
  }
}
