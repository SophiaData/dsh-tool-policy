# Agent Note: 对齐 DSH 0.2.2-rc.1 的交付模式预设

Status: implemented — peer 与 standard 工具面已同步到 0.2.2-rc.1。

## Problem

Desktop 升到 DSH `0.2.2-rc.1` 后，「交付模式」表现异常。旧 peer `^0.2.1-rc.3` 对 0.2.2 预发布元组不满足；同时 `preset-delivery` 的工具面仍按旧 standard 拷贝，与官方 `standard.patch.yml` 在 `tool-fs`、`delegation`、`tool-plugin-manager` 上不一致。

## Decision

把 `peerDependencies` 扩成 `^0.2.1-rc.3 || ^0.2.2-rc.1`，并把交付预设中与 standard 重叠的插件配置对齐到当前官方标准面，只保留末尾 `tool-policy` 作为本模式独有门禁。发布 `0.1.1` 后重装 desktop bundle。

## Alternatives considered

- 仅靠版本豁免继续跑旧包：不能修复预设漂移，也不能证明 peer/API 兼容。
- 只升 peer、不改预设：fiber 能挂上，但交付会话仍缺 `applyPatch`/`modelDiscovery` 等标准能力。
- 重写整份预设而不是 diff 对齐：扩大变更面，不利于核对「标准面 + 门禁」这一边界。

## Acceptance criteria

交付预设与官方 standard 的重叠插件配置一致；只多 `tool-policy`。`node test/policy.test.mjs` 通过。desktop 安装 `0.1.1` 并重启后，新会话可选「交付模式」。

## Consequences

后续官方 standard 再变，仍需人工 diff 同步；本包不自动跟随。0.2.2 其它预发布标签仍不在 peer 内。
