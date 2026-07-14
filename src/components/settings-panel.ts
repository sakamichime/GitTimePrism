/**
 * 设置面板组件（Settings Panel）
 *
 * 提供应用配置的可视化编辑界面，以模态对话框形式展示。
 * 分为两大类配置：
 * 1. 应用配置（前端配置，存储在 localStorage 中）
 *    - 提交详情视图 / 日期 / 对话框默认值 / 节点图 / 键盘快捷键
 *    - 仓库显示 / 引用标签 / 文件编码 / Markdown / 无障碍
 *    - Issue Linking（提交消息中 #123 转超链接）
 * 2. Git 仓库配置（通过 Tauri IPC 与 Rust 后端交互）
 *    - user.name / user.email（local 和 global 两级）
 *
 * 参考实现：
 * - docs/git/web/settingsWidget.ts（gitgraph 的设置 Widget）
 * - src/components/tag-manager.ts（本项目组件风格参考）
 *
 * 使用方式：
 * ```typescript
 * import { SettingsPanel } from './settings-panel';
 * const panel = new SettingsPanel(repoPath, () => refreshAll());
 * panel.show();
 * ```
 */

import { configService, type RepoConfig } from '../services/config-service.js';
/* Task 13.7：导入 invoke 用于调用后端命令（register_repo/unregister_repo/export_config/add_remote 等） */
import { invoke } from '@tauri-apps/api/core';
/* Task 13.7：导入 PR 工具，用于自动检测 Provider 和解析远程 URL */
import { detectPullRequestProvider, parseRemoteUrl } from '../utils/pr-utils.js';

/**
 * 设置面板组件类
 *
 * 负责创建和管理设置面板的模态对话框 UI，
 * 加载当前配置到表单、收集表单输入并保存。
 */
export class SettingsPanel {
  /** 当前仓库路径（用于 Git 配置的读写） */
  private repoPath: string;
  /** 配置保存成功后的回调函数（用于刷新主界面） */
  private onSuccess: () => void;
  /** 模态对话框的 DOM 容器（遮罩层） */
  private overlay: HTMLElement | null = null;
  /** 从后端加载的 Git 仓库配置（含 user.name/email、remotes 等） */
  private repoConfig: RepoConfig | null = null;

  /**
   * 构造函数
   *
   * @param repoPath - 当前仓库的路径
   * @param onSuccess - 配置保存成功后的回调函数
   */
  constructor(repoPath: string, onSuccess: () => void) {
    this.repoPath = repoPath;
    this.onSuccess = onSuccess;
  }

  /**
   * 显示设置面板
   *
   * 创建模态对话框，加载当前配置，渲染表单。
   */
  async show(): Promise<void> {
    // 创建模态对话框的 DOM 结构
    this.createOverlay();
    // 加载 Git 仓库配置（user.name/email 等）
    await this.loadRepoConfig();
    // 渲染表单（将当前配置填入表单控件）
    this.renderForm();
  }

  /**
   * 创建模态对话框的 DOM 结构
   *
   * 包含遮罩层、对话框容器、左侧分组导航、右侧表单区域、底部按钮栏。
   */
  private createOverlay(): void {
    // 创建遮罩层（覆盖整个窗口，点击可关闭）
    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-panel-overlay';

    // 设置对话框的 HTML 结构
    // - 左侧 navigation：配置分组列表（点击切换右侧显示的分组）
    // - 右侧 content：表单区域（根据选中的分组渲染对应表单）
    // - 底部 footer：保存 / 重置 / 关闭按钮
    this.overlay.innerHTML = `
      <div class="settings-panel-dialog">
        <!-- 对话框头部：标题和关闭按钮 -->
        <div class="settings-panel-header">
          <h2 class="settings-panel-title">⚙ 设置</h2>
          <button class="settings-panel-close-btn" id="settings-close">&times;</button>
        </div>

        <!-- 对话框主体：左侧导航 + 右侧表单 -->
        <div class="settings-panel-body">
          <!-- 左侧分组导航 -->
          <nav class="settings-panel-nav" id="settings-nav">
            <ul>
              <li class="settings-nav-item active" data-section="commit-details">提交详情视图</li>
              <li class="settings-nav-item" data-section="date">日期</li>
              <li class="settings-nav-item" data-section="dialog">对话框默认值</li>
              <li class="settings-nav-item" data-section="graph">节点图</li>
              <li class="settings-nav-item" data-section="keyboard">键盘快捷键</li>
              <li class="settings-nav-item" data-section="repository">仓库显示</li>
              <li class="settings-nav-item" data-section="reference-labels">引用标签</li>
              <li class="settings-nav-item" data-section="encoding">文件编码</li>
              <li class="settings-nav-item" data-section="markdown">Markdown</li>
              <li class="settings-nav-item" data-section="accessibility">无障碍</li>
              <li class="settings-nav-item" data-section="issue-linking">Issue Linking</li>
              <li class="settings-nav-item" data-section="context-menu-visibility">右键菜单可见性</li>
              <li class="settings-nav-item" data-section="git-user">Git 用户身份</li>
              <li class="settings-nav-item" data-section="remote-management">远程仓库管理</li>
              <li class="settings-nav-item" data-section="pr-creation">PR 创建</li>
              <li class="settings-nav-item" data-section="config-export">配置导出</li>
            </ul>
          </nav>

          <!-- 右侧表单区域 -->
          <div class="settings-panel-content" id="settings-content">
            <p class="settings-loading">加载中...</p>
          </div>
        </div>

        <!-- 对话框底部：操作按钮 -->
        <div class="settings-panel-footer">
          <button class="btn btn-secondary" id="settings-reset">重置为默认值</button>
          <div class="settings-panel-footer-right">
            <button class="btn btn-secondary" id="settings-cancel">取消</button>
            <button class="btn btn-primary" id="settings-save">保存</button>
          </div>
        </div>
      </div>
    `;

    // 将对话框添加到页面
    document.body.appendChild(this.overlay);

    // 绑定事件监听器
    this.bindEvents();
  }

  /**
   * 绑定事件监听器
   *
   * 处理关闭按钮、取消按钮、保存按钮、重置按钮、
   * 点击遮罩层关闭、左侧导航切换等交互。
   */
  private bindEvents(): void {
    if (!this.overlay) return;

    // 关闭按钮（右上角 ×）
    this.overlay.querySelector('#settings-close')?.addEventListener('click', () => this.close());

    // 取消按钮（底部）
    this.overlay.querySelector('#settings-cancel')?.addEventListener('click', () => this.close());

    // 点击遮罩层关闭对话框
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.close();
      }
    });

    // 保存按钮 - 收集表单数据并保存
    this.overlay.querySelector('#settings-save')?.addEventListener('click', async () => {
      await this.handleSave();
    });

    // 重置按钮 - 将应用配置重置为默认值
    this.overlay.querySelector('#settings-reset')?.addEventListener('click', () => {
      this.handleReset();
    });

    // 左侧导航项点击 - 切换右侧显示的分组
    const navItems = this.overlay.querySelectorAll('.settings-nav-item');
    navItems.forEach((item) => {
      item.addEventListener('click', () => {
        // 移除所有导航项的 active 类
        navItems.forEach((i) => i.classList.remove('active'));
        // 给当前点击项添加 active 类
        item.classList.add('active');
        // 渲染对应分组的表单
        const section = (item as HTMLElement).dataset.section;
        if (section) {
          this.renderSection(section);
          /* Task 13.7：渲染后为动态生成的按钮绑定事件 */
          this.bindDynamicSectionEvents();
        }
      });
    });

    /* Task 13.7：为动态生成的按钮绑定事件（使用事件委托，监听 content 区域的点击）
     * 这些按钮在切换分组时动态生成，无法在 createOverlay 时绑定 */
    const content = this.overlay.querySelector('#settings-content');
    if (content) {
      content.addEventListener('click', (e: Event) => this.handleDynamicClick(e));
    }
  }

  /**
   * Task 13.7：绑定动态生成按钮的事件
   *
   * 在每次切换分组后调用，为当前分组中的特殊按钮绑定事件。
   * 普通的 data-key 控件由 handleSave 统一处理，无需单独绑定。
   */
  private bindDynamicSectionEvents(): void {
    /* 目前动态按钮通过 handleDynamicClick 事件委托处理，
     * 此方法保留用于未来需要直接绑定的特殊控件 */
  }

  /**
   * Task 13.7：处理动态按钮的点击事件（事件委托）
   *
   * 根据点击的按钮 ID 或 data 属性分发到对应的处理方法：
   * - #il-auto-detect：Issue Linking 自动检测
   * - #pr-auto-detect：PR Provider 自动检测
   * - #config-export-btn：配置导出
   * - #remote-add-btn：添加远程仓库
   * - [data-git-unset-key]：删除 Git 配置项
   * - [data-remote-action]：远程仓库操作（fetch/prune/edit/delete）
   *
   * @param e - 点击事件对象
   */
  private async handleDynamicClick(e: Event): Promise<void> {
    const target = e.target as HTMLElement;
    if (!target) return;

    /* 查找被点击的按钮元素（可能是按钮本身或按钮内的子元素） */
    const btn = target.closest('button') as HTMLButtonElement | null;
    if (!btn) return;

    /* 处理 Git 配置删除按钮（data-git-unset-key 属性标识） */
    const unsetKey = btn.dataset.gitUnsetKey;
    if (unsetKey) {
      e.preventDefault();
      e.stopPropagation();
      await this.handleGitUnset(unsetKey, btn.dataset.gitUnsetLocation || 'local', btn.dataset.gitUnsetInput || '');
      return;
    }

    /* 处理远程仓库操作按钮（data-remote-action 属性标识） */
    const remoteAction = btn.dataset.remoteAction;
    if (remoteAction) {
      e.preventDefault();
      e.stopPropagation();
      const remoteName = btn.dataset.remoteName || '';
      await this.handleRemoteAction(remoteAction, remoteName);
      return;
    }

    /* 根据按钮 ID 分发到对应的处理方法 */
    const btnId = btn.id;
    switch (btnId) {
      case 'il-auto-detect':
        e.preventDefault();
        await this.handleIssueLinkingAutoDetect();
        break;
      case 'pr-auto-detect':
        e.preventDefault();
        await this.handlePrAutoDetect();
        break;
      case 'config-export-btn':
        e.preventDefault();
        await this.handleConfigExport();
        break;
      case 'remote-add-btn':
        e.preventDefault();
        await this.handleRemoteAdd();
        break;
    }
  }

  /**
   * Task 13.7：处理 Git 配置删除
   *
   * 调用 configService.unsetConfigValue 删除指定的 Git 配置项，
   * 然后清空对应的输入框。
   *
   * @param key - Git 配置键名（如 user.name / user.email）
   * @param location - 配置位置（local 或 global）
   * @param inputId - 对应输入框的 DOM ID（用于清空显示）
   */
  private async handleGitUnset(key: string, location: string, inputId: string): Promise<void> {
    /* 确认对话框 - 删除配置是不可逆操作 */
    const confirmed: boolean = confirm(`确定要删除 ${location} 级的 ${key} 配置吗？\n\n此操作执行 git config --unset，不可撤销。`);
    if (!confirmed) return;

    try {
      /* 调用 configService 删除配置项 */
      await configService.unsetConfigValue(this.repoPath, key, location as 'local' | 'global');
      console.log(`[SettingsPanel] 已删除 ${location} 级配置: ${key}`);

      /* 清空对应输入框的显示 */
      if (inputId) {
        const input = this.overlay?.querySelector(`#${inputId}`) as HTMLInputElement | null;
        if (input) input.value = '';
      }

      alert(`已删除 ${location} 级的 ${key} 配置`);
    } catch (err) {
      console.error('[SettingsPanel] 删除 Git 配置失败:', err);
      alert(`删除配置失败: ${String(err)}`);
    }
  }

  /**
   * Task 13.7：处理 Issue Linking 自动检测
   *
   * 根据当前仓库的远程 URL 自动推断 Issue URL 模板。
   * 支持 GitHub / GitLab / Bitbucket 三种平台。
   */
  private async handleIssueLinkingAutoDetect(): Promise<void> {
    try {
      /* 获取第一个远程仓库的 URL（通常是 origin） */
      const remotes = this.repoConfig?.remotes ?? [];
      if (remotes.length === 0) {
        alert('当前仓库没有配置远程仓库，无法自动检测 Issue URL。');
        return;
      }

      /* 优先使用 origin，否则使用第一个远程 */
      const origin = remotes.find(r => r.name === 'origin') || remotes[0];
      const remoteUrl = origin.url || origin.push_url;
      if (!remoteUrl) {
        alert('远程仓库没有配置 URL，无法自动检测。');
        return;
      }

      /* 解析远程 URL，提取 owner 和 repo */
      const parsed = parseRemoteUrl(remoteUrl);
      if (!parsed || !parsed.owner || !parsed.repo) {
        alert(`无法解析远程 URL: ${remoteUrl}\n请手动填写 Issue URL 模板。`);
        return;
      }

      /* 检测 PR Provider 以确定平台 */
      const provider = detectPullRequestProvider(remoteUrl);
      let issueUrlTemplate = '';
      switch (provider) {
        case 'github':
          issueUrlTemplate = `https://github.com/${parsed.owner}/${parsed.repo}/issues/$1`;
          break;
        case 'gitlab':
          issueUrlTemplate = `https://gitlab.com/${parsed.owner}/${parsed.repo}/issues/$1`;
          break;
        case 'bitbucket':
          issueUrlTemplate = `https://bitbucket.org/${parsed.owner}/${parsed.repo}/issues/$1`;
          break;
        default:
          alert(`无法识别的远程 URL 平台: ${remoteUrl}\n请手动填写 Issue URL 模板。`);
          return;
      }

      /* 填充 Issue URL 输入框 */
      const urlInput = this.overlay?.querySelector('#il-url') as HTMLInputElement | null;
      if (urlInput) {
        urlInput.value = issueUrlTemplate;
      }
      /* 保存到配置（立即生效） */
      configService.setAppConfigValue('issueLinkingUrl', issueUrlTemplate);

      alert(`已自动检测到 ${provider} 平台\nIssue URL 模板: ${issueUrlTemplate}`);
    } catch (err) {
      console.error('[SettingsPanel] 自动检测 Issue URL 失败:', err);
      alert(`自动检测失败: ${String(err)}`);
    }
  }

  /**
   * Task 13.7：处理 PR Provider 自动检测
   *
   * 根据当前仓库的远程 URL 自动推断 PR 提供商，
   * 并更新下拉选择框的值。
   */
  private async handlePrAutoDetect(): Promise<void> {
    try {
      const remotes = this.repoConfig?.remotes ?? [];
      if (remotes.length === 0) {
        alert('当前仓库没有配置远程仓库，无法自动检测 PR Provider。');
        return;
      }

      const origin = remotes.find(r => r.name === 'origin') || remotes[0];
      const remoteUrl = origin.url || origin.push_url;
      if (!remoteUrl) {
        alert('远程仓库没有配置 URL，无法自动检测。');
        return;
      }

      const provider = detectPullRequestProvider(remoteUrl);
      if (provider === 'custom') {
        alert(`无法识别的远程 URL 平台: ${remoteUrl}\n请手动选择 PR 提供商。`);
        return;
      }

      /* 更新下拉选择框的值 */
      const providerSelect = this.overlay?.querySelector('#pr-provider') as HTMLSelectElement | null;
      if (providerSelect) {
        providerSelect.value = provider;
      }
      /* 保存到配置 */
      configService.setAppConfigValue('prCreation.provider', provider);

      alert(`已自动检测到 PR 提供商: ${provider}`);
    } catch (err) {
      console.error('[SettingsPanel] 自动检测 PR Provider 失败:', err);
      alert(`自动检测失败: ${String(err)}`);
    }
  }

  /**
   * Task 13.7：处理配置导出
   *
   * 调用后端 export_config 命令，将当前仓库的配置导出为 JSON 文件。
   */
  private async handleConfigExport(): Promise<void> {
    try {
      /* 调用后端 export_config 命令
       * 参数：repoPath（仓库路径）、outputPath（输出文件路径，使用仓库根目录下的 .gittimeprism.json） */
      const outputPath = '.gittimeprism.json';
      await invoke('export_config', { repoPath: this.repoPath, outputPath });
      alert(`配置已导出到: ${outputPath}`);
    } catch (err) {
      console.error('[SettingsPanel] 导出配置失败:', err);
      alert(`导出配置失败: ${String(err)}`);
    }
  }

  /**
   * Task 13.7：处理添加远程仓库
   *
   * 弹出表单让用户输入远程仓库名和 URL，然后调用后端 add_remote 命令。
   */
  private async handleRemoteAdd(): Promise<void> {
    /* 使用 prompt 获取远程仓库名和 URL（简化实现） */
    const name = prompt('请输入远程仓库名（如 origin）:');
    if (!name || !name.trim()) return;
    const url = prompt('请输入远程仓库 URL（HTTPS 或 SSH）:');
    if (!url || !url.trim()) return;

    try {
      /* 调用后端 add_remote 命令添加远程仓库 */
      await invoke('add_remote', { repoPath: this.repoPath, name: name.trim(), url: url.trim() });
      alert(`已添加远程仓库: ${name.trim()}`);
      /* 重新加载仓库配置并刷新远程列表 */
      await this.loadRepoConfig();
      this.renderSection('remote-management');
      this.bindDynamicSectionEvents();
    } catch (err) {
      console.error('[SettingsPanel] 添加远程仓库失败:', err);
      alert(`添加远程仓库失败: ${String(err)}`);
    }
  }

  /**
   * Task 13.7：处理远程仓库操作（fetch/prune/edit/delete）
   *
   * @param action - 操作类型：'fetch' / 'prune' / 'edit' / 'delete'
   * @param remoteName - 远程仓库名
   */
  private async handleRemoteAction(action: string, remoteName: string): Promise<void> {
    if (!remoteName) return;

    try {
      switch (action) {
        case 'fetch': {
          /* Fetch：从远程仓库拉取更新（不合并） */
          await invoke('fetch_command', { repoPath: this.repoPath, remote: remoteName });
          alert(`已从 ${remoteName} 获取更新`);
          break;
        }
        case 'prune': {
          /* Prune：清理失效的远程引用 */
          await invoke('prune_remote', { repoPath: this.repoPath, remote: remoteName });
          alert(`已清理 ${remoteName} 的失效引用`);
          break;
        }
        case 'edit': {
          /* 编辑：弹出表单修改远程 URL */
          const newUrl = prompt(`修改 ${remoteName} 的 URL:`, '');
          if (!newUrl || !newUrl.trim()) return;
          await invoke('edit_remote', { repoPath: this.repoPath, name: remoteName, url: newUrl.trim() });
          alert(`已更新 ${remoteName} 的 URL`);
          break;
        }
        case 'delete': {
          /* 删除：确认后删除远程仓库 */
          const confirmed = confirm(`确定要删除远程仓库 "${remoteName}" 吗？`);
          if (!confirmed) return;
          await invoke('delete_remote', { repoPath: this.repoPath, name: remoteName });
          alert(`已删除远程仓库: ${remoteName}`);
          break;
        }
      }

      /* 操作完成后重新加载配置并刷新远程列表 */
      await this.loadRepoConfig();
      this.renderSection('remote-management');
      this.bindDynamicSectionEvents();
    } catch (err) {
      console.error(`[SettingsPanel] 远程仓库 ${action} 操作失败:`, err);
      alert(`操作失败: ${String(err)}`);
    }
  }

  /**
   * 加载 Git 仓库配置
   *
   * 调用 configService 从后端获取仓库配置（user.name/email、remotes 等）。
   * 加载失败时不阻塞面板显示，仅打印警告。
   */
  private async loadRepoConfig(): Promise<void> {
    try {
      this.repoConfig = await configService.loadRepoConfig(this.repoPath);
    } catch (err) {
      // 加载失败不阻塞面板，Git 用户身份部分会显示错误信息
      console.warn('[SettingsPanel] 加载 Git 仓库配置失败:', err);
      this.repoConfig = null;
    }
  }

  /**
   * 渲染表单
   *
   * 默认渲染第一个分组（提交详情视图）。
   */
  private renderForm(): void {
    this.renderSection('commit-details');
  }

  /**
   * 渲染指定分组的表单
   *
   * 根据分组名称调用对应的渲染方法。
   *
   * @param section - 分组标识符
   */
  private renderSection(section: string): void {
    const content = this.overlay?.querySelector('#settings-content');
    if (!content) return;

    // 根据分组名称调用对应的渲染方法
    switch (section) {
      case 'commit-details':
        content.innerHTML = this.renderCommitDetailsSection();
        break;
      case 'date':
        content.innerHTML = this.renderDateSection();
        break;
      case 'dialog':
        content.innerHTML = this.renderDialogSection();
        break;
      case 'graph':
        content.innerHTML = this.renderGraphSection();
        break;
      case 'keyboard':
        content.innerHTML = this.renderKeyboardSection();
        break;
      case 'repository':
        content.innerHTML = this.renderRepositorySection();
        break;
      case 'reference-labels':
        content.innerHTML = this.renderReferenceLabelsSection();
        break;
      case 'encoding':
        content.innerHTML = this.renderEncodingSection();
        break;
      case 'markdown':
        content.innerHTML = this.renderMarkdownSection();
        break;
      case 'accessibility':
        content.innerHTML = this.renderAccessibilitySection();
        break;
      case 'issue-linking':
        content.innerHTML = this.renderIssueLinkingSection();
        break;
      case 'context-menu-visibility':
        content.innerHTML = this.renderContextMenuVisibilitySection();
        break;
      case 'git-user':
        content.innerHTML = this.renderGitUserSection();
        break;
      case 'remote-management':
        content.innerHTML = this.renderRemoteManagementSection();
        break;
      case 'pr-creation':
        content.innerHTML = this.renderPrCreationSection();
        break;
      case 'config-export':
        content.innerHTML = this.renderConfigExportSection();
        break;
      default:
        content.innerHTML = '<p class="settings-error">未知分组</p>';
    }
  }

  /* ====================================================================== *
   * 以下为各分组的表单 HTML 渲染方法
   * 每个方法返回一个 HTML 字符串，包含表单控件（输入框/复选框/单选/下拉）
   * 控件的初始值从 configService.getAppConfig() 读取
   * 控件的 data-key 属性指定对应的配置路径（点分路径，如 'date.format'）
   * ====================================================================== */

  /**
   * 渲染"提交详情视图"分组
   *
   * 配置项：
   * - autoCenter：是否自动居中
   * - fileTreeCompactFolders：是否启用紧凑文件夹
   * - fileViewType：文件视图类型（tree/list）
   * - location：面板位置（inline/docked）
   */
  private renderCommitDetailsSection(): string {
    const cfg = configService.getAppConfig().commitDetailsView;
    return `
      <h3 class="settings-section-title">提交详情视图</h3>
      <p class="settings-section-desc">控制提交详情面板的显示行为。</p>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="commitDetailsView.autoCenter" ${cfg.autoCenter ? 'checked' : ''}>
          <span>自动滚动到居中位置</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="commitDetailsView.fileTreeCompactFolders" ${cfg.fileTreeCompactFolders ? 'checked' : ''}>
          <span>文件树启用紧凑文件夹（合并单子文件夹）</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="cdv-file-view">文件视图类型</label>
        <select class="form-select" id="cdv-file-view" data-key="commitDetailsView.fileViewType">
          <option value="tree" ${cfg.fileViewType === 'tree' ? 'selected' : ''}>文件树 (Tree)</option>
          <option value="list" ${cfg.fileViewType === 'list' ? 'selected' : ''}>文件列表 (List)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="cdv-location">面板位置</label>
        <select class="form-select" id="cdv-location" data-key="commitDetailsView.location">
          <option value="inline" ${cfg.location === 'inline' ? 'selected' : ''}>内联 (Inline)</option>
          <option value="docked" ${cfg.location === 'docked' ? 'selected' : ''}>停靠 (Docked)</option>
        </select>
      </div>
    `;
  }

  /**
   * 渲染"日期"分组
   *
   * 配置项：
   * - format：日期格式（relative/dateOnly/dateAndTime）
   * - iso：是否使用 ISO 格式
   * - type：日期类型（authorDate/commitDate）
   */
  private renderDateSection(): string {
    const cfg = configService.getAppConfig().date;
    return `
      <h3 class="settings-section-title">日期</h3>
      <p class="settings-section-desc">控制提交日期的显示格式和类型。</p>

      <div class="form-group">
        <label class="form-label" for="date-format">日期格式</label>
        <select class="form-select" id="date-format" data-key="date.format">
          <option value="relative" ${cfg.format === 'relative' ? 'selected' : ''}>相对时间（如 "3 小时前"）</option>
          <option value="dateOnly" ${cfg.format === 'dateOnly' ? 'selected' : ''}>仅日期</option>
          <option value="dateAndTime" ${cfg.format === 'dateAndTime' ? 'selected' : ''}>日期和时间</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="date.iso" ${cfg.iso ? 'checked' : ''}>
          <span>使用 ISO 格式</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label">日期类型</label>
        <div class="form-radio-group">
          <label class="form-radio">
            <input type="radio" name="date-type" data-key="date.type" value="authorDate" ${cfg.type === 'authorDate' ? 'checked' : ''}>
            <span>作者日期 (Author Date)</span>
          </label>
          <label class="form-radio">
            <input type="radio" name="date-type" data-key="date.type" value="commitDate" ${cfg.type === 'commitDate' ? 'checked' : ''}>
            <span>提交日期 (Commit Date)</span>
          </label>
        </div>
      </div>
    `;
  }

  /**
   * 渲染"对话框默认值"分组
   *
   * 配置项：resetCommitMode / resetUncommittedMode / createBranchCheckout /
   * deleteBranchForce / addTagPushToRemote / addTagType / fetchRemotePrune /
   * fetchRemotePruneTags / mergeNoCommit / mergeNoFastForward / mergeSquash /
   * pullNoFastForward / pullSquash / stashIncludeUntracked / stashReinstateIndex
   */
  private renderDialogSection(): string {
    const cfg = configService.getAppConfig().dialog;
    return `
      <h3 class="settings-section-title">对话框默认值</h3>
      <p class="settings-section-desc">控制各类操作对话框打开时的默认选项。</p>

      <div class="form-group">
        <label class="form-label" for="dlg-reset-commit">重置提交默认模式</label>
        <select class="form-select" id="dlg-reset-commit" data-key="dialog.resetCommitMode">
          <option value="soft" ${cfg.resetCommitMode === 'soft' ? 'selected' : ''}>Soft（保留暂存区）</option>
          <option value="mixed" ${cfg.resetCommitMode === 'mixed' ? 'selected' : ''}>Mixed（重置暂存区，保留工作区）</option>
          <option value="hard" ${cfg.resetCommitMode === 'hard' ? 'selected' : ''}>Hard（重置暂存区和工作区）</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="dlg-reset-uncommitted">重置未提交变更默认模式</label>
        <select class="form-select" id="dlg-reset-uncommitted" data-key="dialog.resetUncommittedMode">
          <option value="mixed" ${cfg.resetUncommittedMode === 'mixed' ? 'selected' : ''}>Mixed（保留工作区修改）</option>
          <option value="hard" ${cfg.resetUncommittedMode === 'hard' ? 'selected' : ''}>Hard（丢弃工作区修改）</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.createBranchCheckout" ${cfg.createBranchCheckout ? 'checked' : ''}>
          <span>创建分支时默认切换到新分支</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.deleteBranchForce" ${cfg.deleteBranchForce ? 'checked' : ''}>
          <span>删除分支时默认使用强制删除 (-D)</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="dlg-tag-type">创建标签默认类型</label>
        <select class="form-select" id="dlg-tag-type" data-key="dialog.addTagType">
          <option value="annotated" ${cfg.addTagType === 'annotated' ? 'selected' : ''}>附注标签 (Annotated)</option>
          <option value="lightweight" ${cfg.addTagType === 'lightweight' ? 'selected' : ''}>轻量标签 (Lightweight)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.addTagPushToRemote" ${cfg.addTagPushToRemote ? 'checked' : ''}>
          <span>创建标签时默认推送到远程</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.fetchRemotePrune" ${cfg.fetchRemotePrune ? 'checked' : ''}>
          <span>Fetch 时默认启用 prune</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.fetchRemotePruneTags" ${cfg.fetchRemotePruneTags ? 'checked' : ''}>
          <span>Fetch 时默认启用 prune-tags</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.mergeNoCommit" ${cfg.mergeNoCommit ? 'checked' : ''}>
          <span>合并时默认启用 --no-commit</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.mergeNoFastForward" ${cfg.mergeNoFastForward ? 'checked' : ''}>
          <span>合并时默认启用 --no-ff</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.mergeSquash" ${cfg.mergeSquash ? 'checked' : ''}>
          <span>合并时默认启用 squash</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.pullNoFastForward" ${cfg.pullNoFastForward ? 'checked' : ''}>
          <span>拉取时默认启用 --no-ff</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.pullSquash" ${cfg.pullSquash ? 'checked' : ''}>
          <span>拉取时默认启用 squash</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.stashIncludeUntracked" ${cfg.stashIncludeUntracked ? 'checked' : ''}>
          <span>Stash 时默认包含未跟踪文件</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="dialog.stashReinstateIndex" ${cfg.stashReinstateIndex ? 'checked' : ''}>
          <span>Apply/Pop stash 时默认恢复暂存区状态 (--index)</span>
        </label>
      </div>
    `;
  }

  /**
   * 渲染"节点图"分组
   *
   * 配置项：
   * - colours：分支颜色列表
   * - style：图形样式（rounded/angular）
   * - uncommittedChanges：未提交变更显示样式
   */
  private renderGraphSection(): string {
    const cfg = configService.getAppConfig().graph;
    return `
      <h3 class="settings-section-title">节点图</h3>
      <p class="settings-section-desc">控制提交节点图的视觉样式。</p>

      <div class="form-group">
        <label class="form-label" for="graph-style">图形样式</label>
        <select class="form-select" id="graph-style" data-key="graph.style">
          <option value="rounded" ${cfg.style === 'rounded' ? 'selected' : ''}>圆角曲线 (Rounded)</option>
          <option value="angular" ${cfg.style === 'angular' ? 'selected' : ''}>折线 (Angular)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="graph-uncommitted">未提交变更显示</label>
        <select class="form-select" id="graph-uncommitted" data-key="graph.uncommittedChanges">
          <option value="openCircleAtUncommitted" ${cfg.uncommittedChanges === 'openCircleAtUncommitted' ? 'selected' : ''}>在未提交变更处显示空心圆</option>
          <option value="openCircleAtCheckedOut" ${cfg.uncommittedChanges === 'openCircleAtCheckedOut' ? 'selected' : ''}>在当前检出提交处显示空心圆</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="graph-colours">分支颜色列表</label>
        <input type="text" class="form-input" id="graph-colours"
               data-key="graph.colours"
               value="${cfg.colours.join(', ')}"
               placeholder="以逗号分隔的 CSS 颜色值">
        <p class="form-hint">以英文逗号分隔的 CSS 颜色值，如 #0085d9, #d9008f, #00d90a</p>
      </div>
    `;
  }

  /**
   * 渲染"键盘快捷键"分组（Task 11.3 扩展）
   *
   * 配置项：find / refresh / scrollToHead / scrollToStash / scrollToPrevStash /
   * navigateUp / navigateDown / navigateSameBranchUp / navigateSameBranchDown /
   * navigateAltBranchUp / navigateAltBranchDown / commitDialog / closeOverlay / toggleTerminal
   *
   * 快捷键格式：
   *   - "Ctrl+F"：Ctrl/Cmd + 字母
   *   - "Ctrl+Shift+S"：Ctrl/Cmd + Shift + 字母
   *   - "Up" / "Down"：方向键
   *   - "Enter" / "Escape"：单键
   * 留空表示禁用。
   */
  private renderKeyboardSection(): string {
    const cfg = configService.getAppConfig().keyboardShortcuts;
    return `
      <h3 class="settings-section-title">键盘快捷键</h3>
      <p class="settings-section-desc">配置快捷键。格式：Ctrl+F / Ctrl+Shift+S / Up / Down / Enter / Escape。留空表示禁用。</p>

      <div class="form-group">
        <label class="form-label" for="kb-find">查找</label>
        <input type="text" class="form-input" id="kb-find" data-key="keyboardShortcuts.find"
               value="${cfg.find ?? ''}" placeholder="如 Ctrl+F">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-refresh">刷新节点图</label>
        <input type="text" class="form-input" id="kb-refresh" data-key="keyboardShortcuts.refresh"
               value="${cfg.refresh ?? ''}" placeholder="如 Ctrl+R">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-scroll-head">滚动到 HEAD</label>
        <input type="text" class="form-input" id="kb-scroll-head" data-key="keyboardShortcuts.scrollToHead"
               value="${cfg.scrollToHead ?? ''}" placeholder="如 Ctrl+H">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-scroll-stash">滚动到第一个 Stash</label>
        <input type="text" class="form-input" id="kb-scroll-stash" data-key="keyboardShortcuts.scrollToStash"
               value="${cfg.scrollToStash ?? ''}" placeholder="如 Ctrl+S">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-scroll-prev-stash">滚动到上一个 Stash</label>
        <input type="text" class="form-input" id="kb-scroll-prev-stash" data-key="keyboardShortcuts.scrollToPrevStash"
               value="${cfg.scrollToPrevStash ?? ''}" placeholder="如 Ctrl+Shift+S">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-navigate-up">上一个提交</label>
        <input type="text" class="form-input" id="kb-navigate-up" data-key="keyboardShortcuts.navigateUp"
               value="${cfg.navigateUp ?? ''}" placeholder="如 Up">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-navigate-down">下一个提交</label>
        <input type="text" class="form-input" id="kb-navigate-down" data-key="keyboardShortcuts.navigateDown"
               value="${cfg.navigateDown ?? ''}" placeholder="如 Down">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-same-branch-up">沿同一分支向上导航</label>
        <input type="text" class="form-input" id="kb-same-branch-up" data-key="keyboardShortcuts.navigateSameBranchUp"
               value="${cfg.navigateSameBranchUp ?? ''}" placeholder="如 Ctrl+Up">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-same-branch-down">沿同一分支向下导航</label>
        <input type="text" class="form-input" id="kb-same-branch-down" data-key="keyboardShortcuts.navigateSameBranchDown"
               value="${cfg.navigateSameBranchDown ?? ''}" placeholder="如 Ctrl+Down">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-alt-branch-up">沿替代分支向上导航</label>
        <input type="text" class="form-input" id="kb-alt-branch-up" data-key="keyboardShortcuts.navigateAltBranchUp"
               value="${cfg.navigateAltBranchUp ?? ''}" placeholder="如 Ctrl+Shift+Up">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-alt-branch-down">沿替代分支向下导航</label>
        <input type="text" class="form-input" id="kb-alt-branch-down" data-key="keyboardShortcuts.navigateAltBranchDown"
               value="${cfg.navigateAltBranchDown ?? ''}" placeholder="如 Ctrl+Shift+Down">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-commit-dialog">打开提交对话框</label>
        <input type="text" class="form-input" id="kb-commit-dialog" data-key="keyboardShortcuts.commitDialog"
               value="${cfg.commitDialog ?? ''}" placeholder="如 Enter">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-close-overlay">关闭菜单/对话框</label>
        <input type="text" class="form-input" id="kb-close-overlay" data-key="keyboardShortcuts.closeOverlay"
               value="${cfg.closeOverlay ?? ''}" placeholder="如 Escape">
      </div>

      <div class="form-group">
        <label class="form-label" for="kb-toggle-terminal">切换终端面板</label>
        <input type="text" class="form-input" id="kb-toggle-terminal" data-key="keyboardShortcuts.toggleTerminal"
               value="${cfg.toggleTerminal ?? ''}" placeholder="如 Ctrl+\`">
      </div>
    `;
  }

  /**
   * 渲染"仓库显示"分组
   *
   * 配置项：initialLoadCommits / loadMoreCommits / loadMoreCommitsAutomatically /
   * showTags / showRemoteBranches / showStashes / showUncommittedChanges /
   * showUntrackedFiles / onlyFollowFirstParent / commitOrder /
   * onLoadScrollToHead / onLoadShowCheckedOutBranch
   *
   * Task 13.7：新增 showReflogs 复选框和 initialBranch 初始分支配置
   */
  private renderRepositorySection(): string {
    const cfg = configService.getAppConfig().repository;
    return `
      <h3 class="settings-section-title">仓库显示</h3>
      <p class="settings-section-desc">控制仓库加载和节点图显示行为。</p>

      <div class="form-group">
        <label class="form-label" for="repo-initial-load">初始加载提交数量</label>
        <input type="number" class="form-input" id="repo-initial-load"
               data-key="repository.initialLoadCommits"
               value="${cfg.initialLoadCommits}" min="10" max="10000" step="50">
      </div>

      <div class="form-group">
        <label class="form-label" for="repo-load-more">每次加载更多数量</label>
        <input type="number" class="form-input" id="repo-load-more"
               data-key="repository.loadMoreCommits"
               value="${cfg.loadMoreCommits}" min="10" max="5000" step="10">
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.loadMoreCommitsAutomatically" ${cfg.loadMoreCommitsAutomatically ? 'checked' : ''}>
          <span>滚动到底部时自动加载更多</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-label" for="repo-commit-order">提交排序方式</label>
        <select class="form-select" id="repo-commit-order" data-key="repository.commitOrder">
          <option value="date" ${cfg.commitOrder === 'date' ? 'selected' : ''}>按日期 (date)</option>
          <option value="author-date" ${cfg.commitOrder === 'author-date' ? 'selected' : ''}>按作者日期 (author-date)</option>
          <option value="topo" ${cfg.commitOrder === 'topo' ? 'selected' : ''}>拓扑排序 (topo)</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.showTags" ${cfg.showTags ? 'checked' : ''}>
          <span>显示标签</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.showRemoteBranches" ${cfg.showRemoteBranches ? 'checked' : ''}>
          <span>显示远程分支</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.showStashes" ${cfg.showStashes ? 'checked' : ''}>
          <span>显示 Stash</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.showUncommittedChanges" ${cfg.showUncommittedChanges ? 'checked' : ''}>
          <span>显示未提交变更</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.showUntrackedFiles" ${cfg.showUntrackedFiles ? 'checked' : ''}>
          <span>显示未跟踪文件</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.onlyFollowFirstParent" ${cfg.onlyFollowFirstParent ? 'checked' : ''}>
          <span>只跟随第一个父提交 (--first-parent)</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.onLoadScrollToHead" ${cfg.onLoadScrollToHead ? 'checked' : ''}>
          <span>加载时滚动到 HEAD</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.onLoadShowCheckedOutBranch" ${cfg.onLoadShowCheckedOutBranch ? 'checked' : ''}>
          <span>加载时显示当前检出分支</span>
        </label>
      </div>

      <!-- Task 13.7：新增 Show Reflogs 复选框 - 控制是否在节点图中显示 reflog 记录 -->
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.showReflogs" ${cfg.showReflogs ? 'checked' : ''}>
          <span>显示 Reflog（本地操作历史）</span>
        </label>
        <p class="form-hint">启用后，git reflog 记录的本地操作（如 commit/checkout/reset）会显示在节点图中。</p>
      </div>

      <!-- Task 13.7：新增初始分支配置 - 新建仓库时默认创建的分支名 -->
      <div class="form-group">
        <label class="form-label" for="repo-initial-branch">初始分支名</label>
        <input type="text" class="form-input" id="repo-initial-branch"
               data-key="repository.initialBranch"
               value="${this.escapeAttr(cfg.initialBranch)}"
               placeholder="留空使用 Git 默认值（main 或 master）">
        <p class="form-hint">新建仓库（git init）时默认创建的分支名。留空则使用 Git 安装的默认值。</p>
      </div>
    `;
  }

  /**
   * 渲染"引用标签"分组
   *
   * 配置项：branchLabelsAlignedToGraph / combineLocalAndRemoteBranchLabels / tagLabelsOnRight
   */
  private renderReferenceLabelsSection(): string {
    const cfg = configService.getAppConfig().referenceLabels;
    return `
      <h3 class="settings-section-title">引用标签</h3>
      <p class="settings-section-desc">控制分支和标签标签的显示方式。</p>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="referenceLabels.branchLabelsAlignedToGraph" ${cfg.branchLabelsAlignedToGraph ? 'checked' : ''}>
          <span>分支标签对齐到图形</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="referenceLabels.combineLocalAndRemoteBranchLabels" ${cfg.combineLocalAndRemoteBranchLabels ? 'checked' : ''}>
          <span>合并本地和远程分支标签</span>
        </label>
      </div>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="referenceLabels.tagLabelsOnRight" ${cfg.tagLabelsOnRight ? 'checked' : ''}>
          <span>标签显示在右侧</span>
        </label>
      </div>
    `;
  }

  /**
   * 渲染"文件编码"分组
   *
   * 配置项：fileEncoding（如 utf8 / gbk / shift_jis）
   */
  private renderEncodingSection(): string {
    const cfg = configService.getAppConfig().fileEncoding;
    return `
      <h3 class="settings-section-title">文件编码</h3>
      <p class="settings-section-desc">控制读取文件内容时使用的字符编码。</p>

      <div class="form-group">
        <label class="form-label" for="encoding-select">文件编码</label>
        <select class="form-select" id="encoding-select" data-key="fileEncoding">
          <option value="utf8" ${cfg === 'utf8' ? 'selected' : ''}>UTF-8</option>
          <option value="gbk" ${cfg === 'gbk' ? 'selected' : ''}>GBK（简体中文）</option>
          <option value="big5" ${cfg === 'big5' ? 'selected' : ''}>Big5（繁体中文）</option>
          <option value="shift_jis" ${cfg === 'shift_jis' ? 'selected' : ''}>Shift-JIS（日文）</option>
          <option value="euc_kr" ${cfg === 'euc_kr' ? 'selected' : ''}>EUC-KR（韩文）</option>
          <option value="latin1" ${cfg === 'latin1' ? 'selected' : ''}>Latin-1（西欧）</option>
        </select>
        <p class="form-hint">用于读取文件内容（如查看文件、diff 显示等）时的字符解码。</p>
      </div>
    `;
  }

  /**
   * 渲染"Markdown"分组
   *
   * 配置项：markdown（是否渲染提交消息中的 Markdown 语法）
   */
  private renderMarkdownSection(): string {
    const cfg = configService.getAppConfig().markdown;
    return `
      <h3 class="settings-section-title">Markdown</h3>
      <p class="settings-section-desc">控制提交消息中 Markdown 语法的渲染。</p>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="markdown" ${cfg ? 'checked' : ''}>
          <span>渲染提交消息中的 Markdown 语法</span>
        </label>
        <p class="form-hint">启用后，提交消息中的 <code>**bold**</code>、<code>*italic*</code>、<code>\`code\`</code> 等语法会被渲染为对应样式。</p>
      </div>
    `;
  }

  /**
   * 渲染"无障碍"分组
   *
   * 配置项：enhancedAccessibility（是否启用增强无障碍模式）
   */
  private renderAccessibilitySection(): string {
    const cfg = configService.getAppConfig().enhancedAccessibility;
    return `
      <h3 class="settings-section-title">增强无障碍</h3>
      <p class="settings-section-desc">为视障用户增强界面的可访问性。</p>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="enhancedAccessibility" ${cfg ? 'checked' : ''}>
          <span>启用增强无障碍模式</span>
        </label>
        <p class="form-hint">启用后会提高对比度、增大字体、添加更多 ARIA 标签等。</p>
      </div>
    `;
  }

  /**
   * 渲染"Issue Linking"分组
   *
   * 配置项：issueLinking / issueLinkingPattern / issueLinkingUrl
   * 启用后，提交消息中匹配正则的内容会转为超链接。
   *
   * Task 13.7：新增"Use Globally"复选框和"自动检测"按钮
   * - Use Globally：控制 Issue Linking 配置是否对所有仓库生效
   * - 自动检测：根据远程仓库 URL 自动推断 Issue URL 模板
   */
  private renderIssueLinkingSection(): string {
    const cfg = configService.getAppConfig();
    return `
      <h3 class="settings-section-title">Issue Linking</h3>
      <p class="settings-section-desc">将提交消息中的 issue 编号自动转为可点击的超链接。</p>

      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="issueLinking" ${cfg.issueLinking ? 'checked' : ''}>
          <span>启用 Issue Linking</span>
        </label>
      </div>

      <!-- Task 13.7：Use Globally 复选框 - 控制 Issue Linking 配置是否对所有仓库生效 -->
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="issueLinkingUseGlobally" ${cfg.issueLinkingUseGlobally ? 'checked' : ''}>
          <span>全局使用此配置（对所有仓库生效）</span>
        </label>
        <p class="form-hint">勾选后，此 Issue Linking 配置对所有仓库生效；不勾选则仅对当前仓库生效。</p>
      </div>

      <div class="form-group">
        <label class="form-label" for="il-pattern">Issue 正则表达式</label>
        <input type="text" class="form-input" id="il-pattern"
               data-key="issueLinkingPattern"
               value="${this.escapeAttr(cfg.issueLinkingPattern)}"
               placeholder="如 #([0-9]+)">
        <p class="form-hint">用于匹配 issue 编号的正则表达式，捕获组会作为编号传入 URL 模板。</p>
      </div>

      <div class="form-group">
        <label class="form-label" for="il-url">Issue URL 模板</label>
        <input type="text" class="form-input" id="il-url"
               data-key="issueLinkingUrl"
               value="${this.escapeAttr(cfg.issueLinkingUrl)}"
               placeholder="如 https://github.com/owner/repo/issues/$1">
        <p class="form-hint">URL 模板中使用 $1、$2 等引用正则的捕获组。</p>
      </div>

      <!-- Task 13.7：自动检测按钮 - 根据远程仓库 URL 自动推断 Issue URL 模板 -->
      <div class="form-group">
        <button class="btn btn-secondary" id="il-auto-detect" type="button">🔍 自动检测 Issue URL</button>
        <p class="form-hint">根据当前仓库的远程 URL 自动推断 Issue URL 模板（支持 GitHub/GitLab/Bitbucket）。</p>
      </div>
    `;
  }

  /**
   * 渲染"Git 用户身份"分组
   *
   * 显示并允许编辑 user.name 和 user.email（local 和 global 两级）。
   * 通过 configService 调用后端 set_config_value 命令保存。
   *
   * Task 13.7：新增"删除"按钮，调用 unset_config_value 命令清除配置项
   * （git config --unset user.name / user.email）
   */
  private renderGitUserSection(): string {
    // 如果仓库配置加载失败，显示错误信息
    if (!this.repoConfig) {
      return `
        <h3 class="settings-section-title">Git 用户身份</h3>
        <p class="settings-error">无法加载 Git 仓库配置，请确认仓库路径有效。</p>
      `;
    }

    const user = this.repoConfig.user;
    return `
      <h3 class="settings-section-title">Git 用户身份</h3>
      <p class="settings-section-desc">配置提交时使用的 user.name 和 user.email。</p>

      <div class="settings-subsection">
        <h4 class="settings-subsection-title">仓库级配置 (Local)</h4>
        <p class="settings-subsection-desc">仅对当前仓库生效，存储在 .git/config 中。</p>

        <div class="form-group">
          <label class="form-label" for="git-local-name">user.name (Local)</label>
          <div class="form-input-with-button">
            <input type="text" class="form-input" id="git-local-name"
                   data-git-key="user.name" data-git-location="local"
                   value="${this.escapeAttr(user.local.name ?? '')}"
                   placeholder="未设置">
            <button class="btn btn-danger btn-small" type="button"
                    data-git-unset-key="user.name" data-git-unset-location="local"
                    data-git-unset-input="git-local-name"
                    title="删除此配置项（git config --unset）">🗑 删除</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="git-local-email">user.email (Local)</label>
          <div class="form-input-with-button">
            <input type="text" class="form-input" id="git-local-email"
                   data-git-key="user.email" data-git-location="local"
                   value="${this.escapeAttr(user.local.email ?? '')}"
                   placeholder="未设置">
            <button class="btn btn-danger btn-small" type="button"
                    data-git-unset-key="user.email" data-git-unset-location="local"
                    data-git-unset-input="git-local-email"
                    title="删除此配置项（git config --unset）">🗑 删除</button>
          </div>
        </div>
      </div>

      <div class="settings-subsection">
        <h4 class="settings-subsection-title">用户级配置 (Global)</h4>
        <p class="settings-subsection-desc">对当前用户的所有仓库生效，存储在 ~/.gitconfig 中。</p>

        <div class="form-group">
          <label class="form-label" for="git-global-name">user.name (Global)</label>
          <div class="form-input-with-button">
            <input type="text" class="form-input" id="git-global-name"
                   data-git-key="user.name" data-git-location="global"
                   value="${this.escapeAttr(user.global.name ?? '')}"
                   placeholder="未设置">
            <button class="btn btn-danger btn-small" type="button"
                    data-git-unset-key="user.name" data-git-unset-location="global"
                    data-git-unset-input="git-global-name"
                    title="删除此配置项（git config --unset）">🗑 删除</button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="git-global-email">user.email (Global)</label>
          <div class="form-input-with-button">
            <input type="text" class="form-input" id="git-global-email"
                   data-git-key="user.email" data-git-location="global"
                   value="${this.escapeAttr(user.global.email ?? '')}"
                   placeholder="未设置">
            <button class="btn btn-danger btn-small" type="button"
                    data-git-unset-key="user.email" data-git-unset-location="global"
                    data-git-unset-input="git-global-email"
                    title="删除此配置项（git config --unset）">🗑 删除</button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 渲染"右键菜单可见性"分组（Task 13.2）
   *
   * 控制 6 类上下文菜单中每个菜单项的显隐。
   * 用户可以取消勾选某个菜单项，使其不在右键菜单中显示。
   *
   * 6 类菜单：
   *   1. 提交菜单（Commit）
   *   2. 本地分支菜单（Branch）
   *   3. 远程分支菜单（Remote Branch）
   *   4. 标签菜单（Tag）
   *   5. Stash 菜单
   *   6. 未提交变更菜单（Uncommitted Changes）
   */
  private renderContextMenuVisibilitySection(): string {
    const cfg = configService.getAppConfig().contextMenuActionsVisibility;
    return `
      <h3 class="settings-section-title">右键菜单可见性</h3>
      <p class="settings-section-desc">控制各类右键菜单中每个菜单项的显隐。取消勾选的项不会在菜单中显示。</p>

      <!-- ===== 提交菜单（Commit）===== -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">提交菜单（右键点击提交节点）</h4>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.addTag" ${cfg.commit.addTag ? 'checked' : ''}>
            <span>Add Tag...（添加标签）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.createBranch" ${cfg.commit.createBranch ? 'checked' : ''}>
            <span>Create Branch...（创建分支）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.checkout" ${cfg.commit.checkout ? 'checked' : ''}>
            <span>Checkout（检出）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.cherryPick" ${cfg.commit.cherryPick ? 'checked' : ''}>
            <span>Cherry Pick（拣选）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.revert" ${cfg.commit.revert ? 'checked' : ''}>
            <span>Revert（还原）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.drop" ${cfg.commit.drop ? 'checked' : ''}>
            <span>Drop（丢弃）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.merge" ${cfg.commit.merge ? 'checked' : ''}>
            <span>Merge...（合并）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.rebase" ${cfg.commit.rebase ? 'checked' : ''}>
            <span>Rebase...（变基）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.reset" ${cfg.commit.reset ? 'checked' : ''}>
            <span>Reset...（重置）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.copyHash" ${cfg.commit.copyHash ? 'checked' : ''}>
            <span>Copy Hash（复制哈希）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.commit.copySubject" ${cfg.commit.copySubject ? 'checked' : ''}>
            <span>Copy Subject（复制标题）</span>
          </label>
        </div>
      </div>

      <!-- ===== 本地分支菜单（Branch）===== -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">本地分支菜单（右键点击本地分支标签）</h4>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.checkout" ${cfg.branch.checkout ? 'checked' : ''}>
            <span>Checkout（切换到该分支）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.rename" ${cfg.branch.rename ? 'checked' : ''}>
            <span>Rename...（重命名）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.delete" ${cfg.branch.delete ? 'checked' : ''}>
            <span>Delete...（删除）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.merge" ${cfg.branch.merge ? 'checked' : ''}>
            <span>Merge...（合并）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.rebase" ${cfg.branch.rebase ? 'checked' : ''}>
            <span>Rebase...（变基）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.push" ${cfg.branch.push ? 'checked' : ''}>
            <span>Push...（推送）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.createPullRequest" ${cfg.branch.createPullRequest ? 'checked' : ''}>
            <span>Create Pull Request（创建 Pull Request）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.branch.copyName" ${cfg.branch.copyName ? 'checked' : ''}>
            <span>Copy Name（复制分支名）</span>
          </label>
        </div>
      </div>

      <!-- ===== 远程分支菜单（Remote Branch）===== -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">远程分支菜单（右键点击远程跟踪分支标签）</h4>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.remoteBranch.checkout" ${cfg.remoteBranch.checkout ? 'checked' : ''}>
            <span>Checkout（检出为本地分支）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.remoteBranch.delete" ${cfg.remoteBranch.delete ? 'checked' : ''}>
            <span>Delete（删除远程分支）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.remoteBranch.fetchIntoLocal" ${cfg.remoteBranch.fetchIntoLocal ? 'checked' : ''}>
            <span>Fetch into local（拉取到本地分支）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.remoteBranch.merge" ${cfg.remoteBranch.merge ? 'checked' : ''}>
            <span>Merge...（合并）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.remoteBranch.pull" ${cfg.remoteBranch.pull ? 'checked' : ''}>
            <span>Pull（拉取并合并）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.remoteBranch.createPullRequest" ${cfg.remoteBranch.createPullRequest ? 'checked' : ''}>
            <span>Create Pull Request（创建 Pull Request）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.remoteBranch.copyName" ${cfg.remoteBranch.copyName ? 'checked' : ''}>
            <span>Copy Name（复制远程分支名）</span>
          </label>
        </div>
      </div>

      <!-- ===== 标签菜单（Tag）===== -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">标签菜单（右键点击标签）</h4>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.tag.viewDetails" ${cfg.tag.viewDetails ? 'checked' : ''}>
            <span>View Details（查看详情）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.tag.delete" ${cfg.tag.delete ? 'checked' : ''}>
            <span>Delete（删除标签）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.tag.push" ${cfg.tag.push ? 'checked' : ''}>
            <span>Push（推送标签到远程）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.tag.copyName" ${cfg.tag.copyName ? 'checked' : ''}>
            <span>Copy Name（复制标签名）</span>
          </label>
        </div>
      </div>

      <!-- ===== Stash 菜单 ===== -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">Stash 菜单（右键点击 stash 标签）</h4>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.stash.apply" ${cfg.stash.apply ? 'checked' : ''}>
            <span>Apply...（应用 stash）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.stash.pop" ${cfg.stash.pop ? 'checked' : ''}>
            <span>Pop...（弹出 stash）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.stash.drop" ${cfg.stash.drop ? 'checked' : ''}>
            <span>Drop...（丢弃 stash）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.stash.createBranch" ${cfg.stash.createBranch ? 'checked' : ''}>
            <span>Create Branch...（从 stash 创建分支）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.stash.copyName" ${cfg.stash.copyName ? 'checked' : ''}>
            <span>Copy Name（复制 stash 选择器）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.stash.copyHash" ${cfg.stash.copyHash ? 'checked' : ''}>
            <span>Copy Hash（复制 stash 哈希）</span>
          </label>
        </div>
      </div>

      <!-- ===== 未提交变更菜单（Uncommitted Changes）===== -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">未提交变更菜单（右键点击虚拟 UNCOMMITTED 节点）</h4>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.uncommitted.stash" ${cfg.uncommitted.stash ? 'checked' : ''}>
            <span>Stash...（暂存变更）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.uncommitted.reset" ${cfg.uncommitted.reset ? 'checked' : ''}>
            <span>Reset...（重置）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.uncommitted.clean" ${cfg.uncommitted.clean ? 'checked' : ''}>
            <span>Clean...（清理未跟踪文件）</span>
          </label>
        </div>
        <div class="form-group">
          <label class="form-checkbox">
            <input type="checkbox" data-key="contextMenuActionsVisibility.uncommitted.openScm" ${cfg.uncommitted.openScm ? 'checked' : ''}>
            <span>Open SCM（打开 SCM 工具）</span>
          </label>
        </div>
      </div>
    `;
  }

  /* ====================================================================== *
   * Task 13.7：以下为新增分组的表单 HTML 渲染方法
   * ====================================================================== */

  /**
   * Task 13.7：渲染"远程仓库管理"分组
   *
   * 显示当前仓库的所有远程仓库列表（名称 + Fetch URL + Push URL），
   * 并提供以下操作：
   * - 添加：弹出表单输入远程名和 URL
   * - 编辑：修改远程的 URL
   * - 删除：删除远程仓库
   * - Fetch：从远程拉取更新
   * - Prune：清理失效的远程引用
   * - 显示/隐藏远程分支：切换 repository.showRemoteBranches 配置
   *
   * 后端命令：add_remote / edit_remote / delete_remote / prune_remote / fetch_command
   */
  private renderRemoteManagementSection(): string {
    /* 获取远程仓库列表（从已加载的 repoConfig 中读取） */
    const remotes = this.repoConfig?.remotes ?? [];
    /* 获取 showRemoteBranches 配置（用于复选框初始状态） */
    const showRemoteBranches: boolean = configService.getAppConfig().repository.showRemoteBranches;

    /* 构建远程仓库列表的 HTML */
    let remotesHtml = '';
    if (remotes.length === 0) {
      /* 没有远程仓库时显示提示 */
      remotesHtml = '<p class="settings-hint">当前仓库没有配置远程仓库。</p>';
    } else {
      /* 遍历每个远程仓库，构建列表项 */
      for (const remote of remotes) {
        remotesHtml += `
          <div class="remote-item" data-remote-name="${this.escapeAttr(remote.name)}">
            <div class="remote-item-header">
              <span class="remote-item-name">${this.escapeAttr(remote.name)}</span>
              <div class="remote-item-actions">
                <button class="btn btn-small" data-remote-action="fetch" data-remote-name="${this.escapeAttr(remote.name)}" type="button">⤓ Fetch</button>
                <button class="btn btn-small" data-remote-action="prune" data-remote-name="${this.escapeAttr(remote.name)}" type="button">🧹 Prune</button>
                <button class="btn btn-small" data-remote-action="edit" data-remote-name="${this.escapeAttr(remote.name)}" type="button">✏ 编辑</button>
                <button class="btn btn-danger btn-small" data-remote-action="delete" data-remote-name="${this.escapeAttr(remote.name)}" type="button">🗑 删除</button>
              </div>
            </div>
            <div class="remote-item-urls">
              <div class="remote-url-row">
                <span class="remote-url-label">Fetch URL:</span>
                <span class="remote-url-value">${this.escapeAttr(remote.url ?? '(未设置)')}</span>
              </div>
              <div class="remote-url-row">
                <span class="remote-url-label">Push URL:</span>
                <span class="remote-url-value">${this.escapeAttr(remote.push_url ?? remote.url ?? '(未设置)')}</span>
              </div>
            </div>
          </div>
        `;
      }
    }

    return `
      <h3 class="settings-section-title">远程仓库管理</h3>
      <p class="settings-section-desc">管理当前仓库的远程仓库（git remote）。</p>

      <!-- 添加远程仓库按钮 -->
      <div class="form-group">
        <button class="btn btn-primary" id="remote-add-btn" type="button">➕ 添加远程仓库</button>
      </div>

      <!-- 远程仓库列表 -->
      <div class="remote-list" id="remote-list">
        ${remotesHtml}
      </div>

      <!-- 显示/隐藏远程分支复选框 -->
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" data-key="repository.showRemoteBranches" ${showRemoteBranches ? 'checked' : ''}>
          <span>显示远程分支</span>
        </label>
        <p class="form-hint">控制是否在节点图中显示远程跟踪分支（如 origin/main）。</p>
      </div>
    `;
  }

  /**
   * Task 13.7：渲染"PR 创建"分组
   *
   * 两步向导配置：
   * 1. 第一步：选择 PR 提供商（GitHub/GitLab/Bitbucket/Custom/自动检测）
   * 2. 第二步：填写源仓库和目标仓库的 owner/repo/branch 信息
   *
   * 配置存储在 configService 的 prCreation 字段中。
   * 当用户在分支右键菜单点击"Create Pull Request"时，使用此配置预填表单。
   */
  private renderPrCreationSection(): string {
    /* 获取当前 PR 创建配置 */
    const cfg = configService.getAppConfig().prCreation;
    return `
      <h3 class="settings-section-title">PR 创建</h3>
      <p class="settings-section-desc">配置 Pull Request 创建向导的默认值。</p>

      <!-- 第一步：Provider 选择 -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">第一步：选择 PR 提供商</h4>
        <p class="settings-subsection-desc">选择创建 PR 时使用的平台。选择"自动检测"会根据远程 URL 推断。</p>

        <div class="form-group">
          <label class="form-label" for="pr-provider">PR 提供商</label>
          <select class="form-select" id="pr-provider" data-key="prCreation.provider">
            <option value="auto" ${cfg.provider === 'auto' ? 'selected' : ''}>自动检测（根据远程 URL 推断）</option>
            <option value="github" ${cfg.provider === 'github' ? 'selected' : ''}>GitHub</option>
            <option value="gitlab" ${cfg.provider === 'gitlab' ? 'selected' : ''}>GitLab</option>
            <option value="bitbucket" ${cfg.provider === 'bitbucket' ? 'selected' : ''}>Bitbucket</option>
            <option value="custom" ${cfg.provider === 'custom' ? 'selected' : ''}>自定义 (Custom)</option>
          </select>
        </div>

        <!-- 自动检测按钮 - 根据远程 URL 自动推断 Provider -->
        <div class="form-group">
          <button class="btn btn-secondary" id="pr-auto-detect" type="button">🔍 自动检测 Provider</button>
          <p class="form-hint">根据当前仓库的远程 URL 自动推断 PR 提供商。</p>
        </div>
      </div>

      <!-- 第二步：源/目标仓库配置 -->
      <div class="settings-subsection">
        <h4 class="settings-subsection-title">第二步：配置源/目标仓库</h4>
        <p class="settings-subsection-desc">留空的字段会在创建 PR 时使用当前仓库的值自动填充。</p>

        <div class="form-group">
          <label class="form-label" for="pr-source-owner">源仓库 Owner</label>
          <input type="text" class="form-input" id="pr-source-owner"
                 data-key="prCreation.sourceOwner"
                 value="${this.escapeAttr(cfg.sourceOwner)}"
                 placeholder="留空使用当前仓库的 owner">
        </div>

        <div class="form-group">
          <label class="form-label" for="pr-source-repo">源仓库名</label>
          <input type="text" class="form-input" id="pr-source-repo"
                 data-key="prCreation.sourceRepo"
                 value="${this.escapeAttr(cfg.sourceRepo)}"
                 placeholder="留空使用当前仓库名">
        </div>

        <div class="form-group">
          <label class="form-label" for="pr-source-branch">源分支</label>
          <input type="text" class="form-input" id="pr-source-branch"
                 data-key="prCreation.sourceBranch"
                 value="${this.escapeAttr(cfg.sourceBranch)}"
                 placeholder="留空使用当前分支">
        </div>

        <div class="form-group">
          <label class="form-label" for="pr-dest-owner">目标仓库 Owner</label>
          <input type="text" class="form-input" id="pr-dest-owner"
                 data-key="prCreation.destOwner"
                 value="${this.escapeAttr(cfg.destOwner)}"
                 placeholder="留空使用源仓库的 owner">
        </div>

        <div class="form-group">
          <label class="form-label" for="pr-dest-repo">目标仓库名</label>
          <input type="text" class="form-input" id="pr-dest-repo"
                 data-key="prCreation.destRepo"
                 value="${this.escapeAttr(cfg.destRepo)}"
                 placeholder="留空使用源仓库名">
        </div>

        <div class="form-group">
          <label class="form-label" for="pr-dest-branch">目标分支</label>
          <input type="text" class="form-input" id="pr-dest-branch"
                 data-key="prCreation.destBranch"
                 value="${this.escapeAttr(cfg.destBranch)}"
                 placeholder="如 main / master / develop">
        </div>
      </div>
    `;
  }

  /**
   * Task 13.7：渲染"配置导出"分组
   *
   * 提供一个按钮，将当前仓库的配置（Git 配置 + 应用配置）导出为 JSON 文件。
   * 调用后端 export_config 命令生成 .gittimeprism.json 文件。
   */
  private renderConfigExportSection(): string {
    return `
      <h3 class="settings-section-title">配置导出</h3>
      <p class="settings-section-desc">将当前仓库的配置导出为 JSON 文件，方便备份或迁移到其他机器。</p>

      <div class="form-group">
        <button class="btn btn-primary" id="config-export-btn" type="button">📥 导出配置</button>
        <p class="form-hint">点击按钮后，会在仓库根目录生成 <code>.gittimeprism.json</code> 文件，包含所有 Git 配置和应用配置。</p>
      </div>

      <div class="form-group">
        <h4 class="settings-subsection-title">导出内容包括：</h4>
        <ul class="settings-list">
          <li>Git 仓库配置（user.name/user.email、远程仓库、分支跟踪等）</li>
          <li>应用配置（提交详情视图、日期格式、对话框默认值、节点图样式、键盘快捷键等）</li>
          <li>Issue Linking 配置（正则表达式、URL 模板）</li>
          <li>PR 创建配置（Provider、源/目标分支信息）</li>
        </ul>
      </div>
    `;
  }

  /* ====================================================================== *
   * 以下为保存和重置逻辑
   * ====================================================================== */

  /**
   * 处理保存按钮点击
   *
   * 遍历当前对话框中所有带 data-key 属性的控件，收集其值，
   * 调用 configService.setAppConfigValue 保存应用配置。
   * 同时遍历所有带 data-git-key 属性的控件，调用 configService.setConfigValue 保存 Git 配置。
   */
  private async handleSave(): Promise<void> {
    if (!this.overlay) return;

    try {
      // 禁用保存按钮，防止重复提交
      const saveBtn = this.overlay.querySelector('#settings-save') as HTMLButtonElement;
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中...';

      // ---------- 收集并保存应用配置 ----------
      // 遍历所有带 data-key 属性的控件
      const inputs = this.overlay.querySelectorAll('[data-key]');
      inputs.forEach((input) => {
        const el = input as HTMLInputElement | HTMLSelectElement;
        const key = el.dataset.key;
        if (!key) return;

        // 根据控件类型获取值
        let value: unknown;
        if (el.type === 'checkbox') {
          value = (el as HTMLInputElement).checked;
        } else if (el.type === 'radio') {
          // 单选按钮只在选中时处理（同组的选中项）
          if (!(el as HTMLInputElement).checked) return;
          value = (el as HTMLInputElement).value;
        } else if (key === 'graph.colours') {
          // graph.colours 特殊处理：逗号分隔字符串转为数组
          const text = (el as HTMLInputElement).value.trim();
          value = text
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
        } else if (el.type === 'number') {
          // 数字输入转为数字类型
          value = Number((el as HTMLInputElement).value);
        } else if (key.startsWith('keyboardShortcuts.')) {
          // 键盘快捷键：空字符串转为 null
          const text = (el as HTMLInputElement).value.trim();
          value = text.length > 0 ? text : null;
        } else {
          // 其他控件取字符串值
          value = (el as HTMLInputElement).value.trim();
        }

        // 保存到 configService
        configService.setAppConfigValue(key, value);
      });

      // ---------- 收集并保存 Git 仓库配置 ----------
      // 遍历所有带 data-git-key 属性的控件（user.name / user.email）
      const gitInputs = this.overlay.querySelectorAll('[data-git-key]');
      const gitSavePromises: Promise<void>[] = [];

      gitInputs.forEach((input) => {
        const el = input as HTMLInputElement;
        const key = el.dataset.gitKey;
        const location = el.dataset.gitLocation as 'local' | 'global';
        if (!key || !location) return;

        const value = el.value.trim();
        // 如果值为空，跳过（不修改现有配置）
        // 用户如需清除配置，应使用 unset（此处暂不提供）
        if (value.length === 0) return;

        // 异步调用 configService.setConfigValue 保存 Git 配置
        gitSavePromises.push(
          configService.setConfigValue(this.repoPath, key, value, location),
        );
      });

      // 等待所有 Git 配置保存完成
      await Promise.all(gitSavePromises);

      // 保存成功提示
      alert('配置已保存');

      // 触发成功回调，刷新主界面
      this.onSuccess();

      // 关闭对话框
      this.close();
    } catch (err) {
      console.error('[SettingsPanel] 保存配置失败:', err);
      alert(`保存配置失败: ${String(err)}`);
    } finally {
      // 恢复保存按钮状态
      const saveBtn = this.overlay?.querySelector('#settings-save') as HTMLButtonElement;
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
      }
    }
  }

  /**
   * 处理重置按钮点击
   *
   * 将所有应用配置重置为默认值，并重新渲染表单。
   * 注意：Git 仓库配置（user.name/email）不会被重置，因为它们存储在 Git 配置文件中。
   */
  private handleReset(): void {
    // 确认对话框
    const confirmed = confirm('确定要将所有应用配置重置为默认值吗？\n\n注意：Git 仓库配置（user.name/email）不会被重置。');
    if (!confirmed) return;

    // 重置应用配置为默认值
    configService.resetAppConfig();

    // 重新渲染当前显示的分组
    const activeItem = this.overlay?.querySelector('.settings-nav-item.active') as HTMLElement;
    if (activeItem) {
      const section = activeItem.dataset.section;
      if (section) {
        this.renderSection(section);
      }
    }

    // 提示用户
    alert('应用配置已重置为默认值（需点击"保存"才会持久化）');
  }

  /* ====================================================================== *
   * 工具方法
   * ====================================================================== */

  /**
   * 关闭对话框
   *
   * 从 DOM 中移除模态对话框。
   */
  close(): void {
    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  /**
   * HTML 属性转义
   *
   * 转义字符串中的特殊字符，防止破坏 HTML 属性（如 value="${...}"）。
   * 主要转义双引号和 & 符号。
   *
   * @param text - 要转义的文本
   * @returns 转义后的安全文本
   */
  private escapeAttr(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
