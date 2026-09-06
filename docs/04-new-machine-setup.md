# 换开发机与新环境本地起步

这份清单面向"把项目搬到另一台电脑继续开发和发版"。服务器侧的一次性准备和发版流程见
[03-deployment.md](./03-deployment.md)，这里只讲开发机。

## 1. 仓库里已经有的，不用带

`git clone` 之后代码、依赖清单、部署脚本和配置样例都是完整的：

- `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`：依赖与跨平台构建约束
- `next.config.ts`：`output: "standalone"` 和 Linux x64 Sharp 的 tracing 白名单
- `deploy.sh`：目标服务器地址、域名、部署目录全部写在脚本顶部，不需要额外记录
- `deploy/`：systemd、nginx、launchd 三份参考配置
- `scripts/setup-competition-db.sh`：建库建用户
- `.env.example`：全部环境变量及默认值

仓库 `.git` 约 220 MB（`video/` 里有成片 mp4 和截图），clone 会慢一点，属正常。

## 2. 必须手工带走的三样

这三样被 `.gitignore` 挡住，且**不能**从仓库重建：

| 来源路径 | 内容 | 处理方式 |
| --- | --- | --- |
| `.env.local` | 管理密码、`MODELMUX_ADMIN_SESSION_SECRET`、数据库 URL、各家供应商 Key、OSS Key | 用加密方式拷到新机器，或按 `.env.example` 重新填 |
| `.deploy.local` | 公网服务器 root 密码（`MODELMUX_DEPLOY_PASSWORD`） | 同上 |
| 本地 MySQL 的考核库 | 选手账号、题目、答卷、活动记录 | 见第 5 节；只做开发可以不带，表会自动建 |

按需带（都是本地产物，不影响跑起来）：

- `.modelmux-data/uploads/`：本地调试上传的题目和答卷附件
- `.modelmux-data/gateway-service-state.json`、`gateway-operation-mode.json`：停服开关和运行模式，新机器默认即可
- `output/test-accounts/`：生成的选手账号交接单，含明文口令

不要带 `.next/`、`node_modules/`、`tsconfig.tsbuildinfo`、`tmp/`，新机器重新装重新构建。

## 3. 新机器工具链

```bash
# Node：仓库用 .node-version 锁定主版本，fnm / nvm / asdf 都会读它
node -v          # 需要与 .node-version 一致，至少 22

# pnpm：由 package.json 的 packageManager 字段决定版本
corepack enable
corepack prepare pnpm@11.9.0 --activate

# 数据库：本地开发同样需要，缺库时 /health 返回 503 degraded，考核端打不开
brew install mysql
brew services start mysql

# 发版需要：deploy.sh 的预检会直接因为缺它退出
brew install sshpass
```

只有重新生成介绍视频时才需要：`brew install ffmpeg imagemagick`，以及 macOS 自带的
`say -v Tingting`（`video/tools/*.mjs` 依赖 `ffmpeg`、`ffprobe`、`magick` 和 `say`，
换非 macOS 环境这些脚本跑不起来）。

## 4. 起本地开发

```bash
git clone git@github.com:stuzhaoxing/ModelMux.git
cd ModelMux
pnpm install

# 建库建用户；表在应用首次访问考核功能时自动创建
MODELMUX_DB_PASSWORD='<至少16位，仅限字母数字与 . _ ~ ->' \
  ./scripts/setup-competition-db.sh

cp .env.example .env.local   # 或直接放入从旧机器带来的 .env.local
pnpm dev
```

`.env.local` 至少要填 `MODELMUX_ADMIN_PASSWORD`、`MODELMUX_ADMIN_SESSION_SECRET`
（`openssl rand -hex 32`）、`MODELMUX_DATABASE_URL`，以及至少一个供应商 Key；
`DASHSCOPE_API_KEYS` 为空时 GLM、Kimi、MiniMax 和 Qwen 旗舰不会进入白名单。

`MODELMUX_DATA_DIR` 留空时默认是仓库下的 `.modelmux-data`，已被 `.gitignore` 忽略。

**数据库命名必须自洽**：`setup-competition-db.sh` 默认建 `modelmux` 库和 `modelmux` 用户，
`MODELMUX_DATABASE_URL` 要与实际建出来的库名、用户名一致。历史开发机上用过其它命名，
从旧机器导数据时先确认两边库名相同，否则导入会落到空库上。

验证：

```bash
curl http://localhost:1444/health     # status 应为 ok 或 needs_config，不能是 degraded
pnpm check                            # lint + typecheck + test + build
```

## 5. 迁移历史考核数据（可选）

只在需要保留旧机器的账号、题目和答卷时做。先在旧机器导出：

```bash
mysqldump -u <db-user> -p --single-transaction --default-character-set=utf8mb4 \
  <db-name> > modelmux-dump.sql
tar -czf modelmux-uploads.tar.gz .modelmux-data/uploads
```

新机器导入，库名要与 `MODELMUX_DATABASE_URL` 一致：

```bash
mysql -u <db-user> -p <db-name> < modelmux-dump.sql
tar -xzf modelmux-uploads.tar.gz
```

`competition_attachments` 表只存文件名，实际文件在 `MODELMUX_DATA_DIR/uploads`；
两者必须一起迁移，否则题目和答卷里的图片、附件会 404。

## 6. 恢复发版能力

```bash
cp <旧机器>/.deploy.local .deploy.local   # 内含 MODELMUX_DEPLOY_PASSWORD
chmod 600 .deploy.local
./deploy.sh --skip-build --logs           # 先不构建，验证 SSH 与服务器连通
```

`deploy.sh` 用密码登录（`PubkeyAuthentication=no`），所以新机器不需要配置 SSH 公钥，
但必须装 `sshpass`。服务器上的 `/opt/modelmux/.env.local` 由服务器自己维护，
部署流程不会覆盖，换开发机不影响它。

## 7. 换机后自查

- [ ] `pnpm check` 全绿
- [ ] `curl localhost:1444/health` 不是 `degraded`
- [ ] `/admin/login` 能用带过来的管理密码登录
- [ ] 旧题目里的图片能正常显示（说明 uploads 与数据库一起迁移到位）
- [ ] `/v1/models` 带选手 Key 返回预期白名单
- [ ] `./deploy.sh` 能完成一次发版并通过公网健康检查
