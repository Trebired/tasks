import { createTaskHost, taskChannel } from "@trebired/tasks";

const channel = taskChannel.kind("demo.kind");
const host = createTaskHost;

console.log(Boolean(host), channel);