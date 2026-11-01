import type { ProcessJob, ProcessJobs } from '../core/process-jobs.ts';

/** Records job calls instead of touching a real Job Object, so a test that fakes a PTY never
 *  assigns (or terminates!) a pid that belongs to something on the machine. */
export interface RecordingProcessJobs extends ProcessJobs {
  readonly assignments: Array<{ key: string; pid: number }>;
  readonly terminated: string[];
}

export function recordingProcessJobs(): RecordingProcessJobs {
  const assignments: Array<{ key: string; pid: number }> = [];
  const terminated: string[] = [];
  return {
    supported: true,
    assignments,
    terminated,
    ready: () => Promise.resolve(true),
    job: (key): ProcessJob => ({
      assign: (pid) => {
        assignments.push({ key, pid });
        return Promise.resolve(true);
      },
      terminate: () => {
        terminated.push(key);
        return Promise.resolve(true);
      },
    }),
  };
}
