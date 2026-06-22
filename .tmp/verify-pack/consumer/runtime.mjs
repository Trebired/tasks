import { createTaskHost, taskChannel } from "@trebired/tasks";

console.log(typeof createTaskHost, taskChannel.kind("demo.kind"));