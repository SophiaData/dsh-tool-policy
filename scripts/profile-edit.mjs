/**
 * 把 dsh-tool-policy 装进 DSH profile：只做两处幂等的文本编辑，保留原有格式。
 * 用法：node scripts/profile-edit.mjs <profileDir> dep|bundle
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const profileDir = process.argv[2] ?? process.env.DSH_PROFILE_DIR;
const step = process.argv[3];
if (!profileDir) throw new Error('缺少 profile 目录：传参或设置 DSH_PROFILE_DIR');
if (step !== 'dep' && step !== 'bundle') throw new Error('第二参数必须是 dep 或 bundle');

const file = join(profileDir, 'package.json');
const text = readFileSync(file, 'utf8');

/** 先写临时文件再改名，避免中途失败留下半截 profile。 */
function writeAtomic(target, content) {
  const temp = `${target}.tmp-${process.pid}`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);
}

function dependenciesBlock(source) {
  const match = /"dependencies"\s*:\s*\{([\s\S]*?)\}/.exec(source);
  if (match === null) throw new Error('找不到 dependencies 块');
  return match[1];
}

function bundlesBlock(source) {
  const match = /"bundles"\s*:\s*\[([\s\S]*?)\]/.exec(source);
  if (match === null) throw new Error('找不到 dsh.profile.bundles');
  return match[1];
}

if (step === 'dep') {
  if (/"dsh-tool-policy"\s*:/.test(dependenciesBlock(text))) {
    console.log('dependency 已存在，跳过');
  } else {
    const anchor = '"dsh-mcp-skill-manager": "link:E:/dev-day/dsh-mcp-skill-manager"';
    if (!text.includes(anchor)) throw new Error('找不到 dependency 锚点（dsh-mcp-skill-manager 行）');
    writeAtomic(
      file,
      text.replace(anchor, `${anchor},\n    "dsh-tool-policy": "link:E:/dev-day/dsh-tool-policy"`),
    );
    console.log('已写入 dependency');
  }
} else {
  if (!/"dsh-tool-policy"\s*:/.test(dependenciesBlock(text))) {
    throw new Error('dependencies 里没有 dsh-tool-policy，先执行 dep 步骤');
  }
  if (/"dsh-tool-policy"/.test(bundlesBlock(text))) {
    console.log('bundle 已存在，跳过');
  } else {
    const anchor = '        "ds-harness-remote"\n      ]';
    if (!text.includes(anchor)) throw new Error('找不到 bundles 末尾锚点（ds-harness-remote）');
    writeAtomic(
      file,
      text.replace(anchor, '        "ds-harness-remote",\n        "dsh-tool-policy"\n      ]'),
    );
    console.log('已写入 bundle');
  }
}
