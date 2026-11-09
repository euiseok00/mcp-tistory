// 웹 스토어 제출용 zip 생성: manifest.json 생성 후 필요한 파일만 묶는다.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

execFileSync("node", ["--env-file=.env", "extension/configure.mjs"], { stdio: "inherit" });
mkdirSync("dist", { recursive: true });
// Windows 10+ 내장 bsdtar는 -a로 zip을 만든다. PATH의 tar(Git Bash의 GNU tar)는 zip을 못 만들어 경로를 지정한다
execFileSync(
  process.platform === "win32" ? `${process.env.SystemRoot}/System32/tar.exe` : "tar",
  ["-a", "-c", "-f", "dist/extension.zip", "-C", "extension", "manifest.json", "background.js", "classify.js", "content.js", "icons"],
  { stdio: "inherit" },
);
console.log("dist/extension.zip");
