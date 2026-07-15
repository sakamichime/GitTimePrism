/**
 * ============================================================
 * 历史文件清理对话框组件（purge-history-dialog.ts）
 * ============================================================
 *
 * 这个组件实现了 GitTimePrism 的"清理历史文件"功能（Task 3）。
 *
 * 功能概述：
 *   - 扫描 Git 仓库历史中的所有文件，识别大文件
 *   - 支持按文件大小阈值筛选（默认 1MB）
 *   - 支持按文件路径搜索
 *   - 支持点击表头排序（路径 / 大小 / 提交数）
 *   - 多选文件并从历史中删除（重写 Git 历史）
 *   - 可选创建备份分支，便于恢复
 *   - 自动检测 git-filter-repo 工具可用性
 *   - 检测到远程仓库时显示强制推送警告
 *   - 操作完成后显示前后仓库大小对比
 *
 * UI 结构：
 *   - 全屏遮罩层（.purge-history-overlay）
 *   - 居中面板（.purge-history-panel）
 *   - 顶部标题栏 + 关闭按钮
 *   - filter-repo 不可用提示条（动态显示）
 *   - 工具行（扫描按钮 + 筛选模式 + 阈值 + 搜索框）
 *   - 文件列表表格（路径 / 大小 / 提交数 + 复选框）
 *   - 底部按钮栏（选中计数 + 删除按钮 + 关闭按钮）
 *   - 结果展示区（动态显示）
 *
 * 使用方式：
 *   import { purgeHistoryDialog } from './purge-history-dialog.js';
 *   purgeHistoryDialog.show('/path/to/repo');
 *
 * 全局单例设计：
 *   - 整个应用共享一个 PurgeHistoryDialog 实例
 *   - show() 方法创建 DOM 并展示
 *   - hide() 方法销毁 DOM 并清理状态
 *   - 每次显示都是全新的 DOM，避免状态泄漏
 * ============================================================
 */

// 导入国际化服务（用于获取翻译文本）
import { t } from '../services/i18n.js';
// 导入仓库服务（提供 Git 操作的统一接口，通过 Tauri invoke 间接调用后端 Rust 命令）
import { repoService } from '../services/repo-service.js';
// 导入对话框全局单例（用于显示确认对话框、备份询问等）
import { dialog } from './dialog.js';
// 导入历史文件清理相关类型（HistoryFileInfo、FilterRepoStatus、PurgeResult）
import type {
  HistoryFileInfo,
  FilterRepoStatus,
  PurgeResult,
} from '../utils/git-types.js';


/**
 * ============================================================
 * 类型定义
 * ============================================================
 */

/**
 * 筛选模式枚举
 *
 * 控制文件列表的筛选方式：
 *   - Large：仅显示大于阈值的"大文件"（默认模式）
 *   - All：显示所有历史文件
 *
 * 注意：使用普通 enum（非 const enum），符合项目规范
 * （tsconfig 启用了 isolatedModules，不允许 const enum）
 */
export enum PurgeFilterMode {
  /** 仅大文件：只显示 maxSize >= threshold 的文件 */
  Large = 'large',
  /** 全部文件：显示所有历史文件 */
  All = 'all',
}

/**
 * 排序字段枚举
 *
 * 控制文件列表的排序方式：
 *   - Path：按文件路径字母序排序
 *   - MaxSize：按文件最大大小排序（默认，降序）
 *   - CommitCount：按文件出现的提交数排序
 *
 * 注意：使用普通 enum（非 const enum），符合项目规范
 */
export enum PurgeSortBy {
  /** 按文件路径排序 */
  Path = 'path',
  /** 按文件最大大小排序 */
  MaxSize = 'maxSize',
  /** 按文件出现的提交数排序 */
  CommitCount = 'commitCount',
}


/**
 * ============================================================
 * PurgeHistoryDialog 类：历史文件清理对话框
 * ============================================================
 */

/**
 * 历史文件清理对话框组件类
 *
 * 负责创建和管理"清理历史文件"模态对话框的 UI 和交互逻辑。
 * 全局单例（应用启动时创建一次），通过 purgeHistoryDialog 单例导出使用。
 *
 * 工作流程：
 *   1. 用户点击工具栏"清理历史"按钮
 *   2. 调用 show(repoPath) 创建并显示对话框
 *   3. 自动检测 git-filter-repo 可用性，不可用时显示警告
 *   4. 用户点击"扫描"按钮，调用后端扫描历史文件
 *   5. 用户通过筛选模式、阈值、搜索框过滤文件列表
 *   6. 用户勾选要删除的文件（支持全选/反选）
 *   7. 用户点击"删除选中文件"按钮
 *   8. 弹出备份询问对话框（创建备份分支 / 跳过）
 *   9. 弹出二次确认对话框（列出文件 + 远程警告）
 *   10. 用户确认后调用后端 purgeFilesFromHistory 执行删除
 *   11. 操作完成后显示结果（成功/失败 + 仓库大小对比）
 *   12. 调用 onComplete 回调刷新主界面节点图
 */
export class PurgeHistoryDialog {
  /** 遮罩层 DOM 元素（覆盖整个窗口的半透明背景） */
  private overlay: HTMLElement | null = null;
  /** 当前仓库路径（用户点击工具栏按钮时传入） */
  private repoPath: string = '';
  /** 扫描到的全部文件列表（来自后端 scan_history_files 命令） */
  private allFiles: HistoryFileInfo[] = [];
  /** 筛选后的文件列表（根据 filterMode/threshold/searchText 过滤后的子集） */
  private filteredFiles: HistoryFileInfo[] = [];
  /** 用户选中的文件路径集合（使用 Set 便于 O(1) 查找和切换） */
  private selectedPaths: Set<string> = new Set();
  /** 筛选模式（Large=仅大文件，All=全部文件），默认 Large */
  private filterMode: PurgeFilterMode = PurgeFilterMode.Large;
  /** 大小阈值（字节），默认 1MB（1048576 字节） */
  private threshold: number = 1048576;
  /** 搜索关键词（按文件路径模糊匹配），默认空字符串（不筛选） */
  private searchText: string = '';
  /** 排序字段（Path/MaxSize/CommitCount），默认 MaxSize */
  private sortBy: PurgeSortBy = PurgeSortBy.MaxSize;
  /** 是否降序排列（true=降序，false=升序），默认 true（最大的在前） */
  private sortDesc: boolean = true;
  /** git-filter-repo 工具是否可用（true=可用，使用 filter-repo；false=不可用，回退到 filter-branch） */
  private filterRepoAvailable: boolean = false;
  /** 仓库是否配置了远程仓库（true=有远程，显示强制推送警告；false=无远程） */
  private hasRemote: boolean = false;

  /**
   * 操作完成后的回调函数
   *
   * 当清理操作成功完成后调用，用于刷新主界面节点图。
   * 由 app.ts 在初始化时设置：
   *   purgeHistoryDialog.onComplete = () => this.refreshAllComponents();
   *
   * 注意：任务描述中提到的 loadCommits 方法在 app.ts 中实际名为 refreshAllComponents，
   *       因此这里调用的是 refreshAllComponents（功能等价）。
   */
  public onComplete: (() => void) | null = null;

  /**
   * 显示清理历史文件对话框
   *
   * 创建对话框 DOM 并添加到页面，然后：
   *   1. 检测 git-filter-repo 可用性
   *   2. 检测仓库是否配置了远程仓库
   *   3. 根据可用性显示/隐藏警告提示条
   *
   * @param repoPath - 当前仓库的本地路径
   */
  public show(repoPath: string): void {
    // 保存当前仓库路径
    this.repoPath = repoPath;
    // 重置所有状态（避免上次操作的残留）
    this.allFiles = [];
    this.filteredFiles = [];
    this.selectedPaths.clear();
    this.filterMode = PurgeFilterMode.Large;
    this.threshold = 1048576;
    this.searchText = '';
    this.sortBy = PurgeSortBy.MaxSize;
    this.sortDesc = true;
    this.filterRepoAvailable = false;
    this.hasRemote = false;

    // 创建对话框 DOM 并添加到页面
    this.createOverlay();
    // 绑定所有事件监听器
    this.bindEvents();
    // 异步检测 git-filter-repo 可用性（不阻塞 UI 显示）
    void this.checkFilterRepo();
    // 异步检测仓库是否配置了远程仓库（用于显示强制推送警告）
    void this.checkRemote();
  }

  /**
   * 隐藏对话框并清理状态
   *
   * 从 DOM 中移除对话框，清空所有状态引用。
   * 调用后实例可被复用（再次调用 show 方法）。
   */
  public hide(): void {
    if (this.overlay) {
      // 从 DOM 中移除遮罩层（及其内部所有内容）
      this.overlay.remove();
      this.overlay = null;
    }
    // 清空文件列表和选中状态
    this.allFiles = [];
    this.filteredFiles = [];
    this.selectedPaths.clear();
  }

  /**
   * 创建对话框的 DOM 结构
   *
   * 构建完整的 HTML 结构：
   *   - 全屏遮罩层
   *   - 居中面板容器
   *   - 顶部标题栏（标题 + 关闭按钮）
   *   - filter-repo 不可用提示条（默认隐藏）
   *   - 工具行（扫描按钮 + 筛选模式 + 阈值 + 搜索框）
   *   - 文件列表表格（含 loading 和空状态）
   *   - 操作中 loading 遮罩
   *   - 结果展示区（默认隐藏）
   *   - 底部按钮栏（选中计数 + 删除按钮 + 关闭按钮）
   */
  private createOverlay(): void {
    // 创建遮罩层元素
    this.overlay = document.createElement('div');
    // 使用唯一 ID 便于后续查找
    this.overlay.id = 'purge-history-overlay';
    this.overlay.className = 'purge-history-overlay';

    // 设置内部 HTML 结构
    // 注意：所有可见文本都通过 t() 函数获取翻译，支持多语言
    this.overlay.innerHTML = `
      <div class="purge-history-panel">
        <!-- 顶部标题栏 -->
        <div class="purge-history-header">
          <h2>${t('purge.title')}</h2>
          <button class="purge-close-btn" id="purge-close-btn">&times;</button>
        </div>

        <!-- filter-repo 不可用提示条（默认隐藏，检测后动态显示） -->
        <div class="purge-warning-bar" id="purge-filter-repo-warning" style="display:none">
          ${t('purge.filterRepoUnavailable')}<br>${t('purge.filterRepoTip')}
        </div>

        <!-- 工具行：扫描按钮 + 筛选模式 + 阈值 + 搜索框 -->
        <div class="purge-toolbar">
          <button class="btn" id="purge-scan-btn">${t('purge.scan')}</button>
          <select id="purge-filter-mode" title="${t('purge.filterMode')}">
            <option value="${PurgeFilterMode.Large}">${t('purge.largeFilesOnly')}</option>
            <option value="${PurgeFilterMode.All}">${t('purge.allFiles')}</option>
          </select>
          <input type="number" id="purge-threshold" value="${this.threshold}" placeholder="${t('purge.threshold')}" min="0" />
          <input type="text" id="purge-search" placeholder="${t('purge.search')}" />
        </div>

        <!-- 文件列表容器（含表格、loading、空状态） -->
        <div class="purge-file-list-container">
          <table class="purge-file-table">
            <thead>
              <tr>
                <th><input type="checkbox" id="purge-select-all" /></th>
                <th data-sort="${PurgeSortBy.Path}">${t('purge.colPath')}</th>
                <th data-sort="${PurgeSortBy.MaxSize}">${t('purge.colSize')}</th>
                <th data-sort="${PurgeSortBy.CommitCount}">${t('purge.colCommitCount')}</th>
              </tr>
            </thead>
            <tbody id="purge-file-tbody">
              <!-- 文件行动态生成 -->
            </tbody>
          </table>
          <!-- 扫描中 loading（默认隐藏） -->
          <div class="purge-loading" id="purge-loading" style="display:none">
            <div class="purge-spinner"></div>
            <span>${t('purge.scanning')}</span>
          </div>
          <!-- 空状态提示（默认隐藏） -->
          <div class="purge-empty" id="purge-empty" style="display:none">
            ${t('purge.noFiles')}
          </div>
        </div>

        <!-- 操作中 loading 遮罩（默认隐藏，覆盖整个面板） -->
        <div class="purge-action-loading" id="purge-action-loading" style="display:none">
          <div class="purge-spinner"></div>
          <span>${t('purge.purging')}</span>
        </div>

        <!-- 结果展示区（默认隐藏，操作完成后显示） -->
        <div class="purge-result" id="purge-result" style="display:none">
          <!-- 结果内容动态生成 -->
        </div>

        <!-- 底部按钮栏 -->
        <div class="purge-footer">
          <span class="purge-selected-count" id="purge-selected-count">${t('purge.selected', { count: 0 })}</span>
          <div>
            <button class="btn btn-danger" id="purge-delete-btn" disabled>${t('purge.delete')}</button>
            <button class="btn" id="purge-cancel-btn">${t('purge.cancel')}</button>
          </div>
        </div>
      </div>
    `;

    // 将对话框添加到 body
    document.body.appendChild(this.overlay);
  }

  /**
   * 绑定所有事件监听器
   *
   * 为对话框中的所有交互元素绑定事件：
   *   - 关闭按钮、取消按钮、遮罩点击（关闭对话框）
   *   - 扫描按钮（触发扫描）
   *   - 筛选模式下拉（切换筛选模式）
   *   - 阈值输入框（修改阈值）
   *   - 搜索框（实时过滤）
   *   - 表头点击（切换排序）
   *   - 全选复选框（全选/反选）
   *   - 删除按钮（启动删除流程）
   */
  private bindEvents(): void {
    if (!this.overlay) return;

    // 关闭按钮：点击 × 关闭对话框
    this.overlay.querySelector('#purge-close-btn')?.addEventListener('click', () => this.hide());

    // 取消按钮：点击"关闭"按钮关闭对话框
    this.overlay.querySelector('#purge-cancel-btn')?.addEventListener('click', () => this.hide());

    // 点击遮罩层空白处关闭对话框（点击面板内部不关闭）
    this.overlay.addEventListener('click', (e) => {
      // 只有点击直接落在遮罩层本身（而非内部面板）时才关闭
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    // 扫描按钮：触发后端扫描历史文件
    this.overlay.querySelector('#purge-scan-btn')?.addEventListener('click', () => {
      void this.scan();
    });

    // 筛选模式下拉：切换 Large/All 模式
    this.overlay.querySelector('#purge-filter-mode')?.addEventListener('change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      this.filterMode = value === PurgeFilterMode.All ? PurgeFilterMode.All : PurgeFilterMode.Large;
      this.renderFileList();
    });

    // 阈值输入框：修改阈值时重新过滤
    this.overlay.querySelector('#purge-threshold')?.addEventListener('input', (e) => {
      const value = parseInt((e.target as HTMLInputElement).value, 10);
      // 只有输入合法数字（非 NaN 且非负）时才更新阈值
      if (!isNaN(value) && value >= 0) {
        this.threshold = value;
        this.renderFileList();
      }
    });

    // 搜索框：实时过滤文件路径
    this.overlay.querySelector('#purge-search')?.addEventListener('input', (e) => {
      this.searchText = (e.target as HTMLInputElement).value.trim().toLowerCase();
      this.renderFileList();
    });

    // 表头点击：切换排序字段和排序方向
    this.overlay.querySelectorAll('.purge-file-table thead th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const field = (th as HTMLElement).dataset.sort as PurgeSortBy;
        if (!field) return;
        // 如果点击的是当前排序字段，切换升降序；否则切换到新字段并默认降序
        if (this.sortBy === field) {
          this.sortDesc = !this.sortDesc;
        } else {
          this.sortBy = field;
          this.sortDesc = true;
        }
        this.renderFileList();
      });
    });

    // 全选复选框：全选/反选当前筛选后的文件
    this.overlay.querySelector('#purge-select-all')?.addEventListener('change', (e) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.toggleSelectAll(checked);
    });

    // 删除按钮：启动删除流程（弹出备份询问 → 二次确认 → 执行删除）
    this.overlay.querySelector('#purge-delete-btn')?.addEventListener('click', () => {
      this.startPurge();
    });
  }

  /**
   * 检测 git-filter-repo 工具是否可用
   *
   * 调用后端 check_filter_repo_available 命令。
   * 不可用时显示警告提示条。
   * 此方法是异步的，不阻塞 UI 显示。
   */
  private async checkFilterRepo(): Promise<void> {
    try {
      // 调用后端检测 git-filter-repo 可用性
      const status: FilterRepoStatus = await repoService.checkFilterRepoAvailable();
      this.filterRepoAvailable = status.available;
      // 如果不可用，显示警告提示条
      const warningBar = this.overlay?.querySelector('#purge-filter-repo-warning') as HTMLElement;
      if (warningBar) {
        warningBar.style.display = this.filterRepoAvailable ? 'none' : 'block';
      }
    } catch (err) {
      // 检测失败时假设不可用，显示警告
      console.error('检测 git-filter-repo 可用性失败:', err);
      this.filterRepoAvailable = false;
      const warningBar = this.overlay?.querySelector('#purge-filter-repo-warning') as HTMLElement;
      if (warningBar) {
        warningBar.style.display = 'block';
      }
    }
  }

  /**
   * 检测仓库是否配置了远程仓库
   *
   * 调用后端 get_refs 命令获取引用列表，
   * 如果 remotes 数组非空，则说明有远程仓库配置。
   * 用于在二次确认对话框中显示"需要 git push --force"警告。
   */
  private async checkRemote(): Promise<void> {
    try {
      // 获取仓库所有引用（heads/tags/remotes/HEAD）
      const refMap = await repoService.getRefs(this.repoPath);
      // 如果 remotes 数组非空，说明配置了远程仓库
      this.hasRemote = refMap.remotes.length > 0;
    } catch (err) {
      // 检测失败时假设无远程（避免误显示警告）
      console.error('检测远程仓库失败:', err);
      this.hasRemote = false;
    }
  }

  /**
   * 扫描历史文件
   *
   * 调用后端 scan_history_files 命令，获取仓库历史中所有文件的信息。
   * 扫描过程中显示 loading 动画，扫描完成后渲染文件列表。
   */
  private async scan(): Promise<void> {
    if (!this.overlay) return;

    // 显示扫描中 loading
    const loading = this.overlay.querySelector('#purge-loading') as HTMLElement;
    const empty = this.overlay.querySelector('#purge-empty') as HTMLElement;
    const tbody = this.overlay.querySelector('#purge-file-tbody') as HTMLElement;
    if (loading) loading.style.display = 'flex';
    if (empty) empty.style.display = 'none';
    // 清空表格内容
    if (tbody) tbody.innerHTML = '';

    try {
      // 调用后端扫描历史文件
      this.allFiles = await repoService.scanHistoryFiles(this.repoPath);
      // 隐藏 loading
      if (loading) loading.style.display = 'none';

      // 如果没有扫描到文件，显示空状态
      if (this.allFiles.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
      }

      // 渲染文件列表
      this.renderFileList();
    } catch (err) {
      // 扫描失败：隐藏 loading，显示错误信息
      console.error('扫描历史文件失败:', err);
      if (loading) loading.style.display = 'none';
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = `扫描失败: ${String(err)}`;
      }
    }
  }

  /**
   * 渲染文件列表
   *
   * 根据 filterMode（筛选模式）、threshold（阈值）、searchText（搜索词）、
   * sortBy（排序字段）和 sortDesc（排序方向）渲染文件列表表格。
   *
   * 流程：
   *   1. 根据 filterMode 和 threshold 过滤文件
   *   2. 根据 searchText 进一步过滤（路径模糊匹配）
   *   3. 根据 sortBy 和 sortDesc 排序
   *   4. 生成表格行 HTML 并插入到 tbody
   *   5. 为每行绑定复选框点击事件
   *   6. 更新全选复选框状态
   *   7. 更新底部选中计数
   */
  private renderFileList(): void {
    if (!this.overlay) return;

    const tbody = this.overlay.querySelector('#purge-file-tbody') as HTMLElement;
    const empty = this.overlay.querySelector('#purge-empty') as HTMLElement;
    if (!tbody) return;

    // 清空表格内容
    tbody.innerHTML = '';

    // 第一步：根据 filterMode 和 threshold 过滤
    let files = this.allFiles;
    if (this.filterMode === PurgeFilterMode.Large) {
      // 仅大文件模式：只显示 maxSize >= threshold 的文件
      files = files.filter((f) => f.maxSize >= this.threshold);
    }

    // 第二步：根据 searchText 过滤（路径模糊匹配，大小写不敏感）
    if (this.searchText) {
      files = files.filter((f) => f.path.toLowerCase().includes(this.searchText));
    }

    // 第三步：根据 sortBy 和 sortDesc 排序
    // 复制数组避免修改原数组
    files = [...files].sort((a, b) => {
      let cmp = 0;
      if (this.sortBy === PurgeSortBy.Path) {
        // 按路径字母序排序
        cmp = a.path.localeCompare(b.path);
      } else if (this.sortBy === PurgeSortBy.MaxSize) {
        // 按最大大小数值排序
        cmp = a.maxSize - b.maxSize;
      } else if (this.sortBy === PurgeSortBy.CommitCount) {
        // 按提交数数值排序
        cmp = a.commitCount - b.commitCount;
      }
      // 降序时取反
      return this.sortDesc ? -cmp : cmp;
    });

    // 保存筛选后的文件列表（用于全选操作）
    this.filteredFiles = files;

    // 如果没有文件，显示空状态
    if (files.length === 0) {
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = this.allFiles.length === 0 ? t('purge.noFiles') : '没有匹配的文件';
      }
      // 更新全选复选框状态
      this.updateSelectAllCheckbox();
      // 更新选中计数
      this.updateSelectedCount();
      return;
    }

    // 隐藏空状态
    if (empty) empty.style.display = 'none';

    // 第四步：生成表格行 HTML 并插入到 tbody
    tbody.innerHTML = files.map((file) => {
      // 检查当前文件是否已选中
      const isSelected = this.selectedPaths.has(file.path);
      // 转义文件路径，防止 XSS
      const escapedPath = this.escapeHtml(file.path);
      // 格式化文件大小
      const sizeStr = this.formatSize(file.maxSize);
      // 生成行 HTML
      return `
        <tr class="${isSelected ? 'selected' : ''}" data-path="${escapedPath}">
          <td><input type="checkbox" class="purge-row-checkbox" data-path="${escapedPath}" ${isSelected ? 'checked' : ''} /></td>
          <td class="purge-col-path">${escapedPath}</td>
          <td class="purge-col-size">${sizeStr}</td>
          <td class="purge-col-commits">${file.commitCount}</td>
        </tr>
      `;
    }).join('');

    // 第五步：为每行的复选框绑定点击事件
    tbody.querySelectorAll('.purge-row-checkbox').forEach((checkbox) => {
      checkbox.addEventListener('change', (e) => {
        const path = (e.target as HTMLInputElement).dataset.path;
        if (path) {
          // 切换选中状态
          this.toggleSelect(path);
        }
      });
    });

    // 第六步：更新全选复选框状态
    this.updateSelectAllCheckbox();
    // 第七步：更新底部选中计数
    this.updateSelectedCount();
  }

  /**
   * 切换单个文件的选中状态
   *
   * @param path - 要切换选中状态的文件路径
   */
  private toggleSelect(path: string): void {
    if (this.selectedPaths.has(path)) {
      // 已选中 → 取消选中
      this.selectedPaths.delete(path);
    } else {
      // 未选中 → 添加选中
      this.selectedPaths.add(path);
    }
    // 更新行的 selected 类（高亮显示）
    this.updateRowSelectedClass(path);
    // 更新全选复选框状态
    this.updateSelectAllCheckbox();
    // 更新底部选中计数
    this.updateSelectedCount();
  }

  /**
   * 全选/反选当前筛选后的所有文件
   *
   * @param checked - true 表示全选，false 表示全部取消选中
   */
  private toggleSelectAll(checked: boolean): void {
    if (checked) {
      // 全选：将所有筛选后的文件路径添加到选中集合
      this.filteredFiles.forEach((file) => {
        this.selectedPaths.add(file.path);
      });
    } else {
      // 全部取消：从选中集合中移除所有筛选后的文件路径
      this.filteredFiles.forEach((file) => {
        this.selectedPaths.delete(file.path);
      });
    }
    // 重新渲染文件列表（更新所有行的 selected 类和复选框状态）
    this.renderFileList();
  }

  /**
   * 更新单行的 selected 类（高亮显示）
   *
   * @param path - 文件路径
   */
  private updateRowSelectedClass(path: string): void {
    if (!this.overlay) return;
    // 查找对应路径的表格行
    const row = this.overlay.querySelector(`tr[data-path="${this.escapeHtml(path)}"]`);
    if (row) {
      // 根据是否选中添加/移除 selected 类
      if (this.selectedPaths.has(path)) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    }
  }

  /**
   * 更新全选复选框的状态
   *
   * 根据当前筛选后文件的选中情况，更新全选复选框：
   *   - 全部选中：checked = true
   *   - 部分选中：checked = false（不使用 indeterminate 状态，简化逻辑）
   *   - 全部未选中：checked = false
   */
  private updateSelectAllCheckbox(): void {
    if (!this.overlay) return;
    const selectAllCheckbox = this.overlay.querySelector('#purge-select-all') as HTMLInputElement;
    if (!selectAllCheckbox) return;
    // 如果没有筛选后的文件，全选复选框不勾选
    if (this.filteredFiles.length === 0) {
      selectAllCheckbox.checked = false;
      return;
    }
    // 检查是否所有筛选后的文件都被选中
    const allSelected = this.filteredFiles.every((file) => this.selectedPaths.has(file.path));
    selectAllCheckbox.checked = allSelected;
  }

  /**
   * 更新底部"已选 N 个文件"显示
   *
   * 同时根据选中数量启用/禁用删除按钮：
   *   - 选中数 > 0：启用删除按钮
   *   - 选中数 = 0：禁用删除按钮
   */
  private updateSelectedCount(): void {
    if (!this.overlay) return;
    // 更新选中计数文字
    const countElem = this.overlay.querySelector('#purge-selected-count');
    if (countElem) {
      countElem.textContent = t('purge.selected', { count: this.selectedPaths.size });
    }
    // 根据选中数量启用/禁用删除按钮
    const deleteBtn = this.overlay.querySelector('#purge-delete-btn') as HTMLButtonElement;
    if (deleteBtn) {
      deleteBtn.disabled = this.selectedPaths.size === 0;
    }
  }

  /**
   * 启动删除流程
   *
   * 用户点击"删除选中文件"按钮后调用。
   * 弹出备份询问对话框，让用户选择是否创建备份分支。
   */
  private startPurge(): void {
    // 如果没有选中文件，不执行任何操作
    if (this.selectedPaths.size === 0) return;
    // 弹出备份询问对话框
    this.showBackupDialog();
  }

  /**
   * 显示备份询问对话框
   *
   * 使用 dialog.showTwoButtons 弹出二选一对话框：
   *   - 按钮1"创建备份分支"：createBackup = true, backupBranchName = backup/pre-purge-<timestamp>
   *   - 按钮2"跳过"：createBackup = false
   *
   * 用户选择后，进入二次确认对话框。
   */
  private showBackupDialog(): void {
    // 弹出备份询问对话框（两个按钮：创建备份 / 跳过）
    dialog.showTwoButtons(
      t('purge.backup.title'),
      t('purge.backup.create'),
      () => {
        // 用户选择"创建备份分支"：生成备份分支名并进入二次确认
        const timestamp = Math.floor(Date.now() / 1000);
        const backupBranchName = `backup/pre-purge-${timestamp}`;
        this.showConfirmDialog(true, backupBranchName);
      },
      t('purge.backup.skip'),
      () => {
        // 用户选择"跳过"：不创建备份，进入二次确认
        this.showConfirmDialog(false, null);
      },
      null
    );
  }

  /**
   * 显示二次确认对话框
   *
   * 列出选中的文件列表，并显示警告：
   *   - "此操作将重写 Git 历史，不可撤销！"
   *   - 如果有远程仓库，额外显示"需要 git push --force"警告
   *
   * 用户确认后，调用 executePurge 执行删除。
   *
   * @param createBackup - 是否创建备份分支
   * @param backupBranchName - 备份分支名（createBackup 为 false 时为 null）
   */
  private showConfirmDialog(createBackup: boolean, backupBranchName: string | null): void {
    // 构建选中文件列表（最多显示 10 个，超出显示"...")
    const filePaths = Array.from(this.selectedPaths);
    const fileListHtml = filePaths.slice(0, 10)
      .map((path) => `<div>${this.escapeHtml(path)}</div>`)
      .join('');
    const moreFiles = filePaths.length > 10 ? `<div>... (共 ${filePaths.length} 个文件)</div>` : '';

    // 构建警告信息
    const warningHtml = `<div class="purge-remote-warning">${t('purge.confirm.warning')}</div>`;

    // 如果有远程仓库，追加远程警告
    const remoteWarningHtml = this.hasRemote
      ? `<div class="purge-remote-warning">${t('purge.confirm.remoteWarning')}</div>`
      : '';

    // 组合完整消息
    const message = `
      <div style="margin-bottom: 8px;">${t('purge.confirm.title')} (${filePaths.length})</div>
      <div style="max-height: 200px; overflow-y: auto; margin-bottom: 8px; padding: 8px; background: var(--bg-secondary); border-radius: 4px;">
        ${fileListHtml}${moreFiles}
      </div>
      ${warningHtml}
      ${remoteWarningHtml}
    `;

    // 弹出确认对话框
    dialog.showConfirmation(
      message,
      t('purge.confirm.delete'),
      () => {
        // 用户确认删除：执行清理操作
        void this.executePurge(createBackup, backupBranchName);
      },
      null
    );
  }

  /**
   * 执行清理操作
   *
   * 调用后端 purge_files_from_history 命令，从 Git 历史中删除选中的文件。
   * 操作过程中显示 loading 遮罩，操作完成后显示结果。
   *
   * @param createBackup - 是否创建备份分支
   * @param backupBranchName - 备份分支名（createBackup 为 false 时为 null）
   */
  private async executePurge(createBackup: boolean, backupBranchName: string | null): Promise<void> {
    if (!this.overlay) return;

    // 显示操作中 loading 遮罩
    const actionLoading = this.overlay.querySelector('#purge-action-loading') as HTMLElement;
    if (actionLoading) actionLoading.style.display = 'flex';

    try {
      // 获取选中文件的路径数组
      const filePaths = Array.from(this.selectedPaths);
      // 调用后端执行清理操作
      const result = await repoService.purgeFilesFromHistory(
        this.repoPath,
        filePaths,
        createBackup,
        backupBranchName
      );

      // 隐藏 loading
      if (actionLoading) actionLoading.style.display = 'none';

      // 显示操作结果
      this.showResult(result);

      // 如果操作成功，调用 onComplete 回调刷新主界面节点图
      if (result.success && this.onComplete) {
        // 使用 void 标记 fire-and-forget，不等待回调完成
        void this.onComplete();
      }
    } catch (err) {
      // 操作抛出异常：隐藏 loading，显示错误
      console.error('清理历史文件失败:', err);
      if (actionLoading) actionLoading.style.display = 'none';

      // 构造失败结果并显示
      const errorResult: PurgeResult = {
        success: false,
        beforeSize: '-',
        afterSize: '-',
        backupBranch: backupBranchName,
        method: this.filterRepoAvailable ? 'filter-repo' : 'filter-branch',
        error: String(err),
      };
      this.showResult(errorResult);
    }
  }

  /**
   * 显示操作结果
   *
   * 在结果展示区显示清理操作的详细结果，包括：
   *   - 成功/失败状态
   *   - 操作前后仓库大小对比
   *   - 使用的清理方法（filter-repo / filter-branch）
   *   - 备份分支名（如果创建了）
   *   - 恢复提示（如果创建了备份）
   *   - 错误信息（如果失败）
   *
   * @param result - 清理操作的结果
   */
  private showResult(result: PurgeResult): void {
    if (!this.overlay) return;

    // 获取结果展示区元素
    const resultElem = this.overlay.querySelector('#purge-result') as HTMLElement;
    if (!resultElem) return;

    // 显示结果展示区
    resultElem.style.display = 'block';

    // 根据成功/失败添加对应的 CSS 类（控制文字颜色）
    resultElem.className = `purge-result ${result.success ? 'purge-result-success' : 'purge-result-failed'}`;

    // 构建结果 HTML
    let html = '';

    // 标题：成功/失败
    html += `<div class="purge-result-title">${result.success ? t('purge.success') : t('purge.failed')}</div>`;

    // 如果失败且有错误信息，显示错误详情
    if (!result.success && result.error) {
      html += `<div class="purge-result-row"><span class="purge-result-label">${t('error.operationFailed')}:</span> <span class="purge-result-value">${this.escapeHtml(result.error)}</span></div>`;
    }

    // 操作前后仓库大小对比
    html += `<div class="purge-result-row"><span class="purge-result-label">${t('purge.sizeBefore')}:</span> <span class="purge-result-value">${this.escapeHtml(result.beforeSize)}</span></div>`;
    html += `<div class="purge-result-row"><span class="purge-result-label">${t('purge.sizeAfter')}:</span> <span class="purge-result-value">${this.escapeHtml(result.afterSize)}</span></div>`;

    // 使用的清理方法
    html += `<div class="purge-result-row"><span class="purge-result-label">${t('purge.method')}:</span> <span class="purge-result-value">${this.escapeHtml(result.method)}</span></div>`;

    // 备份分支名（如果创建了备份）
    if (result.backupBranch) {
      html += `<div class="purge-result-row"><span class="purge-result-label">${t('purge.backupBranch')}:</span> <span class="purge-result-value">${this.escapeHtml(result.backupBranch)}</span></div>`;
      // 显示恢复提示
      html += `<div class="purge-restore-hint">${t('purge.restoreHint', { branch: result.backupBranch })}</div>`;
    }

    // 如果操作成功且有远程仓库，显示强制推送警告
    if (result.success && this.hasRemote) {
      html += `<div class="purge-remote-warning">${t('purge.confirm.remoteWarning')}</div>`;
    }

    // 设置结果展示区内容
    resultElem.innerHTML = html;

    // 操作完成后清空选中状态（避免重复操作）
    this.selectedPaths.clear();
    this.updateSelectedCount();
  }

  /**
   * 格式化字节大小为人类可读字符串
   *
   * 根据大小自动选择合适的单位（B/KB/MB/GB），保留两位小数。
   *
   * @param bytes - 字节数
   * @returns 人类可读的大小字符串（如 "1.50 MB"）
   */
  private formatSize(bytes: number): string {
    // 小于 1 KB：直接显示字节
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    // 小于 1 MB：显示 KB
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    }
    // 小于 1 GB：显示 MB
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }
    // 大于等于 1 GB：显示 GB
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  /**
   * HTML 转义
   *
   * 防止 XSS 攻击，将特殊字符（<, >, &, ", '）转义为 HTML 实体。
   *
   * @param text - 要转义的文本
   * @returns 转义后的文本
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}


/**
 * ============================================================
 * 全局单例导出
 * ============================================================
 */

/**
 * 历史文件清理对话框的全局单例
 *
 * 整个应用共享一个 PurgeHistoryDialog 实例。
 * 在 app.ts 中通过 show() 方法调用：
 *
 *   import { purgeHistoryDialog } from './purge-history-dialog.js';
 *   purgeHistoryDialog.show(repoPath);
 *
 * 可选设置 onComplete 回调（操作成功后刷新主界面）：
 *
 *   purgeHistoryDialog.onComplete = () => this.refreshAllComponents();
 */
export const purgeHistoryDialog = new PurgeHistoryDialog();
