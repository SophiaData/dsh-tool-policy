/**
 * dsh-tool-policy 的纯决策逻辑，不依赖 DSH 运行时，可直接单测。
 *
 * 一次工具调用由 index.js 的 `tools/pre-execute` 监听器交给 `decide()`：
 * 返回 `null` 表示放行，返回 `{ kind: 'ask' | 'deny', ... }` 表示需要审批 / 直接拦截。
 */

/** 工具参数里可能承载命令文本的字段；命中任一非空字符串即视为“命令文本”。 */
const TEXT_FIELDS = Object.freeze(['command', 'text', 'code', 'script']);

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

const DEFAULT_EN = (toolName) => `dsh-tool-policy requires your approval for tool "${toolName}".`;
const DEFAULT_ZH = (toolName) => `dsh-tool-policy：工具 "${toolName}" 需要你批准。`;

/**
 * 把带 `*` 通配的字符串模式编译成整串匹配的正则。
 * 例：`mcp__maxcompute-direct__*` 只匹配该前缀的完整工具名。
 * @param {string} pattern
 * @returns {RegExp}
 */
export function patternToRegExp(pattern) {
  const escaped = String(pattern).replace(REGEXP_SPECIAL, '\\$&');
  const source = escaped.replace(/\\\*/g, '.*');
  return new RegExp(`^${source}$`);
}

/**
 * 抽取一次调用里用于正则匹配的命令文本，只取已知字段。
 * @param {unknown} args
 * @returns {string}
 */
export function collectText(args) {
  if (args === null || typeof args !== 'object') return '';
  const parts = [];
  for (const field of TEXT_FIELDS) {
    const value = args[field];
    if (typeof value === 'string' && value.length > 0) parts.push(value);
  }
  return parts.join('\n');
}

/**
 * 命令文本为空时的兜底：序列化参数。只在工具名没命中正则时才用到，避免大参数无谓开销。
 * @param {unknown} args
 * @returns {string}
 */
export function fallbackText(args) {
  if (args === undefined || args === null) return '';
  try {
    return JSON.stringify(args) ?? '';
  } catch {
    return '';
  }
}

/**
 * 正则的匹配对象：先匹配工具名，未命中再匹配命令文本（含参数 JSON 兜底）。
 * @param {{ name: string, arguments?: unknown }} exec
 * @param {RegExp} regex
 * @returns {boolean}
 */
export function matchesSubject(exec, regex) {
  if (regex.test(exec.name)) return true;
  const command = collectText(exec.arguments);
  return regex.test(command.length > 0 ? command : fallbackText(exec.arguments));
}

/**
 * 展示文案必须给 `en`（`dsh-tools` 的 `displayReason` 契约要求），`zh` 可选。
 * 配置缺 `en` 时用默认英文兜底，保证决策形状合法。
 */
function normalizeDisplayReason(raw) {
  if (raw === null || typeof raw !== 'object') return null;
  const en = typeof raw.en === 'string' && raw.en.length > 0 ? raw.en : null;
  const zh = typeof raw.zh === 'string' && raw.zh.length > 0 ? raw.zh : null;
  if (en === null && zh === null) return null;
  return {
    ...(en === null ? {} : { en }),
    ...(zh === null ? {} : { zh }),
  };
}

/**
 * 把插件配置编译成可复用的规则表。非法规则只记入 `problems`，不会让插件加载失败。
 * @param {object} [config]
 * @returns {{ rules: object[], onError: 'allow' | 'deny', problems: string[] }}
 */
export function compilePolicy(config = {}) {
  const source = config !== null && typeof config === 'object' ? config : {};
  const problems = [];

  if (source.onError !== undefined && source.onError !== 'allow' && source.onError !== 'deny') {
    problems.push(`onError 只能是 "allow" 或 "deny"，已按 "allow" 处理`);
  }
  const onError = source.onError === 'deny' ? 'deny' : 'allow';

  const rules = [];
  if (source.rules !== undefined && !Array.isArray(source.rules)) {
    problems.push('rules 必须是数组；本插件未加载任何规则');
    return { rules, onError, problems };
  }
  const rawRules = Array.isArray(source.rules) ? source.rules : [];

  rawRules.forEach((raw, index) => {
    const where = `rules[${index}]`;
    if (raw === null || typeof raw !== 'object') {
      problems.push(`${where} 不是对象`);
      return;
    }
    if (raw.disabled === true) return;

    const action = raw.action === 'deny' ? 'deny' : raw.action === 'ask' ? 'ask' : null;
    if (action === null) {
      problems.push(`${where}.action 必须是 "ask" 或 "deny"`);
      return;
    }

    const toolPatterns = (Array.isArray(raw.tools) ? raw.tools : []).filter(
      (value) => typeof value === 'string' && value.length > 0,
    );
    if (toolPatterns.length === 0) {
      problems.push(`${where}.tools 至少要有一个工具名或通配模式`);
      return;
    }

    let regex = null;
    if (raw.pattern !== undefined) {
      if (typeof raw.pattern !== 'string' || raw.pattern.length === 0) {
        problems.push(`${where}.pattern 必须是非空字符串`);
        return;
      }
      const flags = raw.flags === undefined ? 'i' : String(raw.flags);
      // g / y 会让 RegExp.test 携带 lastIndex，跨调用交替命中；安全规则不允许静默失效。
      if (/[gy]/.test(flags)) {
        problems.push(`${where}.flags 含状态标志 g/y，已移除`);
      }
      try {
        regex = new RegExp(raw.pattern, flags.replace(/[gy]/g, ''));
      } catch (error) {
        problems.push(`${where}.pattern 不是合法正则：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    rules.push({
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `rule-${index}`,
      action,
      toolRes: toolPatterns.map(patternToRegExp),
      regex,
      reason: typeof raw.reason === 'string' && raw.reason.length > 0 ? raw.reason : null,
      displayReason: normalizeDisplayReason(raw.displayReason),
    });
  });

  return { rules, onError, problems };
}

function denyDecision(rule, toolName) {
  const detail = rule.reason ?? '该操作会改动生产状态，必须由用户手动执行';
  return {
    kind: 'deny',
    reason: `dsh-tool-policy 阻止了工具 "${toolName}"：${detail}。调用未执行；不要重试，需要执行时请让用户手动运行。`,
  };
}

function askDecision(rule, toolName) {
  const detail = rule.reason ?? '该命令会触发发布 / 部署 / 回填等生产写操作';
  const configured = rule.displayReason ?? {};
  return {
    kind: 'ask',
    reason: `dsh-tool-policy requires user approval for tool "${toolName}": ${detail}`,
    displayReason: {
      en: configured.en ?? DEFAULT_EN(toolName),
      zh: configured.zh ?? DEFAULT_ZH(toolName),
    },
  };
}

/**
 * 按规则表裁定一次调用；未命中任何规则返回 `null`（放行）。
 * @param {{ name?: unknown, arguments?: unknown }} exec
 * @param {ReturnType<typeof compilePolicy>} policy
 * @returns {null | { kind: 'ask' | 'deny', reason: string, displayReason?: object }}
 */
export function decide(exec, policy) {
  if (exec === null || typeof exec !== 'object' || typeof exec.name !== 'string') return null;

  for (const rule of policy.rules) {
    if (!rule.toolRes.some((re) => re.test(exec.name))) continue;
    if (rule.regex !== null && !matchesSubject(exec, rule.regex)) continue;
    return rule.action === 'deny' ? denyDecision(rule, exec.name) : askDecision(rule, exec.name);
  }
  return null;
}
