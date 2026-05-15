import { spawn } from "child_process";
import { copyFileSync, existsSync, renameSync, unlinkSync } from "fs";
import { resolve } from "path";

const BSQLITE3_PATH = resolve("node_modules/better-sqlite3/build/Release/better_sqlite3.node");
const BSQLITE3_LINUX_BAK = resolve("node_modules/better-sqlite3/build/Release/better_sqlite3.node.linux.bak");
const BSQLITE3_WIN = resolve("assets/native-prebuilds/win32-x64/build/Release/better_sqlite3.node");

async function run(cmd: string, args: string[] = []) {
  return new Promise<void>((res, rej) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("close", (code) => {
      if (code === 0) res();
      else rej(new Error(`Process exited with code ${code}`));
    });
  });
}

async function main() {
  // 1. Backup Linux native module
  if (!existsSync(BSQLITE3_WIN)) {
    console.error("Windows prebuilt binary not found:", BSQLITE3_WIN);
    console.error("Run: npx prebuild-install --runtime electron --target 41.3.0 --platform win32 --arch x64 --path node_modules/better-sqlite3");
    process.exit(1);
  }

  console.log("[dist-win] Backing up Linux better_sqlite3.node...");
  copyFileSync(BSQLITE3_PATH, BSQLITE3_LINUX_BAK);

  // 2. Replace with Windows native module
  console.log("[dist-win] Replacing with Windows better_sqlite3.node...");
  copyFileSync(BSQLITE3_WIN, BSQLITE3_PATH);

  try {
    // 3. Build & Pack
    console.log("[dist-win] Running build...");
    await run("bun", ["run", "build"]);
    console.log("[dist-win] Running electron-builder --win...");
    await run("npx", ["electron-builder", "--win"]);
  } finally {
    // 4. Restore Linux native module
    console.log("[dist-win] Restoring Linux better_sqlite3.node...");
    renameSync(BSQLITE3_LINUX_BAK, BSQLITE3_PATH);
  }

  console.log("[dist-win] Done!");
}

main().catch((err) => {
  console.error(err);
  // Attempt restore on error
  if (existsSync(BSQLITE3_LINUX_BAK)) {
    renameSync(BSQLITE3_LINUX_BAK, BSQLITE3_PATH);
    console.log("[dist-win] Restored Linux better_sqlite3.node after error.");
  }
  process.exit(1);
});
