// Spawns a detached grandchild once told to, records both pids, then lingers like a real CLI
// would. The grandchild is the C-05 orphan: detached, re-parented, invisible to a pid walk — the
// only thing that still connects it to onni is the Job Object its parent was assigned to.
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const [holder, pidFile, goFile] = process.argv.slice(2);

const start = () => {
  if (!fs.existsSync(goFile)) return setTimeout(start, 20);
  const child = spawn(process.execPath, [holder], { detached: true, stdio: 'ignore' });
  child.unref();
  fs.writeFileSync(pidFile, JSON.stringify({ parent: process.pid, child: child.pid }));
  setInterval(() => {}, 1000);
};

start();
