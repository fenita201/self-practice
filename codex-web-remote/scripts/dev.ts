import { spawn } from "node:child_process";
const children = [
  spawn("npx", ["tsx", "watch", "src/server/main.ts"], { stdio: "inherit" }),
  spawn("npx", ["vite"], { stdio: "inherit" }),
];
const stop = () => {
  for (const c of children) c.kill("SIGTERM");
};
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, stop);
for (const c of children) c.on("exit", stop);
