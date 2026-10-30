/**
 * dsh-tool-policy：把“生产写动作必须由人批准”落成机制。
 *
 * 注册一个追加在 `tools/pre-execute` 瀑布末尾的监听器：命令文本 / 工具名命中规则时返回
 * `ask`（走 DSH 审批面板，`approval: never` 的会话下等同拒绝）或 `deny`（直接拦下）。
 * 未命中规则时调用 `next()`，不改变原有放行行为。
 */

import { compilePolicy, decide } from './policy.js';

export const name = 'dsh-tool-policy';
export const inject = ['tools'];

function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(message);
  } catch {
    // 日志不可用不能影响工具调用本身。
  }
}

/**
 * 生成 pre-execute 监听器。规则评估出现异常时按 `policy.onError` 处理：
 * `allow` 放行（默认，避免规则 bug 卡死日常操作），`deny` 拦截。
 * @param {ReturnType<typeof compilePolicy>} policy
 * @param {(message: string) => void} [report]
 */
export function createListener(policy, report = () => {}) {
  return async (exec, next) => {
    let decision;
    try {
      decision = decide(exec, policy);
    } catch (error) {
      report(`${name}: 规则评估失败（onError=${policy.onError}）：${error instanceof Error ? error.message : String(error)}`);
      if (policy.onError === 'deny') {
        return {
          kind: 'deny',
          reason: `${name} 内部错误，已阻止工具 "${exec?.name ?? '?'}" 的调用`,
        };
      }
      decision = null;
    }
    return decision ?? next();
  };
}

export function apply(ctx, config) {
  try {
    const policy = compilePolicy(config ?? {});
    for (const problem of policy.problems) warn(ctx, `${name}: 配置告警：${problem}`);
    const listener = createListener(policy, (message) => warn(ctx, message));
    ctx.effect(function* registerPolicyGate() {
      yield ctx.on('tools/pre-execute', listener);
    });
  } catch (error) {
    // 初始化失败只影响本插件：不注册规则，也不让 profile 加载失败。
    warn(ctx, `${name}: 初始化失败，未注册任何规则：${error instanceof Error ? error.message : String(error)}`);
  }
}
