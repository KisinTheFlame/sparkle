import { AppLogger } from "./logger.js";
import {
  getLoggerRuntime,
  getTraceContext,
  initLoggerRuntime,
  withTraceContext,
} from "./runtime.js";
import { serializeError, serializeMetadata } from "./serializer.js";
import { StdoutLogSink } from "./sinks/stdout-sink.js";
import { DbLogSink } from "./sinks/db-sink.js";
import { LOG_LEVELS } from "./types.js";
import type { LogEvent, LogLevel, LogMetadata, LogSink } from "./types.js";
import type {
  AppLogItem,
  InsertAppLogItem,
  LogDao,
  QueryAppLogListFilterInput,
  QueryAppLogListPageInput,
} from "./dao/log.dao.js";

export {
  AppLogger,
  DbLogSink,
  getLoggerRuntime,
  getTraceContext,
  initLoggerRuntime,
  LOG_LEVELS,
  serializeError,
  serializeMetadata,
  StdoutLogSink,
  withTraceContext,
  type AppLogItem,
  type InsertAppLogItem,
  type LogDao,
  type LogEvent,
  type LogLevel,
  type LogMetadata,
  type LogSink,
  type QueryAppLogListFilterInput,
  type QueryAppLogListPageInput,
};
