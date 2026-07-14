# GitTimePrism

GitTimePrism 是一款基于 Tauri 2.x 开发的现代化 Git 可视化桌面客户端，采用 Rust 作为后端、TypeScript + Vite 作为前端，提供直观优雅的图形界面来管理 Git 仓库。

## 核心功能

- **Git 仓库可视化**：提交历史节点图、分支关系一目了然
- **工作区状态管理**：清晰展示暂存区/未暂存文件变更
- **双栏差异对比**：左右分屏查看文件变更，新增行绿色高亮、删除行红色高亮
- **分支管理**：查看本地/远程分支、快速切换分支
- **标签管理**：创建、删除、切换标签
- **远程操作**：支持 git pull / git push
- **撤销提交**：支持 soft / mixed / hard 三种重置模式
- **内置终端**：基于 xterm.js 的嵌入式终端，可直接执行 Git 命令
- **主题与壁纸**：Catppuccin 双主题 + 毛玻璃半透明面板 + 壁纸动态变色引擎
- **国际化支持**：中文、英文界面切换

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | TypeScript + Vite 6 |
| 桌面框架 | Tauri 2.x（Rust 后端） |
| 终端组件 | xterm.js 6 + portable-pty 0.8 |
| 主题样式 | Catppuccin Mocha / Latte |
| 构建工具 | Vite、Cargo |

## 环境要求

- **操作系统**：Windows 10/11（当前主要支持 Windows）
- **Node.js**：18.x 或更高版本
- **npm**：9.x 或更高版本
- **Rust**：1.77.2 或更高版本
- **Git**：需要本地安装 Git 命令行工具

## 安装步骤

1. **克隆仓库**

```bash
git clone <仓库地址>
cd GitTimePrism
```

2. **安装前端依赖**

```bash
npm install
```

3. **安装 Rust 依赖**

```bash
cd src-tauri
cargo fetch
cd ..
```

## 运行说明

> **重要提示**：由于 Tauri 在沙箱环境中无法自动创建配置目录，请**务必通过独立的 Windows PowerShell 终端**启动开发服务器，而不是通过 IDE 内置终端运行。

1. 打开独立的 Windows PowerShell 终端
2. 切换到项目目录
3. 执行以下命令启动开发模式：

```bash
npm run tauri dev
```

应用启动后，会自动打开 GitTimePrism 窗口。初次使用时会检测本地 Git 环境，若未安装 Git 会显示安装引导。

## 使用指南

1. **打开仓库**：点击工具栏中的打开按钮，选择一个本地 Git 仓库目录
2. **查看提交历史**：左侧面板显示提交节点图，点击提交可查看详情
3. **查看文件变更**：中间面板显示暂存/未暂存文件，点击文件在右侧显示差异对比
4. **切换分支**：在分支列表面板中选择目标分支进行切换
5. **创建提交**：在工作区有变更时，使用提交输入框填写消息并提交
6. **使用终端**：底部终端面板可直接输入 Git 命令进行高级操作

## 项目结构

```
GitTimePrism/
├── src/                              # 前端源代码（TypeScript + Vite）
│   ├── components/                   # UI 组件
│   ├── styles/                       # CSS 样式（主题变量、全局样式、组件样式）
│   ├── i18n/                         # 国际化语言包
│   ├── services/                     # 业务服务模块
│   ├── utils/                        # 工具函数
│   └── main.ts                       # 前端入口文件
├── src-tauri/                        # Rust 后端源代码（Tauri 2.x）
│   ├── src/commands/                 # Tauri IPC 命令
│   ├── src/git/                      # Git 操作模块
│   ├── src/utils/                    # Rust 工具模块
│   ├── capabilities/                 # Tauri 2 权限配置
│   ├── Cargo.toml                    # Rust 依赖配置
│   └── tauri.conf.json               # Tauri 应用配置
├── docs/                             # 项目文档
├── package.json                      # NPM 配置
├── vite.config.js                    # Vite 构建配置
└── 项目目录结构.md                    # 详细目录结构说明
```

更详细的目录说明请参考 [项目目录结构.md](项目目录结构.md)。

## 开发规范

本项目遵循以下开发规范：

- 使用 **Tauri（Rust 后端 + TypeScript 前端）** 技术栈
- 代码注释使用**中文**，详细说明每个函数、类、变量的作用及代码逻辑
- Git 提交信息使用**中文**
- 新增或修改文件结构后，同步更新 [项目目录结构.md](项目目录结构.md)

## 构建发布

```bash
npm run tauri build
```

构建完成后，安装包会输出到 `src-tauri/target/release/bundle/` 目录下。

## 常见问题

### 应用窗口没有显示内容

请确认是否通过独立 PowerShell 终端运行 `npm run tauri dev`，IDE 内置终端可能受到沙箱限制。

### 壁纸无法加载

本项目使用 Rust 后端命令 `read_image_as_data_url` 将图片转为 base64 data URL 后加载，比直接使用 asset URL 更可靠。

## 致谢

本项目使用了以下开源项目，在此表示感谢：

- [vscode-icons](https://github.com/vscode-icons/vscode-icons)：为 Visual Studio Code 提供丰富的文件图标集，本项目借用其图标资源来美化文件类型展示，让工作区中的文件变更一目了然。

## 许可证

本项目采用 [MIT](LICENSE) 许可证。
