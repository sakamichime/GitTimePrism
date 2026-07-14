/**
 * ============================================================
 * Stash 管理组件（stash-manager.ts）
 * ============================================================
 *
 * 这个组件是 GitTimePrism 的 Stash（暂存）操作辅助组件。
 *
 * 设计说明：
 *   根据任务要求，stash-manager 不需要独立的 DOM 容器，
 *   而是作为 commit-graph 的辅助组件存在。它的主要职责是：
 *     1. 提供"Stash uncommitted changes"对话框（push_stash 操作）
 *     2. 提供 stash 节点的操作对话框（apply/pop/drop/branch）
 *
 *   stash 节点在节点图中的渲染由 commit-graph.ts 的 buildAnnotations
 *   方法完成（带 📦 stash 标记和橙色样式），本组件不参与渲染。
 *
 *   工具栏的"Stash"按钮在 app.ts 中添加，点击后调用本组件的
 *   showPushStashDialog() 方法弹出对话框。
 *
 * 对话框样式：
 *   复用 dialog.css 中的通用 .dialog-overlay / .dialog / .dialog-input
 *   / .dialog-checkbox / .dialog-buttons 等类名，保持与 ResetDialog、
 *   TagManager 等组件一致的视觉风格。
 *
 * 使用方式：
 *   import { StashManager } from './stash-manager.js';
 *
 *   // 创建实例（传入仓库路径和成功回调）
 *   const stashManager = new StashManager(repoPath, () => {
 *     refreshAllComponents();
 *   });
 *
 *   // 弹出"Stash uncommitted changes"对话框
 *   stashManager.showPushStashDialog();
 *
 *   // 弹出单个 stash 的操作菜单对话框
 *   stashManager.showStashActionsDialog({
 *     selector: 'stash@{0}',
 *     message: 'WIP on main: abc1234 修复bug'
 *   });
 * ============================================================
 */

// 导入仓库服务（用于调用 stash 相关的后端命令）
import { repoService } from '../services/repo-service.js';
// 导入 Stash 类型定义（描述 stash 记录的数据结构）
import type { GitStash } from '../utils/git-types.js';
// 导入 HTML 转义工具（防止用户输入的内容导致 XSS）
import { escapeHtml } from '../utils/git-utils.js';


/**
 * Stash 操作对话框的参数
 *
 * 当用户在节点图中点击 stash 节点想执行操作时，
 * 需要传入该 stash 的信息以便显示和操作。
 */
export interface StashActionParams {
  /** stash 选择器（如 "stash@{0}"），用于后端命令 */
  selector: string;
  /** stash 的描述消息（显示在对话框中供用户参考） */
  message: string;
}

/**
 * Stash 管理组件类
 *
 * 提供 stash 相关的对话框界面，包括：
 *   - pushStash 对话框：保存当前未提交变更到 stash
 *   - stash 操作对话框：对已存在的 stash 执行 apply/pop/drop/branch
 *
 * 生命周期：
 *   1. 构造：保存仓库路径和成功回调
 *   2. showPushStashDialog()：弹出 push stash 对话框
 *   3. showStashActionsDialog()：弹出单个 stash 的操作对话框
 *   4. 用户操作完成后触发回调刷新界面
 */
export class StashManager {
  /** 当前打开的仓库路径，传给后端执行 git stash 命令 */
  private readonly repoPath: string;
  /** 操作成功后执行的回调函数，通常用于刷新界面组件 */
  private readonly onSuccess: () => void;

  /**
   * 构造 Stash 管理组件实例
   *
   * @param repoPath - 当前仓库的路径
   * @param onSuccess - stash 操作成功后的回调（通常刷新节点图、文件列表等）
   */
  constructor(repoPath: string, onSuccess: () => void) {
    this.repoPath = repoPath;
    this.onSuccess = onSuccess;
  }

  /**
   * 显示"Stash uncommitted changes"对话框
   *
   * 弹出模态对话框，让用户配置 stash 选项：
   *   - Include Untracked 复选框：是否包含未跟踪文件（--include-untracked）
   *   - Message 输入框：可选的 stash 描述消息（--message）
   *
   * 用户点击"确认"后，调用 repoService.pushStash() 执行 stash push 命令。
   * 成功后关闭对话框并触发 onSuccess 回调刷新界面。
   */
  public showPushStashDialog(): void {
    // 创建遮罩层（半透明背景，阻止点击对话框后面的内容）
    const overlay = this.createOverlay();

    // 构建对话框 HTML 内容
    // 使用通用的 .dialog-* 类名，复用 dialog.css 的样式
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="stash-push-title">
        <!-- 对话框标题区域 -->
        <div class="dialog-message">
          <h3 id="stash-push-title" style="margin: 0 0 8px 0; font-size: var(--font-size-md);">📦 Stash 未提交的变更</h3>
          <p style="margin: 0; color: var(--text-secondary);">
            将当前工作区和暂存区的变更保存为 stash，工作区将恢复到 HEAD 状态。
          </p>
        </div>

        <!-- Message 消息输入组 -->
        <div class="dialog-input-group">
          <label class="dialog-input-label" for="stash-message">Stash 消息（可选）</label>
          <input
            id="stash-message"
            class="dialog-input"
            type="text"
            placeholder="例如：WIP 修复登录bug"
            autocomplete="off"
          />
        </div>

        <!-- Include Untracked 复选框 -->
        <label class="dialog-checkbox">
          <input id="stash-include-untracked" type="checkbox" />
          <span>包含未跟踪文件（--include-untracked）</span>
        </label>

        <!-- 操作按钮区域 -->
        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-secondary" id="stash-push-cancel">取消</button>
          <button class="dialog-btn dialog-btn-primary" id="stash-push-confirm">确认 Stash</button>
        </div>
      </div>
    `;

    // 将遮罩层添加到页面
    document.body.appendChild(overlay);

    // 绑定对话框内的事件
    this.bindPushStashEvents(overlay);

    // 自动聚焦到消息输入框，方便用户直接输入
    const messageInput = overlay.querySelector<HTMLInputElement>('#stash-message');
    if (messageInput) {
      messageInput.focus();
    }
  }

  /**
   * 显示单个 stash 的操作对话框
   *
   * 当用户在节点图中点击某个 stash 节点想执行操作时，弹出此对话框。
   * 提供 4 个操作按钮：
   *   - Apply：应用 stash（保留 stash 记录）
   *   - Pop：弹出 stash（应用后删除）
   *   - Branch：从 stash 创建新分支
   *   - Drop：删除 stash（不应用）
   *
   * 每个操作（除 Drop 外）可能有附加选项：
   *   - Apply/Pop：--index 复选框（恢复暂存区）
   *   - Branch：新分支名输入框
   *
   * @param params - stash 信息（selector 和 message）
   */
  public showStashActionsDialog(params: StashActionParams): void {
    // 创建遮罩层
    const overlay = this.createOverlay();

    // 转义 stash 消息，防止 XSS（虽然 stash 消息来自 git，但仍要防御性处理）
    const safeMessage = escapeHtml(params.message);
    const safeSelector = escapeHtml(params.selector);

    // 构建对话框 HTML
    overlay.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="stash-actions-title">
        <!-- 对话框标题区域：显示 stash 的选择器和消息 -->
        <div class="dialog-message">
          <h3 id="stash-actions-title" style="margin: 0 0 8px 0; font-size: var(--font-size-md);">
            📦 Stash 操作
          </h3>
          <p style="margin: 0; color: var(--text-secondary);">
            <code style="background: var(--bg-primary); padding: 2px 6px; border-radius: 4px;">${safeSelector}</code>
          </p>
          <p style="margin: 4px 0 0 0; color: var(--text-muted); font-size: var(--font-size-xs);">
            ${safeMessage}
          </p>
        </div>

        <!-- Apply 选项区域 -->
        <div class="dialog-radio-group">
          <label>
            <input type="radio" name="stash-action" value="apply" checked />
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-weight: 500;">Apply（应用）</span>
              <span style="color: var(--text-muted); font-size: var(--font-size-xs);">
                应用 stash 到工作区，保留 stash 记录
              </span>
            </div>
          </label>
          <label>
            <input type="radio" name="stash-action" value="pop" />
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-weight: 500;">Pop（弹出）</span>
              <span style="color: var(--text-muted); font-size: var(--font-size-xs);">
                应用 stash 并从列表中删除（apply + drop）
              </span>
            </div>
          </label>
          <label>
            <input type="radio" name="stash-action" value="branch" />
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-weight: 500;">Branch（创建分支）</span>
              <span style="color: var(--text-muted); font-size: var(--font-size-xs);">
                基于 stash 的基础提交创建新分支并切换过去
              </span>
            </div>
          </label>
          <label>
            <input type="radio" name="stash-action" value="drop" />
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-weight: 500; color: var(--error);">Drop（删除） ⚠️</span>
              <span style="color: var(--text-muted); font-size: var(--font-size-xs);">
                直接删除 stash，不应用变更（不可恢复）
              </span>
            </div>
          </label>
        </div>

        <!-- --index 复选框（仅 apply/pop 操作时使用） -->
        <label class="dialog-checkbox" id="stash-index-wrap">
          <input id="stash-index" type="checkbox" />
          <span>尝试恢复暂存区（--index）</span>
        </label>

        <!-- 新分支名输入框（仅 branch 操作时使用，默认隐藏） -->
        <div class="dialog-input-group" id="stash-branch-name-wrap" style="display: none;">
          <label class="dialog-input-label" for="stash-branch-name">新分支名称</label>
          <input
            id="stash-branch-name"
            class="dialog-input"
            type="text"
            placeholder="例如：feature/from-stash"
            autocomplete="off"
          />
        </div>

        <!-- 操作按钮区域 -->
        <div class="dialog-buttons">
          <button class="dialog-btn dialog-btn-secondary" id="stash-actions-cancel">取消</button>
          <button class="dialog-btn dialog-btn-primary" id="stash-actions-confirm">执行</button>
        </div>
      </div>
    `;

    // 将遮罩层添加到页面
    document.body.appendChild(overlay);

    // 绑定事件
    this.bindStashActionsEvents(overlay, params);
  }

  /**
   * 创建对话框遮罩层
   *
   * 遮罩层是全屏半透明背景，覆盖整个视口。
   * 作用：
   *   1. 视觉上突出对话框
   *   2. 阻止用户点击对话框后面的内容
   *   3. 点击遮罩层（对话框外部）可关闭对话框
   *
   * @returns 遮罩层 DOM 元素
   */
  private createOverlay(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    return overlay;
  }

  /**
   * 绑定 push stash 对话框的事件
   *
   * 处理以下交互：
   *   1. 取消按钮：关闭对话框
   *   2. 确认按钮：执行 push stash 操作
   *   3. 点击遮罩层：关闭对话框
   *   4. ESC 键：关闭对话框
   *
   * @param overlay - 遮罩层 DOM 元素
   */
  private bindPushStashEvents(overlay: HTMLElement): void {
    // 取消按钮：点击后关闭对话框
    const cancelBtn = overlay.querySelector<HTMLElement>('#stash-push-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeDialog(overlay));
    }

    // 确认按钮：执行 push stash 操作
    const confirmBtn = overlay.querySelector<HTMLElement>('#stash-push-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this.handlePushStashConfirm(overlay).catch((err) => {
          console.error('[StashManager] push stash 失败:', err);
        });
      });
    }

    // 点击遮罩层（对话框外部）关闭对话框
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) {
        this.closeDialog(overlay);
      }
    });

    // ESC 键关闭对话框
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        this.closeDialog(overlay);
      }
    };
    document.addEventListener('keydown', escHandler);

    // 回车键提交（在消息输入框中按下回车时触发确认）
    const messageInput = overlay.querySelector<HTMLInputElement>('#stash-message');
    if (messageInput) {
      messageInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.handlePushStashConfirm(overlay).catch((err) => {
            console.error('[StashManager] push stash 失败:', err);
          });
        }
      });
    }
  }

  /**
   * 处理 push stash 确认按钮的点击
   *
   * 执行流程：
   *   1. 从对话框读取用户输入（message 和 includeUntracked）
   *   2. 禁用确认按钮防止重复点击
   *   3. 调用 repoService.pushStash() 执行后端命令
   *   4. 成功后关闭对话框并触发 onSuccess 回调
   *   5. 失败时弹出错误提示并恢复按钮状态
   *
   * @param overlay - 遮罩层 DOM 元素
   */
  private async handlePushStashConfirm(overlay: HTMLElement): Promise<void> {
    // 读取用户输入
    const messageInput = overlay.querySelector<HTMLInputElement>('#stash-message');
    const untrackedCheckbox = overlay.querySelector<HTMLInputElement>('#stash-include-untracked');

    // 获取消息内容（去除首尾空格，空字符串表示不传消息）
    const message = messageInput?.value.trim() || '';
    // 是否包含未跟踪文件
    const includeUntracked = untrackedCheckbox?.checked ?? false;

    // 获取确认按钮引用，禁用以防止重复点击
    const confirmBtn = overlay.querySelector<HTMLElement>('#stash-push-confirm');
    if (confirmBtn) {
      confirmBtn.textContent = 'Stashing...';
      confirmBtn.setAttribute('disabled', 'true');
    }

    try {
      // 调用后端执行 git stash push 命令
      // message 为空字符串时，后端会使用 git 默认的 WIP 消息
      await repoService.pushStash(this.repoPath, includeUntracked, message);

      // 操作成功：关闭对话框
      this.closeDialog(overlay);

      // 触发成功回调，刷新界面（节点图、文件列表等）
      this.onSuccess();

      console.log('[StashManager] push stash 成功');
    } catch (err) {
      // 操作失败：弹出错误提示
      console.error('[StashManager] push stash 失败:', err);
      alert('Stash 失败：' + String(err));

      // 恢复确认按钮状态，让用户可以重试
      if (confirmBtn) {
        confirmBtn.textContent = '确认 Stash';
        confirmBtn.removeAttribute('disabled');
      }
    }
  }

  /**
   * 绑定 stash 操作对话框的事件
   *
   * 处理以下交互：
   *   1. 单选按钮切换：根据选择的操作显示/隐藏对应选项
   *   2. 取消按钮：关闭对话框
   *   3. 确认按钮：根据选择的操作执行对应命令
   *   4. 点击遮罩层和 ESC 键：关闭对话框
   *
   * @param overlay - 遮罩层 DOM 元素
   * @param params - stash 信息
   */
  private bindStashActionsEvents(overlay: HTMLElement, params: StashActionParams): void {
    // 获取需要动态显示/隐藏的元素
    const indexWrap = overlay.querySelector<HTMLElement>('#stash-index-wrap');
    const branchNameWrap = overlay.querySelector<HTMLElement>('#stash-branch-name-wrap');

    // 单选按钮切换事件
    const radios = overlay.querySelectorAll<HTMLInputElement>('input[name="stash-action"]');
    radios.forEach((radio) => {
      radio.addEventListener('change', () => {
        const action = radio.value;
        // --index 选项仅对 apply 和 pop 可见
        if (indexWrap) {
          indexWrap.style.display = (action === 'apply' || action === 'pop') ? 'flex' : 'none';
        }
        // 新分支名输入框仅对 branch 可见
        if (branchNameWrap) {
          branchNameWrap.style.display = (action === 'branch') ? 'flex' : 'none';
        }
      });
    });

    // 取消按钮
    const cancelBtn = overlay.querySelector<HTMLElement>('#stash-actions-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeDialog(overlay));
    }

    // 确认按钮
    const confirmBtn = overlay.querySelector<HTMLElement>('#stash-actions-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this.handleStashActionsConfirm(overlay, params).catch((err) => {
          console.error('[StashManager] stash 操作失败:', err);
        });
      });
    }

    // 点击遮罩层关闭
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) {
        this.closeDialog(overlay);
      }
    });

    // ESC 键关闭
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.body.contains(overlay)) {
        document.removeEventListener('keydown', escHandler);
        this.closeDialog(overlay);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  /**
   * 处理 stash 操作对话框的确认按钮
   *
   * 根据用户选择的操作执行对应的命令：
   *   - apply：调用 applyStash（带 --index 选项）
   *   - pop：调用 popStash（带 --index 选项）
   *   - branch：调用 branchFromStash（需要新分支名）
   *   - drop：调用 dropStash（先二次确认）
   *
   * @param overlay - 遮罩层 DOM 元素
   * @param params - stash 信息（包含 selector）
   */
  private async handleStashActionsConfirm(overlay: HTMLElement, params: StashActionParams): Promise<void> {
    // 获取用户选择的操作类型
    const selectedRadio = overlay.querySelector<HTMLInputElement>('input[name="stash-action"]:checked');
    const action = selectedRadio?.value || 'apply';

    // 获取 --index 复选框状态
    const indexCheckbox = overlay.querySelector<HTMLInputElement>('#stash-index');
    const useIndex = indexCheckbox?.checked ?? false;

    // 获取新分支名（仅 branch 操作需要）
    const branchNameInput = overlay.querySelector<HTMLInputElement>('#stash-branch-name');
    const branchName = branchNameInput?.value.trim() || '';

    // drop 操作的二次确认（不可恢复，需要用户明确同意）
    if (action === 'drop') {
      const confirmed = confirm(
        `⚠️ 确定要删除 ${params.selector} 吗？\n\n` +
        '此操作不可恢复，stash 中的变更将永久丢失。\n' +
        '如果只是想应用变更，请选择 Apply 或 Pop。'
      );
      if (!confirmed) return;
    }

    // branch 操作需要验证分支名不为空
    if (action === 'branch' && !branchName) {
      alert('请输入新分支名称');
      return;
    }

    // 获取确认按钮，禁用以防止重复点击
    const confirmBtn = overlay.querySelector<HTMLElement>('#stash-actions-confirm');
    if (confirmBtn) {
      confirmBtn.textContent = '执行中...';
      confirmBtn.setAttribute('disabled', 'true');
    }

    try {
      // 根据操作类型调用对应的后端命令
      switch (action) {
        case 'apply':
          // 应用 stash（保留 stash 记录）
          await repoService.applyStash(this.repoPath, params.selector, useIndex);
          break;
        case 'pop':
          // 弹出 stash（应用后删除）
          await repoService.popStash(this.repoPath, params.selector, useIndex);
          break;
        case 'branch':
          // 从 stash 创建新分支并切换
          await repoService.branchFromStash(this.repoPath, branchName, params.selector);
          break;
        case 'drop':
          // 删除 stash（不应用）
          await repoService.dropStash(this.repoPath, params.selector);
          break;
        default:
          console.warn('[StashManager] 未知的 stash 操作:', action);
          return;
      }

      // 操作成功：关闭对话框
      this.closeDialog(overlay);

      // 触发成功回调，刷新界面
      this.onSuccess();

      console.log(`[StashManager] stash ${action} 成功`);
    } catch (err) {
      // 操作失败：弹出错误提示
      console.error(`[StashManager] stash ${action} 失败:`, err);
      alert(`Stash ${action} 失败：` + String(err));

      // 恢复确认按钮状态
      if (confirmBtn) {
        confirmBtn.textContent = '执行';
        confirmBtn.removeAttribute('disabled');
      }
    }
  }

  /**
   * 关闭对话框
   *
   * 从页面中移除遮罩层和对话框的 DOM 元素，释放内存。
   *
   * @param overlay - 要移除的遮罩层 DOM 元素
   */
  private closeDialog(overlay: HTMLElement): void {
    // 检查元素是否还在 DOM 中（防止重复关闭）
    if (document.body.contains(overlay)) {
      overlay.remove();
    }
  }

  /**
   * 静态方法：获取仓库中的所有 stash 列表
   *
   * 提供给外部组件（如 commit-graph 或 app.ts）调用的便捷方法。
   * 内部调用 repoService.getStashes() 获取 stash 列表。
   *
   * 使用静态方法是因为此功能不依赖实例状态（不需要 repoPath 和 onSuccess），
   * 但为了与其他方法保持一致，也提供实例方法版本。
   *
   * @param repoPath - 仓库路径
   * @returns stash 记录列表（无 stash 时返回空数组）
   */
  public static async listStashes(repoPath: string): Promise<GitStash[]> {
    return await repoService.getStashes(repoPath);
  }

  /**
   * 实例方法：获取仓库中的所有 stash 列表
   *
   * 与静态方法功能相同，但使用实例保存的 repoPath。
   *
   * @returns stash 记录列表
   */
  public async listStashes(): Promise<GitStash[]> {
    return await repoService.getStashes(this.repoPath);
  }
}
