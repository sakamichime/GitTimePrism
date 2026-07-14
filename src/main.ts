/**
 * GitTimePrism 前端主入口文件
 * 此文件负责初始化整个应用：
 * 1. 加载全局样式
 * 2. 初始化国际化服务
 * 3. 初始化应用主框架（三栏布局等）
 * 4. 监听来自 Rust 后端的事件
 */

// 导入全局样式文件（变量定义必须最先加载，因为其他样式文件引用了这些变量）
import './styles/variables.css';
import './styles/global.css';
import './styles/components.css';
// 导入右键菜单样式（Task 3.5：用于提交节点图、文件列表等右键菜单）
import './styles/context-menu.css';
// 导入对话框样式（Task 3.5：用于通用模态对话框、表单输入、下拉选择器）
import './styles/dialog.css';
// 导入 Find Widget 样式（Task 5.1：用于提交节点图上方的搜索框）
import './styles/find-widget.css';
// 导入设置面板样式（Task 7.6：用于配置面板的模态对话框、表单、Issue Link 超链接等）
import './styles/settings-widget.css';
// 导入合并编辑器样式（Task 8.5：用于合并冲突解决的三栏编辑器、冲突块高亮、工具栏按钮）
import './styles/merge-editor.css';
// 导入 Blame 视图样式（Task 8.5：用于显示文件每行的提交溯源信息）
import './styles/blame-viewer.css';
// 导入子模块管理器样式（阶段 9：Task 9.9：用于子模块管理对话框）
import './styles/submodule-manager.css';
// 导入 LFS 管理器样式（阶段 9：Task 9.9：用于 LFS 管理对话框）
import './styles/lfs-manager.css';

// 导入 xterm.js 终端样式
// xterm.js 需要加载其 CSS 文件才能正确显示终端界面
import '@xterm/xterm/css/xterm.css';

// 导入国际化服务（注意：虽然文件是 .ts，导入路径仍使用 .js 扩展名，这是 ESM 模块解析约定）
import { init as initI18n } from './services/i18n.js';

// 导入应用主框架组件
import { App } from './components/app.js';

// 导入 Tauri 事件监听器
import { listen } from '@tauri-apps/api/event';

/**
 * 应用启动函数
 * 按顺序执行初始化步骤
 */
async function bootstrap() {
  // 第一步：初始化国际化服务（加载语言包、检测系统语言）
  await initI18n();

  // 第二步：创建应用实例并初始化
  const app = new App();
  app.init();

  // 第三步：监听来自 Rust 后端的文件变化事件
  // 当仓库中的文件发生变化时，Rust 后端会推送此事件
  await listen('file-changed', (event) => {
    // event.payload 是 FileChangeEvent 数组
    console.log('收到文件变化事件:', event.payload);
    // 后续阶段将根据变化的文件类型刷新对应的 UI 面板
  });
}

// 当 DOM 完全加载后启动应用
document.addEventListener('DOMContentLoaded', bootstrap);
