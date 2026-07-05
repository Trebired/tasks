import type { TaskHandlerModule } from "./types.js";

function defineTaskHandler<TInput = unknown, TResult = unknown>(
  handler: TaskHandlerModule<TInput, TResult>,
): TaskHandlerModule<TInput, TResult> {
  return handler;
}

export {
  defineTaskHandler,
};
