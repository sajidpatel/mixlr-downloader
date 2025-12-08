import { spawn } from 'child_process';

class ProcessAdapter {
  constructor({ logger = console, defaultTimeoutMs = 15 * 60 * 1000, retryDelayMs = 1000 } = {}) {
    this.logger = logger;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.retryDelayMs = retryDelayMs;
  }

  log(event, payload = {}) {
    if (this.logger?.info) {
      this.logger.info({ event, ...payload });
    } else {
      // Keep logs terse but structured.
      console.log(JSON.stringify({ event, ...payload }));
    }
  }

  spawnProcess({
    name,
    cmd,
    args = [],
    stdio = 'pipe',
    env,
    cwd,
    timeoutMs = this.defaultTimeoutMs,
    onStdout,
    onStderr,
    onExit,
  }) {
    const startedAt = Date.now();
    this.log('process:start', { name, cmd, args, timeoutMs });
    const child = spawn(cmd, args, { stdio, env, cwd });

    const timer = typeof timeoutMs === 'number'
      ? setTimeout(() => {
          this.log('process:timeout', { name, timeoutMs });
          try {
            child.kill('SIGKILL');
          } catch {}
        }, timeoutMs)
      : null;

    if (child.stdout && onStdout) {
      child.stdout.on('data', onStdout);
    }
    if (child.stderr && onStderr) {
      child.stderr.on('data', onStderr);
    }

    child.on('error', (err) => {
      this.log('process:error', { name, message: err.message });
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      const durationMs = Date.now() - startedAt;
      this.log('process:exit', { name, code, signal, durationMs });
      onExit?.({ code, signal, durationMs });
    });

    return child;
  }

  runProcess({
    name,
    cmd,
    args = [],
    stdio = 'ignore',
    env,
    cwd,
    timeoutMs = this.defaultTimeoutMs,
    retries = 0,
    retryDelayMs = this.retryDelayMs,
    onStdout,
    onStderr,
  }) {
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const runAttempt = () => {
        attempt += 1;
        let settled = false;

        const child = this.spawnProcess({
          name: `${name || cmd}:attempt-${attempt}`,
          cmd,
          args,
          stdio,
          env,
          cwd,
          timeoutMs,
          onStdout,
          onStderr,
          onExit: ({ code, signal, durationMs }) => {
            if (settled) return;
            if (code === 0) {
              settled = true;
              resolve({ code, signal, attempt, durationMs });
            } else if (attempt <= retries) {
              setTimeout(runAttempt, retryDelayMs);
            } else {
              settled = true;
              reject(new Error(`${cmd} failed after ${attempt} attempt(s); last code=${code}, signal=${signal}`));
            }
          },
        });

        child.on('error', (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        });
      };

      runAttempt();
    });
  }
}

const defaultAdapter = new ProcessAdapter();

export { ProcessAdapter };
export default defaultAdapter;
