# 后端制品部署检查清单

## 一、改造前采样

1. 查找构建后是否存在软链回源码依赖：

```bash
rg -n "ln -sfn.*node_modules|node_modules.*ln -sfn" <backend-package-json-path>
```

2. 查找环境加载入口：

```bash
rg -n "dotenv -e|dotenv --override|ConfigModule.forRoot|loadEnvironment|env-layers" -S <repo-root>
```

3. 查找启动命令：

```bash
rg -n "start:prod|pm2|node .*main" -S <repo-root>
```

## 二、打包脚本最低要求

1. 接收 `--env`、`--version`、`--time`。
2. 制品名包含版本与时间片。
3. 打入 `.env.<env>` 与 `.env.<env>.local`。
4. 不打入 `node_modules`（轻制品模式）。

## 三、发布脚本最低要求

1. 解压到 `releases/<version>` 并切换 `current`。
2. 支持 `pm2` 与 `direct` 两种启动方式。
3. 在 install、migrate、start 三阶段都用同一套双层 env 加载顺序。
4. 支持 `--env-file` 与 `--env-local-file` 覆盖路径。

## 四、上线前验证命令

```bash
bash -n scripts/release/backend-build-release.sh
bash -n scripts/release/backend-deploy-release.sh
scripts/release/backend-build-release.sh --env staging
tar -tzf release/backend/*.tgz | rg "\.env\.staging(\.local)?$"
```

## 五、发布后验证

1. 进程检查：

```bash
pm2 status
pm2 logs backend --lines 120
```

2. 健康检查：

```bash
curl -f http://127.0.0.1:3000/health
```

3. 回滚检查：

```bash
ln -sfn /opt/ai-backend/releases/<old-version> /opt/ai-backend/current
pm2 reload backend --update-env
```
