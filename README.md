# FB复制组查找器

Chrome 浏览器扩展：从 Facebook 通话链接解析可发消息的群聊链接（`messages/t/`），并检测「复制组」通话场景。

## 功能

- 粘贴通话链接或解析当前标签页，提取 `https://www.facebook.com/messages/t/{id}` 群聊链接
- 检测复制组：通话中邀请组外成员导致原组断开时，提醒并标注复制组 / 原组
- **通话意外挂断提醒**：非你主动挂断时，屏幕中央大弹窗提醒（可关闭）
- 通话页自动浮层提示，支持一键复制链接

## 安装（开发模式）

1. 下载 [Releases](https://github.com/secure-artifacts/fb_call_to_group_link/releases) 中的 zip 并解压
2. Chrome 打开 `chrome://extensions/`，开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择解压后的目录

## 如何发布新版本

本项目使用 GitHub Actions 自动构建和发布。每次发布新版本只需要创建一个 Git Tag 并推送即可。

### 发布步骤

#### 1. 确保代码已提交并推送

在发布之前，确保你的所有代码改动已经提交并推送到 GitHub：

```bash
# 查看当前状态
git status

# 添加所有改动
git add .

# 提交改动（把"你的改动说明"替换成实际的描述）
git commit -m "你的改动说明"

# 推送到 GitHub
git push origin main
```

#### 2. 创建版本 Tag

Git Tag 是一个版本标记，用于标识发布的版本号。版本号格式为 `v主版本.次版本.修订版本`，例如 `v1.0.0`、`v1.1.0`、`v2.0.0`。

```bash
# 创建一个新的版本 tag（将 v1.0.1 替换为你想要的版本号）
git tag -a v1.0.1 -m "Release version 1.0.1"
```

#### 3. 推送 Tag 触发自动构建

```bash
# 推送 tag 到 GitHub（这会自动触发 CI 构建）
git push origin v1.0.1
```

推送后，GitHub Actions 会自动执行以下操作：

1. 打包扩展为 zip
2. 生成安全签名（Attestation）
3. 创建 Release 并上传构建产物

#### 4. 查看构建结果

- 构建进度：访问项目的 **Actions** 页面查看
- 发布结果：访问项目的 **Releases** 页面查看已发布的文件

### 版本号说明

| 版本号格式 | 什么时候用 | 示例 |
|-----------|-----------|------|
| `vX.0.0` | 重大更新、不兼容改动 | `v2.0.0` |
| `vX.Y.0` | 新增功能 | `v1.1.0` |
| `vX.Y.Z` | 修复 bug | `v1.0.1` |

### 如果构建失败怎么办

1. 访问项目的 **Actions** 页面查看错误日志
2. 修复代码问题
3. 删除失败的 tag 并重新创建：

```bash
# 删除本地 tag
git tag -d v1.0.1

# 删除远程 tag
git push origin :refs/tags/v1.0.1

# 修复问题后，重新创建并推送
git tag -a v1.0.1 -m "Release version 1.0.1"
git push origin v1.0.1
```
