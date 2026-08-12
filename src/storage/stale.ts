import { toErrorShape } from "#92c6666f713d";

type LeaseAttemptRow = {
  attempt: number;
  max_attempts: number;
};

function shouldFailExpiredLeaseTask(row: LeaseAttemptRow): boolean {
  return Number(row.attempt || 0) >= Number(row.max_attempts || 1);
}

function createLeaseExpiredError() {
  return toErrorShape({
      message: "Task lease expired and was recovered",
      code: "TASK_LEASE_EXPIRED",
  });
}

export {
  createLeaseExpiredError,
  shouldFailExpiredLeaseTask,
};
