// Development: API on :4321 and Vite with hot reload on :5173 (proxying /api and /uploads).
import { spawn } from 'node:child_process';

const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
const api = run('node', ['--watch', 'server/src/index.js']);
const web = run('npx', ['vite']);
const stop = () => { api.kill(); web.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
