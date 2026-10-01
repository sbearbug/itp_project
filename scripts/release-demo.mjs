import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const homebrewJdk21 = '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home';
const releaseEnvironment = { ...process.env };

// This closed Android demo intentionally embeds its configured GLM demo key.
// The unrelated DeepSeek key must never be copied into the release artifact.
releaseEnvironment.VITE_DEEPSEEK_API_KEY = '';

if (existsSync(homebrewJdk21)) {
  releaseEnvironment.JAVA_HOME = homebrewJdk21;
}

console.log('\n[1/2] 构建 Android APK（主产物）');
execFileSync(npmCommand, ['run', 'apk'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: releaseEnvironment
});

const builtApk = join(projectRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const releaseApk = join(projectRoot, 'campus-demo-android.apk');
const officialApk = join(projectRoot, 'schedule-official-v1.apk');
if (!existsSync(builtApk)) throw new Error('构建完成但未找到 app-debug.apk');
copyFileSync(builtApk, releaseApk);
copyFileSync(builtApk, officialApk);

console.log('\n[2/2] 构建本地网页 ZIP（辅助产物）');
execFileSync(npmCommand, ['run', 'package:local'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: releaseEnvironment
});

console.log('\n发布产物已同步更新：');
console.log('  主产物  ' + releaseApk);
console.log('  正式文件  ' + officialApk);
console.log('  辅助包  ' + join(projectRoot, 'campus-demo-local.zip'));
