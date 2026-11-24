#!/usr/bin/env python3
"""JEE NEXUS — persistent dev-server daemonizer.

The sandbox kills anything still attached to the tool shell's process group
(and `bun run dev` pipes through `tee`, which breaks on shell exit). This
replicates what pg_ctl does for Postgres: double-fork + setsid + stdio
straight into a log file, so the Next.js dev server survives tool calls.

Usage:
  python3 scripts/serve.py start    # ensure dev server on :3000 (idempotent)
  python3 scripts/serve.py status   # report up/down
  python3 scripts/serve.py stop
"""
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path("/home/z/my-project")
LOG = "/tmp/jn_dev.log"
PIDFILE = Path("/tmp/jn_dev.pid")
DB_URL = "postgresql://jee_app:jee_app_local@127.0.0.1:54329/jee_nexus"
PORT = 3000


def is_up() -> bool:
    s = socket.socket()
    s.settimeout(1.5)
    try:
        s.connect(("127.0.0.1", PORT))
        return True
    except OSError:
        return False
    finally:
        s.close()


def stop() -> None:
    if PIDFILE.exists():
        try:
            os.kill(int(PIDFILE.read_text().strip()), signal.SIGTERM)
        except (OSError, ValueError):
            pass
        PIDFILE.unlink(missing_ok=True)
    subprocess.run(["pkill", "-f", "next dev -p 3000"],
                   capture_output=True)


def start() -> int:
    if is_up():
        print("ALREADY_RUNNING http://localhost:3000")
        return 0

    # make sure Postgres is up first (dev server needs it)
    subprocess.run([sys.executable, str(ROOT / "scripts/pg_ensure.py")],
                   capture_output=True, check=False)

    pid = os.fork()
    if pid == 0:  # first child
        os.setsid()
        if os.fork() == 0:  # daemon (grandchild)
            with open(LOG, "ab", 0) as f:
                os.dup2(f.fileno(), 1)
                os.dup2(f.fileno(), 2)
            devnull = os.open(os.devnull, os.O_RDONLY)
            os.dup2(devnull, 0)
            os.chdir(str(ROOT))
            os.environ["DATABASE_URL"] = DB_URL
            os.execvp(str(ROOT / "node_modules/.bin/next"),
                      ["next", "dev", "-p", str(PORT)])
        os._exit(0)
    os.waitpid(pid, 0)

    for _ in range(45):  # up to ~90s (first compile can be slow)
        if is_up():
            # record daemon pid (pgrep the listening next process)
            r = subprocess.run(["pgrep", "-f", "next-server|next dev"],
                               capture_output=True, text=True)
            pids = r.stdout.split()
            if pids:
                PIDFILE.write_text(pids[-1])
            print(f"STARTED http://localhost:3000 (log {LOG})")
            return 0
        time.sleep(2)
    print(f"FAILED to start; log tail:")
    print(Path(LOG).read_text()[-2000:] if Path(LOG).exists() else "(none)")
    return 1


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "start"
    sys.exit({"start": start, "stop": stop,
              "status": lambda: print("UP" if is_up() else "DOWN") or 0}[cmd]())
