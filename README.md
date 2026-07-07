# Java Class Analyzer MCP Server

一个基于 Model Context Protocol (MCP) 的 Java 类分析服务，可扫描 Maven 项目依赖、反编译 Java 类文件、获取 class 方法列表等信息，供 LLM 做代码分析。

## 适用场景
Cursor 等 AI 工具直接生成调用二方（内部调用）、三方包（外部调用）接口的代码时，往往无法读取当前工程外的依赖源码，容易生成错误代码，甚至出现幻觉式编码。

常见做法是手动拷贝源码给 LLM，或先把源码文件放进当前工程再在对话中引用；本地反编译 MCP 方案则能直接解析 JAR 包中的类与方法，显著提升代码生成的准确性和可用性。

## 功能特性

- **🚀使用方便**：mcp服务基于TypeScript实现，使用npm打包，方便分发和安装，弱环境依赖。
- 🔍 **依赖扫描**: 自动扫描Maven项目的所有依赖JAR包
- 📦 **类索引**: 建立类全名到JAR包路径的映射索引
- 🔎 **类名搜索**: 根据关键词快速搜索已索引的 Java 类
- 🔄 **反编译**: 使用 CFR 工具（已内置）实时反编译 `.class` 文件为 Java 源码
- 📊 **类分析**: 分析Java类的结构、方法、字段、继承关系等
- 💾 **智能缓存**: 按包名结构缓存反编译结果，支持缓存控制
- 🚀 **自动索引**: 执行分析前自动检查并创建索引
- ⚙️ **灵活配置**: 支持外部指定CFR工具路径
- 🤖 **LLM集成**: 通过MCP协议为LLM提供Java代码分析能力

## 使用示例
### 在IDE中注册mcp服务
![工具列表](./doc/mcp-tools.jpg)

### 在智能体对话中使用mcp
![示例](./doc/mcp-use-case.jpg)

## 使用说明

### mcp服务安装

#### 全局安装（推荐）

```bash
npm install -g java-class-analyzer-mcp-server
```

安装后可以直接使用 `java-class-analyzer-mcp` 命令。

#### 本地安装

```bash
npm install java-class-analyzer-mcp-server
```

#### 从源码安装

```bash
git clone https://github.com/handsomestWei/java-class-analyzer-mcp-server.git
cd java-class-analyzer-mcp-server
npm install
npm run build
```

### 使用 Nix + direnv 开发（可选）

仓库已提供 `flake.nix` 和 `.envrc`，进入目录后可以直接加载开发环境。

```bash
direnv allow
```

仓库级 `direnv` 会优先使用中科大 Nix 二进制缓存镜像，再回退到官方 `cache.nixos.org`，避免部分包在其他镜像缺失时下载过慢。

如果你直接执行 `nix develop`，则仍然使用本机全局 Nix 配置里的缓存源。

或者不使用 direnv，手动进入 shell：

```bash
nix develop
```

如果通过 flake 直接运行：`nix run .#default` 提供开箱即用的 Node + Java + Maven 运行时；`nix run .#base` 仅提供基础包装，适合宿主环境已经自行提供 Java / Maven 的场景。

该开发环境会提供：

- `node` / `npm`
- `java` / `javap`
- `mvn`
- `cfr`

并自动导出：

- `JAVA_HOME`
- `MAVEN_HOME`
- `NODE_ENV=development`
- `CFR_PATH`

开发环境会自动下载 Nix 打包的 CFR jar，并把它注入 `CLASSPATH`，这样当前代码无需改动就能自动发现它。

如果仓库根目录或 `lib/` 下存在 `cfr-*.jar`，现有代码仍会优先命中本地文件；否则会回退到 Nix 提供的 CFR。

### MCP服务配置

#### 方法1：使用生成的配置（推荐）

运行以下命令生成配置模板：
```bash
java-class-analyzer-mcp config -o mcp-client-config.json
```

然后将生成的配置内容添加到你的MCP客户端配置文件中。

#### 方法2：手动配置

参考以下配置示例，添加到MCP客户端配置文件中：

**全局安装后的配置：**
```json
{
    "mcpServers": {
        "java-class-analyzer": {
            "command": "java-class-analyzer-mcp",
            "args": ["start"],
            "env": {
                "NODE_ENV": "production",
                "MAVEN_REPO": "D:/maven/repository",
                "JAVA_HOME": "C:/Program Files/Java/jdk-11"
            }
        }
    }
}
```

**本地安装后的配置：**
```json
{
    "mcpServers": {
        "java-class-analyzer": {
            "command": "node",
            "args": [
                "node_modules/java-class-analyzer-mcp-server/dist/index.js"
            ],
            "env": {
                "NODE_ENV": "production",
                "MAVEN_REPO": "D:/maven/repository",
                "JAVA_HOME": "C:/Program Files/Java/jdk-11"
            }
        }
    }
}
```

#### 参数说明
- `command`: 运行MCP服务器的命令，这里使用 `node`
- `args`: 传递给Node.js的参数，指向`npm run build`编译后的dist文件夹内文件
- `env`: 环境变量设置

#### 环境变量说明
- `NODE_ENV`: 运行环境标识
  - `production`: 生产环境，减少日志输出，启用性能优化
  - `development`: 开发环境，输出详细调试信息
  - `test`: 测试环境
- `MAVEN_REPO`: Maven本地仓库路径（可选）
  - 如果设置，程序会使用指定的仓库路径扫描JAR包
  - 如果未设置，程序会使用默认的 `~/.m2/repository` 路径
- `MCP_MAVEN_DECOMPILE_CACHE_DIR`: 全局 Maven 反编译缓存根目录（可选）
  - Maven 仓库内的依赖会缓存在该目录的 `maven-repo/` 下，多个项目可直接复用
  - 如果未设置，Linux 使用 `${XDG_CACHE_HOME:-~/.cache}/java-class-analyzer-mcp-server/decompile`，macOS 使用 `~/Library/Caches/java-class-analyzer-mcp-server/decompile`，Windows 使用 `%LOCALAPPDATA%/java-class-analyzer-mcp-server/decompile`
- `JAVA_HOME`: Java安装路径（可选）
  - 如果设置，程序会使用 `${JAVA_HOME}/bin/java` 执行Java命令（用于CFR反编译）
  - 如果未设置，程序会使用PATH中的 `java` 命令
- `CFR_PATH`: CFR反编译工具的路径（可选，程序会自动查找）

### 可用的工具

#### 1. scan_dependencies
扫描Maven项目的所有依赖，建立类名到JAR包的映射索引。

**参数:**
- `projectPath` (string): Maven项目根目录路径
- `forceRefresh` (boolean, 可选): 是否强制刷新索引，默认false

**示例:**
```json
{
  "name": "scan_dependencies",
  "arguments": {
    "projectPath": "/path/to/your/maven/project",
    "forceRefresh": false
  }
}
```

#### 2. search_classes
根据关键词搜索已索引的 Java 类名，不需要反编译源码。

**参数:**
- `projectPath` (string): Maven项目根目录路径
- `query` (string): 类名关键词，对完整类名做子串匹配；trim 后不能为空
- `packagePrefix` (string, 可选): 按包名前缀过滤
- `jarName` (string, 可选): 按 JAR basename 精确过滤
- `jarPath` (string, 可选): 按 JAR 绝对路径精确过滤
- `limit` (integer, 可选): 返回结果上限，默认 20
- `caseSensitive` (boolean, 可选): 是否区分大小写，默认 false

结果通过 `structuredContent.classes` 返回，每项包含 `className`、`simpleName`、`packageName`、`jarName` 和 `jarPath`。结果按 `className`、`jarPath` 升序稳定排序。

**示例:**
```json
{
  "name": "search_classes",
  "arguments": {
    "projectPath": "/path/to/your/maven/project",
    "query": "OrderService",
    "packagePrefix": "com.example",
    "limit": 20
  }
}
```

#### 3. decompile_class
反编译指定的Java类文件，返回Java源码。

**参数:**
- `className` (string): 要反编译的Java类全名，如：com.example.QueryBizOrderDO
- `projectPath` (string): Maven项目根目录路径
- `useCache` (boolean, 可选): 是否使用缓存，默认true。避免每次都重复生成。
- `cfrPath` (string, 可选): CFR反编译工具的 jar 包路径。已内置，也可以额外指定版本。
- `jarPath` (string, 可选): JAR绝对路径，用于在同名类跨JAR时精确指定来源；trim后为空字符串时视为未传。
- `startLine` (integer, 可选): 1-based 闭区间起点；单独提供时返回 `[startLine, EOF]`；非正数或大于 `endLine` 会报错。
- `endLine` (integer, 可选): 1-based 闭区间终点；单独提供时返回 `[1, endLine]`；非正数会报错。

**示例（完整源码，保持向后兼容）:**
```json
{
  "name": "decompile_class",
  "arguments": {
    "className": "com.example.QueryBizOrderDO",
    "projectPath": "/path/to/your/maven/project",
    "useCache": true,
    "cfrPath": "/path/to/cfr-0.152.jar"
  }
}
```

**示例（行区间召回，重复类来源用 `jarPath` 消歧）:**
```json
{
  "name": "decompile_class",
  "arguments": {
    "className": "com.example.QueryBizOrderDO",
    "projectPath": "/path/to/your/maven/project",
    "jarPath": "/root/.m2/repository/com/example/query-biz/1.0.0/query-biz-1.0.0.jar",
    "startLine": 12,
    "endLine": 30
  }
}
```

不传 `startLine`/`endLine` 时返回整个反编译文件；只传 `startLine` 自动补全到文件末尾；只传 `endLine` 自动从首行截到 `endLine`；越界会自动裁剪到合法范围。

#### 4. search_dependency_code
对已索引的 Maven 依赖反编译源码做文本子串搜索，定位到类与命中行号。

**参数:**
- `projectPath` (string): Maven项目根目录路径
- `query` (string): 要搜索的文本子串；trim 后不能为空。
- `packagePrefix` (string, 可选): 按包名前缀过滤，尾随 `.` 会规范化；多个过滤条件同时存在时按 AND 组合。
- `jarName` (string, 可选): JAR basename 精确匹配，例如 `alpha-lib-1.0.jar`。
- `jarPath` (string, 可选): JAR 绝对路径精确匹配；也是重复 `className` 来源的显式消歧键。
- `limit` (integer, 可选): 返回的类结果总数上限，默认 20；不设服务端硬上限。
- `caseSensitive` (boolean, 可选): 是否区分大小写，默认 true。
- `useCache` (boolean, 可选): 是否复用反编译缓存，默认 true；Maven 依赖缓存可跨项目复用，`false` 时仅对本次搜索涉及的类重新反编译。
- `includeLineText` (boolean, 可选): 是否在响应里附上行号到行文本的映射 `lineTextsByLine`，仅覆盖命中行；默认 false。

`content` 给摘要，`structuredContent` 给命中项。每个命中项至少包含 `className`、`packageName`、`jarPath`、`matchCount`、`matchedLines`；`includeLineText=true` 时再附加 `lineTextsByLine`。结果按 `matchCount` 降序、`className` 升序稳定排序，同名同分再用 `jarPath` 升序作为确定性 tie-break。

实现上当前已回退到单线程顺序执行：按索引顺序完成过滤后，会把本次需要真实反编译的类按 `jarPath` 分组，并对每个 JAR 依次执行一次 CFR `jar + --jarfilter` 批量反编译，再逐类做文本匹配；不会启动 worker 池，也不会受 `DECOMPILE_CONCURRENCY` 影响。搜索结束后会 best-effort 清理本次 `request-<unique>` 临时目录。

如果三个范围过滤参数都不提供，工具描述中已经声明会对所有已索引依赖执行搜索，这是已实现的较慢路径，建议调用前先确认是否真的需要无范围搜索；更稳妥的做法是先调用 `decompile_dependencies_to_dir` 在本地目录里检索。

**示例:**
```json
{
  "name": "search_dependency_code",
  "arguments": {
    "projectPath": "/path/to/your/maven/project",
    "query": "targetToken",
    "packagePrefix": "com.example",
    "jarPath": "/root/.m2/repository/com/example/alpha-lib/1.0/alpha-lib-1.0.jar",
    "includeLineText": true,
    "limit": 20
  }
}
```

#### 5. decompile_dependencies_to_dir
按范围批量反编译已索引依赖类到本地缓存目录，并返回单个已存在目录路径，配合本地 `rg/grep` 或 IDE 完成大范围检索。

**参数:**
- `projectPath` (string): Maven项目根目录路径
- `packagePrefix` / `jarName` / `jarPath` (三者至少必须传一个): 范围过滤，语义与 `search_dependency_code` 保持一致并按 AND 组合。
- `maxClasses` (integer, 可选): 仅限制实际发生反编译并写入/覆盖缓存的类数；已缓存并跳过的类不计入配额。
- `useCache` (boolean, 可选): 默认 true；`true` 时仅补缺失缓存，`false` 时强制重新反编译命中类并覆盖缓存。

`content` 给简短摘要；`structuredContent` 至少返回以下字段，且零命中时除 `requestedScope`、`outputDir` 之外的统计值均为 `0`：

实现上当前已回退到单线程顺序执行：按范围在循环里逐类反编译并落盘，不会启动 worker 池，也不会受 `DECOMPILE_CONCURRENCY` 影响。批量任务结束后会 best-effort 清理本次 `request-<unique>` 临时目录。

- `outputDir`: 本次范围的最小公共目录的绝对路径，目录已存在。
- `requestedScope`: 规范化后的过滤条件与 `useCache`/`maxClasses`。
- `processedClasses`: 真正尝试反编译的类数（capped-by-cache 类不计入）。
- `decompiledClasses`: 成功反编译的类数。
- `skippedCachedClasses`: 命中缓存并跳过的类数。
- `failedClasses`: 反编译失败的类数。
- `failedSummaryTopN`: 失败类的前若干条样本（`className`、`jarPath`、错误信息）。
- `truncatedCount`: 超出 `failedSummaryTopN` 阈值的剩余失败类数量。

工具不返回类名清单，也不返回源码正文；想看具体内容请直接在该目录下调用本地搜索工具，或结合 `search_dependency_code` 使用。

**示例:**
```json
{
  "name": "decompile_dependencies_to_dir",
  "arguments": {
    "projectPath": "/path/to/your/maven/project",
    "packagePrefix": "com.example.alpha",
    "useCache": true
  }
}
```

#### 6. analyze_class
分析Java类的结构、方法、字段等信息。

**参数:**
- `className` (string): 要分析的Java类全名
- `projectPath` (string): Maven项目根目录路径

**示例:**
```json
{
  "name": "analyze_class",
  "arguments": {
    "className": "com.example.QueryBizOrderDO",
    "projectPath": "/path/to/your/maven/project",
  }
}
```

### 缓存文件
服务会使用以下缓存目录和文件：
- `.mcp-class-index.json`: 类索引缓存文件
- 全局 Maven 反编译缓存：`MAVEN_REPO`（默认 `~/.m2/repository`）内的 JAR 存放在全局缓存根的 `maven-repo/` 下；根目录由 `MCP_MAVEN_DECOMPILE_CACHE_DIR` 覆盖，未配置时使用上文所列平台默认缓存目录。目录按 Maven 仓库相对路径、JAR、包路径和类名组织，因此相同 Maven 依赖可被不同项目复用。
- `.mcp-decompile-cache/external/`: Maven 仓库之外的 JAR 仍缓存在当前项目内，保持项目间隔离。目录按 JAR 绝对路径、包路径和类名组织。
- `.mcp-class-temp/`: 临时文件目录；每次反编译调用都会在自己的请求级命名空间下工作。单类 `decompile_class` 现对目标 JAR 走 CFR `--jarfilter` 定位单类，批量反编译则把 JAR 批量输出先落在请求级临时目录，再按既有缓存布局回写；这样既避免不同请求互相覆盖，也便于结束后 best-effort 回收各自请求级命名空间。

## 工作流程

1. **自动索引**: 首次调用 `search_classes`、`search_dependency_code`、`decompile_dependencies_to_dir`、`analyze_class` 或 `decompile_class` 时，自动检查并创建索引
2. **智能缓存**: Maven 仓库内的反编译结果使用跨项目全局缓存，其他 JAR 使用项目级缓存；缓存键包含来源 `jarPath`，避免同名类跨 JAR 时互相覆盖，并支持 `useCache` 控制是否刷新
3. **分析类**: 使用 `analyze_class` 或 `decompile_class` 获取类的详细信息
4. **LLM分析**: 将反编译的源码提供给LLM进行代码分析

## 推荐工作流：先搜再批量取源码

如果是面对一个陌生依赖 JAR，建议按下面的顺序使用：

1. `scan_dependencies` 建立或刷新 `.mcp-class-index.json`；Maven 失败时默认不会回退扫描本地 Maven 仓库，只有显式设置环境变量 `ALLOW_REPO_FALLBACK=true` 才允许。
2. 不确定类全名时，先用 `search_classes(projectPath, query, packagePrefix?, jarName?, jarPath?)` 在索引中快速定位候选类。
3. `decompile_dependencies_to_dir(projectPath, jarName=... 或 packagePrefix=... )` 批量反编译指定范围，返回单个本地缓存目录；可直接在上面运行 `rg` / `grep` 做任意模式的本地检索。
4. 想拿到结构化源码命中结果时，改用 `search_dependency_code(projectPath, query, packagePrefix?, jarName?, jarPath?)`；缺范围过滤的慢风险见工具描述，请先确认范围或先走第 3 步。
5. 拿到具体命中行号后，用 `decompile_class(className, projectPath, jarPath, startLine, endLine)` 行区间召回；同名类需要传 `jarPath` 消歧。

按这个顺序，MCP 侧负责轻量定位、批量缓存与受控召回，真正的全文本搜索留给本地 `rg/grep` 完成。

## 技术架构

### 核心组件

- **DependencyScanner**: 负责扫描Maven依赖和建立类索引
- **DecompilerService**: 负责反编译.class文件
- **JavaClassAnalyzer**: 负责分析Java类结构
- **MCP Server**: 提供标准化的MCP接口

### 依赖扫描流程

1. 执行`mvn dependency:build-classpath -DincludeScope=runtime`获取 Maven 解析后的运行时依赖路径
2. 解析每个JAR包，提取所有.class文件
3. 建立"类全名 -> JAR包路径"的映射索引
4. 缓存索引到`.mcp-class-index.json`文件

### 反编译流程

1. 根据类名与可选的 `jarPath` 在 `.mcp-class-index.json` 中定位对应的 JAR
2. 检查该 JAR 对应的全局或项目级反编译缓存，如果存在且 `useCache=true` 则直接返回
3. 对定位到的目标 JAR 调用 CFR；单类 `decompile_class` 使用 `--jarfilter` 仅反编译目标类，`search_dependency_code` 与批量目录能力则按 JAR 分组批量输出到请求级临时目录
4. 将生成的 `.java` 源码按来源写入全局 `maven-repo/` 缓存或项目级 `.mcp-decompile-cache/external/` 缓存，再按 JAR、包路径和类名落文件
5. 若调用 `decompile_class` 时携带了 `startLine`/`endLine`，最后一步改为按 1-based 闭区间裁剪源码返回

`search_dependency_code` 与 `decompile_dependencies_to_dir` 当前都已在实现层回退到单线程顺序执行：内部走 `for...of` + `await`，但真实反编译阶段会先按 JAR 分组，再对每个 JAR 执行 CFR `--jarfilter` 批量输出；不再维护 worker 池，也不会读取 `DECOMPILE_CONCURRENCY`。

## 已知限制（首版）

- **依赖限定**：`search_dependency_code` 和 `decompile_dependencies_to_dir` 只覆盖 `.mcp-class-index.json` 已索引的 Maven 依赖，不搜当前工程源码、编译产物或未入库的任意 JAR。
- **文本搜索**：搜索语义固定为对反编译 Java 源码的文本子串匹配，不支持正则、AST 或语义检索；`caseSensitive` 默认为 `true`。
- **内部类**：索引策略沿用现有约定，`$` 内部类不在搜索/批量反编译覆盖范围内。
- **批量反编译输出**：`decompile_dependencies_to_dir` 只返回单个已存在目录和轻量统计，并不给出类名清单或源码正文。
- **响应体积**：`search_dependency_code` 在 `includeLineText=true` 且响应预估过大时会先去掉所有 `lineTextsByLine` 并标记 `lineTextOmitted=true`；如仍过大则报显式错误，并建议缩小过滤范围或先调用 `decompile_dependencies_to_dir` 后用本地 `rg/grep` 检索。
- **行区间召回**：`decompile_class` 的 `startLine`/`endLine` 必须为 1-based 正整数；`startLine > endLine` 或任一为 0/负数都会直接报错；范围超出文件末尾时会自动裁剪。
- **重复类来源**：同名 `className` 来自不同 JAR 时，单次返回不进行隐式合并；通过 `jarPath` 在搜索过滤、单类回查和批量反编译范围中显式消歧。

## 故障排除

### 常见问题

1. **Maven命令失败**
   - 确保Maven已安装并在PATH中
   - 检查项目是否有有效的pom.xml文件

2. **CFR反编译失败**
   - 确保CFR jar包已下载（支持任意版本号）
   - 检查Java环境是否正确配置
   - 可通过`cfrPath`参数指定CFR路径

3. **类未找到**
   - 程序会自动检查并创建索引
   - 检查类名是否正确
   - 确保项目依赖已正确解析
   - 若同名类来自不同 JAR，请同时提供 `jarPath` 精确指定来源

4. **搜索/批量反编译看不到内部类**
   - 当前索引策略会排除 `$` 内部类；如要覆盖到，请先把目标源码放到当前工程内或改用其它工具链

## 测试说明

### 构建项目

```bash
npm install
npm run build
```

### 测试工具使用

项目提供了独立的测试工具，可以直接测试MCP服务的各个功能，无需通过MCP客户端。

```bash
# 列出所有可用工具（默认行为）
node test-tools.js

# 测试所有工具
node test-tools.js -t all

# 使用 synthetic fixture 测试 MCP 工具（需同时传 --project）
node test-tools.js -t mcp-call --name search_dependency_code --project /path/to/project --query targetToken --fixture-sources /path/to/sources.json

# 先预热 class index 再测试
node test-tools.js -t search --project /path/to/project --prepare-index-jar /path/to/jar.jar --query targetToken
```

### 测试工具参数

- `-t, --tool <工具名>`: 指定要测试的工具，默认 `tools-list` (scan|decompile|analyze|lookup|search|decompile-dir|mcp-call|tools-list|all)
- `-p, --project <路径>`: 项目路径
- `-c, --class <类名>`: 要分析的类名
- `--no-refresh`: 不强制刷新依赖索引
- `--no-cache`: 不使用反编译缓存
- `--cfr-path <路径>`: 指定CFR反编译工具的jar包路径
- `--fixture-sources <json>`: 显式启用 synthetic locked-source 测试资源；仅在传入外部 fixture sources JSON 时启用 testing harness 覆盖，并且仍需同时传 `--project`
- `--prepare-index-jar <路径>`: 显式为目标 `--project` 预写某个 JAR 的 `.mcp-class-index.json`，不再从测试项目 `pom.xml` 猜测依赖
- `-h, --help`: 显示帮助信息

### 日志级别控制

通过 `NODE_ENV` 环境变量控制日志输出：

- `development`: 输出详细调试信息
- `production`: 只输出关键信息
