# 发布指南

## 发布到npm

### 1. 准备工作

确保你已经：
- [ ] 在npm上注册了账号，如`https://registry.npmjs.org`
- [ ] 登录到npm：`npm login --registry https://registry.npmjs.org`（见下方「认证方式」）
- [ ] 更新了package.json中的repository URL
- [ ] 更新了README.md中的GitHub链接
- [ ] 确认本地镜像源一致。使用`npm config get registry`查看和`npm config set registry https://registry.npmjs.org`设置

#### 认证方式（推荐：用户级 `.npmrc`）

发布凭证写在**用户级**配置，**不要**提交到本仓库。路径示例：

- Windows：`%USERPROFILE%\.npmrc`（如 `C:\Users\<用户名>\.npmrc`）
- macOS / Linux：`~/.npmrc`

在 [npm Access Tokens](https://www.npmjs.com/settings/~tokens) 创建 **Granular Access Token**，需满足：

- 对包 `java-class-analyzer-mcp-server`：**Read and write**
- 勾选 **Bypass 2FA for publish**（或等价发布权限；npm 要求发版须 2FA 或此类 token）

写入 token（将 `你的token` 替换为页面复制的值，勿提交到 git）：

```bash
npm config set //registry.npmjs.org/:_authToken "你的token" --location=user
```

或手动在用户级 `.npmrc` 增加一行：

```ini
//registry.npmjs.org/:_authToken=你的token
```

验证：

```bash
npm whoami
```

### 2. 发布步骤

#### 首次发布

```bash
# 1. 构建项目
npm run build

# 2. 测试包内容
npm pack --dry-run

# 3. 发布到npm
npm publish
```

#### 更新版本

```bash
# 更新补丁版本 (1.0.0 -> 1.0.1)
npm run version:patch

# 更新小版本 (1.0.0 -> 1.1.0)
npm run version:minor

# 更新大版本 (1.0.0 -> 2.0.0)
npm run version:major

# 发布
npm run publish:npm
```

#### 发布测试版本

```bash
# 发布beta版本
npm run publish:beta
```

### 3. 验证发布

发布后可以验证：

```bash
# 全局安装测试
npm install -g java-class-analyzer-mcp-server

# 测试命令
java-class-analyzer-mcp --help
java-class-analyzer-mcp config -o test-config.json
```

### 4. 用户安装和使用

用户可以通过以下方式安装：

```bash
# 全局安装
npm install -g java-class-analyzer-mcp-server

# 本地安装
npm install java-class-analyzer-mcp-server
```

### 5. 注意事项

- 确保每次发布前都运行了 `npm run build`
- 检查 `.npmignore` 文件确保只发布必要的内容
- 更新版本号后会自动创建git tag
- 发布前确保所有测试通过
- 检查生成的配置文件是否正确

### 6. 故障排除

如果发布失败：
1. 检查包名是否已被占用
2. 确保版本号唯一
3. 检查npm登录状态：`npm whoami`
4. 验证package.json配置
5. **`403` + `Two-factor authentication ... required to publish`**：账号未开 2FA，或 `_authToken` 为旧版/无发布权限的 token。处理：在 npm 开启 2FA 后 `npm login`，或按上文创建 Granular Token 并 `npm config set //registry.npmjs.org/:_authToken "..." --location=user` 后重试
