import { execFileSync } from 'node:child_process';
import { cpSync, chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stageRoot = join(projectRoot, '.local-package');
const packageRoot = join(stageRoot, 'campus-demo-local');
const outputPath = join(projectRoot, 'campus-demo-local.zip');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npmCommand, ['run', 'build'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEEPSEEK_API_KEY: '' }
});

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(packageRoot, { recursive: true });
cpSync(join(projectRoot, 'dist'), join(packageRoot, 'dist'), { recursive: true });
for (const name of ['server.py', 'start.command', 'start.bat', '使用说明.txt']) {
  cpSync(join(projectRoot, 'local', name), join(packageRoot, name));
}
// Always distribute an empty template, even if a developer filled their local copy.
writeFileSync(join(packageRoot, 'config.json'), '{\n  "api_key": ""\n}\n', 'utf8');
chmodSync(join(packageRoot, 'start.command'), 0o755);

const crcTable = Array.from({ length: 256 }, (_, number) => {
  let value = number;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function makeZip(root, output) {
  const chunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const path of listFiles(root)) {
    const data = readFileSync(path);
    const compressed = deflateRawSync(data, { level: 9 });
    const name = Buffer.from(relative(root, path).replaceAll('\\', '/'), 'utf8');
    const checksum = crc32(data);
    const stats = statSync(path);
    const { time, day } = dosDateTime(stats.mtime);
    const mode = basename(path) === 'start.command' ? 0o100755 : 0o100644;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(day, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    chunks.push(localHeader, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += localHeader.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  const fileCount = centralChunks.length / 2;
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(fileCount, 8);
  end.writeUInt16LE(fileCount, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(output, Buffer.concat([...chunks, centralDirectory, end]));
}

makeZip(packageRoot, outputPath);
rmSync(stageRoot, { recursive: true, force: true });
console.log(`\n已生成 ${outputPath}`);
