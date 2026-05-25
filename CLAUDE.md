# 酒馆助手前端界面或脚本编写

@.cursor/rules/项目基本概念.mdc
@.cursor/rules/mcp.mdc
@.cursor/rules/酒馆变量.mdc
@.cursor/rules/酒馆助手接口.mdc
@.cursor/rules/前端界面.mdc
@.cursor/rules/脚本.mdc
@.cursor/rules/mvu变量框架.mdc
@.cursor/rules/mvu角色卡.mdc

## 发布流程

- 本仓库实际发布 remote 是 `preset-manager-origin`（`https://github.com/jerryzmtz/tauritavern-preset-manager.git`），不要把发布 tag 推到 `origin`。
- 版本发布必须按顺序完成：源码提交并推送、等待 bot bundle 提交、确认 bundle、再打版本 tag、再创建 GitHub Release。
- `dist/preset-manager/index.js` 是发布产物，正式发布以远端 bot bundle 提交为准；不要在源码提交后立刻打 tag/release，也不要把 tag 打在未包含最新 `dist` 的源码提交上。
- 本地 `pnpm build` 只能作为预检或临时验证；除非用户明确要求手动同步 bundle，否则不要用本地构建产物替代 bot bundle 发布。
- 源码改动完成后先确认本地没有意外 `dist` 改动：
  - `git status --short --branch`
  - `git diff -- dist/preset-manager/index.js --stat`
- 源码提交推送后，等待远端 bot bundle 生成新提交；看到 bot bundle 前发布未完成，不能打 tag/release。
- bot bundle 出现后，先同步远端并检查提交内容：
  - `git status --short --branch`
  - `git fetch preset-manager-origin`
  - `git log --oneline --left-right --cherry-pick HEAD...preset-manager-origin/main`
  - `git show --stat --name-status <bot-commit>`
- bot bundle 应只改 `dist/preset-manager/index.js` 等构建产物；如果还改了源码或版本文件，先停下确认原因。
- 若本地落后 bot bundle，先把本地分支快进/整合到包含 bot bundle 的远端状态；不要强推覆盖 bot bundle：
  - `git pull --ff-only preset-manager-origin main`
- 若本地有未提交的 `dist` 改动，整合 bot bundle 前先保护它；整合后不要盲目 `stash pop` 覆盖 bot bundle，必须先判断是否需要保留本地 bundle：
  - `git stash push -m "preserve local dist before release" -- dist/preset-manager/index.js`
  - 如 `stash pop` 与 bot bundle 冲突，优先恢复已推送的 bundle 状态，保留 stash，等待明确是否重建/覆盖 `dist`。
- 确认当前 `HEAD` 已经包含目标版本的源码提交和 bot bundle 提交后，才打版本 tag，并显式指定正确 remote：
  - `git tag -a vX.YY -m "vX.YY"`
  - `git push preset-manager-origin vX.YY`
- 推 tag 后创建对应 GitHub Release，例如：
  - `gh release create vX.YY --repo jerryzmtz/tauritavern-preset-manager --title "vX.YY" --notes "..."`
- 发布后用以下命令确认：
  - `git ls-remote --tags preset-manager-origin "refs/tags/vX.YY" "refs/tags/vX.YY^{}"`
  - `gh release view vX.YY --repo jerryzmtz/tauritavern-preset-manager --json 'tagName,name,url,targetCommitish,isDraft,isPrerelease'`
