import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { projectRoot as root } from "../shared/paths.mjs";
const tool = path.join(
  root,
  ".local/media-tools/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe",
);
const filename = process.argv[2] ?? "sample.mp4";
if (!/^[a-z0-9-]+\.mp4$/.test(filename))
  throw new Error("A local fixture filename is required.");
const output = path.join(root, ".local/media", filename);
if (existsSync(output)) {
  console.log("Local demo video already exists; preserved.");
  process.exit(0);
}
if (!existsSync(tool))
  throw new Error(
    "Install the local fixture tool first: npm install --prefix .local/media-tools @ffmpeg-installer/win32-x64@4.1.0 --no-audit --no-fund",
  );
mkdirSync(path.dirname(output), { recursive: true });
const result = spawnSync(
  tool,
  [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x0f766e:s=960x540:r=24:d=20",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=stereo",
    "-t",
    "20",
    "-vf",
    "drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='DOROSNA':fontcolor=white:fontsize=62:x=(w-tw)/2:y=(h-th)/2-45,drawtext=fontfile='C\\:/Windows/Fonts/arial.ttf':text='LOCAL DEMO VIDEO':fontcolor=white:fontsize=28:x=(w-tw)/2:y=(h-th)/2+45",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    "-shortest",
    output,
  ],
  { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60_000 },
);
if (result.status !== 0) throw new Error("Demo video generation failed.");
console.log("Private 20-second local demo video created.");
