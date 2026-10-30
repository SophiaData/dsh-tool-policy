/**
 * dsh-tool-policy 的单元测试：只测纯决策逻辑与监听器契约，不加载 DSH 运行时。
 * 运行：node --test test/policy.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePolicy, collectText, decide, patternToRegExp } from '../policy.js';
import { createListener, apply } from '../index.js';

const config = {
  onError: 'allow',
  rules: [
    {
      id: 'data-mcp-write',
      tools: ['mcp__data-mcp__execute_ddl', 'mcp__data-mcp__update_script_file', 'mcp__data-mcp__update_cookie'],
      action: 'deny',
      reason: '生产 DDL / 节点写操作需用户手工执行',
    },
    {
      id: 'odps-write',
      tools: ['mcp__maxcompute-direct__*', 'mcp__maxcompute-mcp__*'],
      pattern: 'insert_values|create_table|update_table',
      action: 'deny',
    },
    {
      id: 'publish-commands',
      tools: ['pwsh', 'bash', 'terminal_send', 'run_code'],
      pattern: 'publish|deploy|updateVertex|updateNode|updateScriptFile|backfill|发布|回填',
      action: 'ask',
    },
  ],
};

const policy = compilePolicy(config);

function execOf(name, args) {
  return { name, arguments: args, callId: 'call-1' };
}

const allow = { kind: 'allow' };

test('未命中规则时不改变放行行为（调用 next）', async () => {
  let called = 0;
  const listener = createListener(policy);
  const result = await listener(execOf('pwsh', { command: 'Get-ChildItem' }), async () => {
    called += 1;
    return allow;
  });
  assert.equal(called, 1);
  assert.deepEqual(result, allow);
});

test('未命中的 MCP 工具放行', async () => {
  const listener = createListener(policy);
  const result = await listener(execOf('mcp__data-mcp__get_table_ddl', {}), async () => allow);
  assert.deepEqual(result, allow);
});

test('data-mcp 写工具被 deny，且不调用 next', async () => {
  let called = 0;
  const listener = createListener(policy);
  const result = await listener(execOf('mcp__data-mcp__execute_ddl', { ddl_sql: 'ALTER TABLE x ADD COLUMNS(y INT)' }), async () => {
    called += 1;
    return allow;
  });
  assert.equal(called, 0);
  assert.equal(result.kind, 'deny');
  assert.match(result.reason, /execute_ddl/);
  assert.match(result.reason, /不要重试/);
});

test('通配工具模式 + 参数正则：只拦写工具，不拦读工具', () => {
  assert.equal(decide(execOf('mcp__maxcompute-direct__insert_values', { values: [[1]] }), policy).kind, 'deny');
  assert.equal(decide(execOf('mcp__maxcompute-direct__get_table_schema', { table: 't' }), policy), null);
});

test('参数里没有命令字段时，正则退回匹配参数 JSON', () => {
  assert.equal(decide(execOf('run_code', { body: 'await publish()' }), policy).kind, 'ask');
  assert.equal(decide(execOf('run_code', { body: 'console.log(1)' }), policy), null);
});

test('发布类命令返回 ask 并带中英文 displayReason', () => {
  const decision = decide(execOf('pwsh', { command: 'node scripts/publish-nodes.js' }), policy);
  assert.equal(decision.kind, 'ask');
  assert.match(decision.reason, /requires user approval/);
  assert.equal(typeof decision.displayReason.en, 'string');
  assert.equal(typeof decision.displayReason.zh, 'string');
});

test('普通命令不触发发布规则', () => {
  assert.equal(decide(execOf('pwsh', { command: 'git status' }), policy), null);
});

test('中文关键词与 run_code 的 code 字段也生效', () => {
  assert.equal(decide(execOf('pwsh', { command: 'echo 发布节点' }), policy).kind, 'ask');
  assert.equal(decide(execOf('run_code', { code: 'await tools.mcp__data_mcp__publish({})' }), policy).kind, 'ask');
});

test('patternToRegExp 支持通配且不把正则特殊字符当通配', () => {
  assert.ok(patternToRegExp('mcp__maxcompute-direct__*').test('mcp__maxcompute-direct__insert_values'));
  assert.ok(!patternToRegExp('mcp__maxcompute-direct__*').test('mcp__maxcompute-mcp__insert_values'));
  assert.ok(!patternToRegExp('pwsh').test('pwsh2'));
});

test('collectText 只读取已知字段', () => {
  assert.equal(collectText({ command: 'a', text: 'b', code: 'c', other: 'd' }), 'a\nb\nc');
  assert.equal(collectText({ command: 123 }), '');
  assert.equal(collectText(null), '');
});

test('非法规则只记入 problems，插件仍可加载', () => {
  const broken = compilePolicy({
    rules: [
      { tools: ['pwsh'], action: 'nope' },
      { tools: [], action: 'deny' },
      { tools: ['pwsh'], pattern: '(', action: 'deny' },
      { tools: ['pwsh'], action: 'ask' },
      42,
    ],
  });
  assert.equal(broken.rules.length, 1);
  assert.equal(broken.problems.length, 4);
  assert.equal(broken.onError, 'allow');
});

test('规则评估抛错时按 onError 处理', async () => {
  const throwing = {
    rules: [
      {
        get toolRes() {
          throw new Error('boom');
        },
        action: 'deny',
        regex: null,
      },
    ],
    onError: 'deny',
  };
  const report = [];
  const listener = createListener(throwing, (message) => report.push(message));
  const result = await listener(execOf('pwsh', { command: 'x' }), async () => allow);
  assert.equal(result.kind, 'deny');
  assert.equal(report.length, 1);
});

test('apply 在假 ctx 上注册监听器，且初始化失败不抛错', async () => {
  const listeners = [];
  const warnings = [];
  const fakeCtx = {
    on(event, listener) {
      listeners.push({ event, listener });
      return () => {};
    },
    effect(callback) {
      const iterator = callback();
      iterator.next();
    },
    logger: { warn: (message) => warnings.push(message) },
  };
  apply(fakeCtx, config);
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].event, 'tools/pre-execute');

  const blocked = await listeners[0].listener(execOf('mcp__data-mcp__execute_ddl', { ddl_sql: 'X' }), async () => allow);
  assert.equal(blocked.kind, 'deny');

  // 初始化的内部错误被吞掉：不抛、不注册。
  const brokenCtx = {
    on() {
      throw new Error('registration failed');
    },
    effect(callback) {
      const iterator = callback();
      iterator.next();
    },
    logger: { warn: (message) => warnings.push(message) },
  };
  assert.doesNotThrow(() => apply(brokenCtx, config));
});
