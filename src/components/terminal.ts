/**
 * 内嵌终端组件
 * 
 * 使用 xterm.js 库渲染终端界面，实现类似 VSCode 内置终端的效果。
 * 通过 Tauri IPC 与 Rust 后端的 PTY（伪终端）交互。
 * 
 * 工作流程：
 * 1. 用户在 xterm.js 中输入字符
 * 2. 字符通过 invoke('write_to_pty') 发送到 Rust 后端
 * 3. Rust 后端将字符写入 PTY，PTY 中的 shell 处理命令
 * 4. Shell 的输出通过 Rust 后端的事件系统推送回来
 * 5. 前端监听 'pty-output' 事件，将输出写入 xterm.js 显示
 * 
 * 功能特性：
 * - 可折叠/展开的底部面板
 * - 自动适应容器大小（FitAddon）
 * - 点击 URL 自动在浏览器打开（WebLinksAddon）
 * - 跟随应用主题切换终端配色
 * - 多终端实例支持（每个实例有独立的 PTY ID）
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * 暗色主题的终端配色
 * 基于 Catppuccin Mocha 色板，与 CSS 变量中的暗色主题一致
 * 定义了终端中 16 种标准颜色（黑、红、绿、黄、蓝、品红、青、白 + 亮色版）
 */
const darkTheme = {
  background: '#11111b',
  foreground: '#cdd6f4',
  cursor: '#f5e0dc',
  cursorAccent: '#11111b',
  selectionBackground: 'rgba(137, 180, 250, 0.3)',
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
};

/**
 * 亮色主题的终端配色
 * 基于 Catppuccin Latte 色板，与 CSS 变量中的亮色主题一致
 */
const lightTheme = {
  background: '#eff1f5',
  foreground: '#4c4f69',
  cursor: '#dc8a78',
  cursorAccent: '#eff1f5',
  selectionBackground: 'rgba(30, 102, 245, 0.3)',
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#ea76cb',
  cyan: '#179299',
  white: '#6c6f85',
  brightBlack: '#6c6f85',
  brightRed: '#d20f39',
  brightGreen: '#40a02b',
  brightYellow: '#df8e1d',
  brightBlue: '#1e66f5',
  brightMagenta: '#ea76cb',
  brightCyan: '#179299',
  brightWhite: '#acb0be',
};

/**
 * TerminalPanel 类
 * 
 * 封装 xterm.js 终端实例和 PTY 交互逻辑。
 * 每个实例对应一个终端标签页和一个 PTY 进程。
 */
export class TerminalPanel {
  /** 终端渲染容器 DOM 元素 */
  private container: HTMLElement;
  /** xterm.js 终端实例 */
  private terminal: Terminal | null = null;
  /** Fit 插件实例（自动调整终端大小以适应容器） */
  private fitAddon: FitAddon | null = null;
  /** 终端是否已初始化 */
  private initialized: boolean = false;
  /** 当前 PTY 进程的唯一标识符（用于区分多个终端） */
  private ptyId: string | null = null;

  /**
   * 构造函数
   * @param container - 终端面板的容器 DOM 元素（通常是 #terminal-body）
   */
  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 初始化终端
   * 
   * 创建 xterm.js 实例，加载插件，打开终端，
   * 监听 PTY 输出事件，启动 PTY 进程。
   * 
   * 如果已经初始化过则直接返回（防止重复初始化）。
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      // 创建 xterm.js 终端实例
      this.terminal = new Terminal({
        // 终端初始列数（会被 FitAddon 自动调整）
        cols: 80,
        // 终端初始行数（会被 FitAddon 自动调整）
        rows: 24,
        // 使用当前应用主题对应的终端配色
        theme: this.getCurrentTheme(),
        // 终端字体使用等宽字体
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', 'Courier New', monospace",
        // 终端字体大小
        fontSize: 13,
        // 光标闪烁效果
        cursorBlink: true,
        // 光标样式：竖线（|）
        cursorStyle: 'bar',
        // 终端滚动缓冲区保留的最大行数（可向上滚动查看历史输出）
        scrollback: 5000,
        // 允许使用 Ctrl+C 复制选中文字
        allowProposedApi: true,
      });

      // 创建并加载 Fit 插件
      // 此插件会在容器大小变化时自动调整终端的行数和列数
      this.fitAddon = new FitAddon();
      this.terminal.loadAddon(this.fitAddon);

      // 创建并加载 Web 链接插件
      // 当终端中出现 URL 时，鼠标悬停会显示下划线，点击可在浏览器打开
      this.terminal.loadAddon(new WebLinksAddon());

      // 将终端打开到容器中（开始渲染）
      this.terminal.open(this.container);

      // 监听终端中的用户输入，发送到 Rust 后端的 PTY
      this.terminal.onData((data: string) => {
        this.writeToPty(data);
      });

      // 监听来自 Rust 后端的 PTY 输出事件
      await this.listenPtyOutput();

      // 监听容器大小变化，自动调整终端尺寸
      this.initResizeObserver();

      // 标记为已初始化
      this.initialized = true;

      // 首次适配终端尺寸
      this.fit();

      // 通过 Rust 后端启动 PTY 进程
      await this.startPty();
    } catch (err) {
      console.error('终端初始化失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 8px;">终端初始化失败: ${err}</p>`;
    }
  }

  /**
   * 调整终端尺寸以适应容器大小
   * 
   * 调用 FitAddon 的 fit() 方法重新计算终端的行列数。
   * 如果终端尚未初始化或容器不可见则跳过。
   */
  fit(): void {
    try {
      if (this.fitAddon) {
        this.fitAddon.fit();
      }
    } catch (_e) {
      // 忽略 fit 失败（容器可能尚未渲染完成或不可见）
    }
  }

  /**
   * 向 PTY 写入数据（用户的键盘输入）
   * 
   * 将用户在终端中输入的每个字符发送到 Rust 后端，
   * Rust 后端会将数据写入 PTY 中的 shell 进程。
   * 
   * @param data - 用户输入的字符串（可能是一个字符，也可能是粘贴的多行文本）
   */
  async writeToPty(data: string): Promise<void> {
    if (!this.ptyId) return;
    try {
      await invoke('write_to_pty', {
        ptyId: this.ptyId,
        data: data,
      });
    } catch (e) {
      console.error('写入 PTY 失败:', e);
    }
  }

  /**
   * 监听来自 Rust 后端的 PTY 输出数据
   * 
   * Rust 后端在后台线程中读取 shell 的输出，
   * 通过 'pty-output' 事件推送到前端。
   * 此方法注册一个事件监听器来接收这些输出。
   */
  async listenPtyOutput(): Promise<void> {
    await listen('pty-output', (event: any) => {
      // 检查事件中的 PTY ID 是否匹配当前实例
      // （防止多个终端实例互相干扰）
      if (event.payload && event.payload.ptyId === this.ptyId) {
        // 将 shell 输出写入 xterm.js 显示
        if (this.terminal) {
          this.terminal.write(event.payload.data);
        }
      }
    });
  }

  /**
   * 启动 PTY 进程
   * 
   * 调用 Rust 后端的 start_pty 命令创建伪终端并启动 shell。
   * 返回的 PTY ID 用于后续的写入、调整大小和终止操作。
   */
  async startPty(): Promise<void> {
    try {
      this.ptyId = await invoke<string>('start_pty', {
        workingDir: '',  // 当前暂无打开的仓库，空字符串表示使用默认目录
      });
      console.log(`终端 PTY 已启动: ${this.ptyId}`);
    } catch (e) {
      console.error('启动 PTY 失败:', e);
      // 在终端中显示错误信息（使用 ANSI 转义码设置红色）
      if (this.terminal) {
        this.terminal.writeln('\x1b[31mPTY 启动失败: ' + e + '\x1b[0m');
      }
    }
  }

  /**
   * 根据当前主题获取终端配色
   * 
   * 检查 HTML 根元素上的 data-theme 属性来判断当前主题。
   * 如果 data-theme="light" 则返回亮色配色，否则返回暗色配色。
   * 
   * @returns 终端配色对象
   */
  private getCurrentTheme(): typeof darkTheme {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    return isDark ? darkTheme : lightTheme;
  }

  /**
   * 初始化 ResizeObserver 监听容器大小变化
   * 
   * 当终端面板被拖拽调整大小或窗口大小变化时，
   * ResizeObserver 会触发回调，自动调整终端行列数。
   */
  private initResizeObserver(): void {
    const observer = new ResizeObserver(() => {
      this.fit();
    });
    observer.observe(this.container);
  }

  /**
   * 更新终端配色（主题切换时调用）
   * 
   * 从 App 组件的主题切换逻辑中调用，
   * 保持终端配色与应用整体主题一致。
   */
  updateTheme(): void {
    if (this.terminal) {
      this.terminal.options.theme = this.getCurrentTheme();
    }
  }

  /**
   * 销毁终端实例
   * 
   * 终止 PTY 进程并释放 xterm.js 资源。
   * 在关闭终端面板时调用。
   */
  destroy(): void {
    // 终止 Rust 后端的 PTY 进程
    if (this.ptyId) {
      invoke('kill_pty', { ptyId: this.ptyId }).catch(() => {});
    }
    // 销毁 xterm.js 实例（释放 DOM 和内存资源）
    if (this.terminal) {
      this.terminal.dispose();
    }
    this.initialized = false;
    this.terminal = null;
    this.fitAddon = null;
    this.ptyId = null;
  }
}
