/**
 * Git 安装引导组件
 * 当检测到系统未安装 Git 时，显示引导界面
 * 提供"下载 Git"按钮（打开官网）和"重新检测"按钮
 */

import { invoke } from '@tauri-apps/api/core';
import { t } from '../services/i18n.js';

/** Git 检测结果的数据结构（与 Rust 端 GitCheckResult 对应） */
interface GitCheckResult {
  installed: boolean;
  version: string;
  path: string;
}

export class GitInstaller {
  /** 容器 DOM 元素，引导界面将渲染在此元素内部 */
  private container: HTMLElement;

  /**
   * 构造函数
   * @param container - 引导界面的父容器元素
   */
  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * 检测 Git 安装状态并根据结果显示/隐藏引导界面
   * @returns true 表示已安装，false 表示未安装
   */
  async checkAndHandle(): Promise<boolean> {
    try {
      // 调用 Rust 后端的 Git 检测命令
      const result = await invoke<GitCheckResult>('check_git_installed');
      
      if (result.installed) {
        // Git 已安装，隐藏引导界面
        this.hide();
        // 更新底部状态栏的 Git 版本显示
        this.updateStatusbar(result.version, result.path);
        return true;
      } else {
        // Git 未安装，显示引导界面
        this.show();
        return false;
      }
    } catch (err) {
      console.error('Git 检测失败:', err);
      this.show();
      return false;
    }
  }

  /** 渲染引导界面的 HTML 结构 */
  private show(): void {
    // 如果已经显示了引导界面，就不重复创建
    if (document.getElementById('git-installer')) return;

    // 创建引导卡片并添加到容器中
    const overlay = document.createElement('div');
    overlay.className = 'git-installer-overlay';
    overlay.id = 'git-installer';
    overlay.innerHTML = `
      <div class="git-installer-card">
        <div style="text-align: center; padding: 32px;">
          <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.6;">&#x1F4BB;</div>
          <h2 style="font-size: var(--font-size-2xl); margin-bottom: 12px; color: var(--text-primary);">${t('git.notInstalled.title')}</h2>
          <p style="color: var(--text-secondary); margin-bottom: 24px; line-height: 1.6;">${t('git.notInstalled.message')}</p>
          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn btn-primary" id="btn-download-git">${t('git.notInstalled.downloadButton')}</button>
            <button class="btn" id="btn-retry-git-detect">${t('git.notInstalled.retryButton')}</button>
          </div>
        </div>
      </div>
    `;

    // 添加引导卡片的基础样式
    const style = document.createElement('style');
    style.textContent = `
      .git-installer-overlay { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      .git-installer-card { background: var(--bg-surface); border: 1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); max-width: 400px; width: 90%; }
    `;
    document.head.appendChild(style);

    this.container.innerHTML = '';
    this.container.appendChild(overlay);

    // 绑定按钮事件
    this.bindEvents();
  }

  /** 隐藏引导界面 */
  private hide(): void {
    const el = document.getElementById('git-installer');
    if (el) el.remove();
  }

  /** 绑定引导界面上的按钮事件 */
  private bindEvents(): void {
    // 下载 Git 按钮 → 在系统默认浏览器中打开 Git 官网
    document.getElementById('btn-download-git')?.addEventListener('click', async () => {
      try {
        await invoke('open_external_url', { url: t('git.notInstalled.downloadUrl') });
      } catch (err) {
        console.error('打开下载链接失败:', err);
      }
    });

    // 重新检测按钮 → 再次调用 Git 检测命令
    document.getElementById('btn-retry-git-detect')?.addEventListener('click', async () => {
      await this.checkAndHandle();
    });
  }

  /**
   * 更新底部状态栏的 Git 版本信息
   * @param version - Git 版本号字符串
   * @param path - Git 可执行文件路径
   */
  private updateStatusbar(version: string, path: string): void {
    const statusbarGit = document.getElementById('statusbar-git-version');
    if (statusbarGit) {
      statusbarGit.textContent = `Git: ${version}`;
    }
  }
}
