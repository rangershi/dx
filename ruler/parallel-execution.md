# 并行执行

## 核心规则

- 默认并行：无数据依赖的工具调用必须并行发起（Read/Grep/Glob/Bash/Task 等同理）
- 仅在有依赖时串行：B 需要 A 的结果来决定参数/路径/是否执行，才允许等待
- Bash 串行链：有依赖的命令用 `&&`；无依赖的命令分开并行

## 例子

无依赖：并行

```text
- Read a.ts
- Read b.ts
- Grep "foo" (include="*.ts")
```

有依赖：串行

```bash
git add . && git commit -F - <<'MSG'
chore: update docs

Refs: #123
MSG
```
