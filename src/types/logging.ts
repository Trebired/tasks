import type {
  LoggerAdapterEvent,
  LoggerAdapterGenericLogMethod,
  LoggerAdapterLogger,
  LoggerAdapterLogMethod,
  LoggerAdapterWriter,
  NormalizedLoggerAdapter,
} from "@trebired/logger-adapter";

export type TaskLogMethod = LoggerAdapterLogMethod;
export type TaskLogEvent = LoggerAdapterEvent;
export type TaskGenericLogMethod = LoggerAdapterGenericLogMethod;
export type TaskLogger = LoggerAdapterLogger;
export type TaskLoggerAdapter = LoggerAdapterWriter;
export type NormalizedTaskLogger = NormalizedLoggerAdapter;
