/**
 * 把 dsh-tool-policy 装进 DSH profile：只做两处幂等的文本编辑，保留原有格式。
 * 用法：node scripts/profile-edit.mjs <profileDir> dep|bundle
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const profileDir = process.argv[2] ?? process.env.DSH_PROFILE_DIR;
const step = process.argv[3];
if (!profileDir) throw new Error('缺少 profile 目录：传参或设置 DSH_PROFILE_DIR');
if (step !== 'dep' && step !== 'bundle') throw new Error('第二参数必须是 dep 或 bundle');

const file = join(profileDir, 'package.json');
const text = readFileSync(file, 'utf8');

if (step === 'dep') {
  if (text.includes('"dsh-tool-policy"')) {
    console.log('dependency 已存在，跳过');
  } else {
    const anchor = '"dsh-mcp-skill-manager": "link:E:/dev-day/dsh-mcp-skill-manager"';
    if (!text.includes(anchor)) throw new Error('找不到 dependency 锚点（dsh-mcp-skill-manager 行）');
    writeFileSync(
      file,
      text.replace(anchor, `${anchor},\n    "dsh-tool-policy": "link:E:/dev-day/dsh-tool-policy"`),
      'utf8',
    );
    console.log('已写入 dependency');
  }
} else {
  const bundlesBlock = /"bundles"\s*:\s*\[([\s\S]*?)\]/.exec(text);
  if (bundlesBlock === null) throw new Error('找不到 dsh.profile.bundles');
  if (/"dsh-tool-policy"/.test(bundlesBlock[1])) {
    console.log('bundle 已存在，跳过');
  } else {
    const anchor = '        "ds-harness-remote"\n      ]';
    if (!text.includes(anchor)) throw new Error('找不到 bundles 末尾锚点（ds-harness-remote）');
    writeFileSync(
      file,
      text.replace(anchor, '        "ds-harness-remote",\n        "dsh-tool-policy"\n      ]'),
      'utf8',
    );
    console.log('已写入 bundle');
  }
}
