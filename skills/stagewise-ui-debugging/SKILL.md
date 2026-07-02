---
name: stagewise-ui-debugging
description: 仅在用户显式调用 $stagewise-ui-debugging 或明确要求使用 stagewise-ui-debugging 技能时使用；不要通过关键词、任务类型或上下文自动触发。
---

# Stagewise UI 调试

## 概览

用于对齐 `design/ui_kits/app/` 设计稿和 `apps/front` 前端页面。核心原则：改 UI 前先在相同视口下，对比 Stagewise 包装后的设计站和前端站。

## 速查

| 目标 | 用户可能需要手动运行 | 访问地址 |
| --- | --- | --- |
| 设计稿 | `dx start stagewise-design-system` | `http://localhost:8766/ui_kits/app/` |
| 前端页面 | `dx start stack-front` | `http://localhost:3002` |

`stagewise-design-system` 会用 Stagewise 包装设计静态站，桥接 `8765 -> 8766`。`stack-front` 会启动 PM2 交互式服务栈和 `stagewise-front`，桥接 `3001 -> 3002`。

## 流程

1. 使用浏览器前，提醒用户这两个服务可能已经启动；如果没启动，可以手动运行：
   ```bash
   dx start stagewise-design-system
   dx start stack-front
   ```
2. 用浏览器工具访问两个 Stagewise 地址。若页面打不开、空白、或无法渲染，提示用户对应服务可能没启动或状态异常，让用户手动处理后再访问。
3. 在相同浏览器视口下对比设计稿和前端。桌面和移动端宽度都要看；视口不同会造成假的对齐差异。
4. 检查 DOM 时记住：两个页面都经过 Stagewise 包装。包装节点、桥接覆盖层、注入属性可能和裸应用 DOM 不同。优先做视觉对比和稳定的应用层选择器检查；编辑前先确认样式来自产品 UI，而不是 Stagewise 外壳。
5. 修改后端或前端页面后，页面会自动刷新到最新状态。需要确认时重新查看或刷新浏览器对比，不要先急着重启服务。
6. 如果任务涉及真实 UI 实现，以仓库设计规则为准：`design/readme.md`、`design/SKILL.md`、`ruler/design-system.md`。

## 触发示例

用户说：“调一下前端和设计稿的卡片间距。”

动作：加载本技能，提醒用户两个 `dx start` 命令，打开 `8766/ui_kits/app/` 和 `3002`，设置相同桌面和移动端视口，视觉对比后再按需要修改前端或设计源。

## 常见误区

| 常见问题 | 处理方式 |
| --- | --- |
| 用 `localhost:3001` 和设计稿对比，而不是 Stagewise 的 `3002` | 使用包装后的地址，让前端和设计稿处在同一种调试表面。 |
| 把空白页直接当成 UI bug | 先确认对应 `dx start ...` 服务正在运行且健康。 |
| 用不同视口宽度对比 | 设计稿和前端设置相同视口，并补充移动端检查。 |
| 根据 Stagewise 包装 DOM 直接改样式 | 确认选中的节点或样式属于产品 UI，不是 Stagewise 外壳。 |
| 每次页面改动后立刻手动重启 | 先看自动刷新或热更新后的浏览器结果，再决定是否需要重启。 |
