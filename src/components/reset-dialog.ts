/**
 * 撤销提交对话框组件
 * 
 * 这个组件实现了一个模态弹窗，让用户选择撤销提交的模式并执行操作。
 * 支持三种撤销模式：
 * - soft（软重置）：只撤销 commit，文件修改保留在暂存区，最安全
 * - mixed（混合重置）：撤销 commit 和暂存，文件修改保留在工作区但未暂存
 * - hard（硬重置）：完全撤销，丢弃所有更改，文件恢复到提交前的状态（危险！）
 * 
 * 当用户选择 hard 模式时，会弹出二次确认提示，防止误操作丢失数据。
 * 
 * 使用方式：
 *   const dialog = new ResetDialog(repoPath, () => {
 *     // 撤销成功后的回调，比如刷新界面
 *     refreshAllComponents();
 *   });
 *   dialog.show();
 */

import { repoService } from '../services/repo-service.js';

/**
 * 撤销提交对话框类
 * 
 * 负责创建并显示撤销提交的模态弹窗，
 * 包含模式选择、说明文字、确认/取消按钮等功能。
 */
export class ResetDialog {
  /** 当前打开的仓库路径，用于告诉后端要撤销哪个仓库的提交 */
  private repoPath: string;
  /** 撤销成功后要执行的回调函数，通常是刷新界面组件 */
  private onSuccess: () => void;
  /** 当前用户选择的撤销模式，默认是 "mixed"（最常用） */
  private selectedMode: string = 'mixed';
  /** 对话框的 DOM 容器元素引用 */
  private dialogEl: HTMLElement | null = null;

  /**
   * 构造函数
   * 
   * @param repoPath - 当前仓库的路径，后端需要这个路径来定位仓库
   * @param onSuccess - 撤销成功后的回调函数，用来刷新界面显示最新状态
   */
  constructor(repoPath: string, onSuccess: () => void) {
    this.repoPath = repoPath;
    this.onSuccess = onSuccess;
  }

  /**
   * 显示对话框
   * 
   * 创建一个模态弹窗覆盖在整个界面上，用户必须选择模式并确认或取消后才能关闭。
   * 弹窗包含：
   * 1. 标题 - 告诉用户这是撤销提交功能
   * 2. 三个单选按钮 - 分别对应 soft/mixed/hard 三种模式
   * 3. 每种模式的说明文字 - 帮助用户理解各模式的区别
   * 4. 确认按钮和取消按钮
   */
  show(): void {
    // 创建遮罩层 - 半透明黑色背景，覆盖整个窗口
    // 遮罩层的作用：1. 让用户注意到弹窗 2. 阻止点击弹窗后面的内容
    const overlay = document.createElement('div');
    overlay.className = 'reset-dialog-overlay';

    // 创建对话框主体容器
    const dialog = document.createElement('div');
    dialog.className = 'reset-dialog';
    this.dialogEl = dialog;

    // 组装对话框内部的 HTML 内容
    dialog.innerHTML = `
      <!-- 对话框标题区域 -->
      <div class="reset-dialog-header">
        <h3 class="reset-dialog-title">撤销提交</h3>
        <p class="reset-dialog-subtitle">选择撤销模式，撤销最近一次提交</p>
      </div>

      <!-- 模式选择区域 - 三个单选按钮，每个都有标题和说明 -->
      <div class="reset-dialog-body">
        <!-- soft 模式选项 -->
        <label class="reset-mode-option">
          <input type="radio" name="reset-mode" value="soft" class="reset-mode-radio" />
          <div class="reset-mode-content">
            <span class="reset-mode-title">软重置 (Soft)</span>
            <span class="reset-mode-desc">撤销提交，但保留更改在暂存区。文件修改不会丢失，可以重新提交。</span>
          </div>
        </label>

        <!-- mixed 模式选项（默认选中，因为最常用） -->
        <label class="reset-mode-option">
          <input type="radio" name="reset-mode" value="mixed" class="reset-mode-radio" checked />
          <div class="reset-mode-content">
            <span class="reset-mode-title">混合重置 (Mixed)</span>
            <span class="reset-mode-desc">撤销提交和暂存，保留更改在工作区。文件修改还在，但需要重新暂存。</span>
          </div>
        </label>

        <!-- hard 模式选项（危险操作，需要二次确认） -->
        <label class="reset-mode-option reset-mode-danger">
          <input type="radio" name="reset-mode" value="hard" class="reset-mode-radio" />
          <div class="reset-mode-content">
            <span class="reset-mode-title">硬重置 (Hard) ⚠️</span>
            <span class="reset-mode-desc">完全撤销提交，丢弃所有更改。文件将恢复到提交前的状态，此操作不可恢复！</span>
          </div>
        </label>

        <!-- 硬重置的额外警告提示 - 默认隐藏，选择 hard 模式时显示 -->
        <div class="reset-dialog-warning" id="reset-warning" style="display: none;">
          ⚠️ 警告：硬重置会永久删除所有未提交的更改，包括暂存区和工作区的修改。请确认你已经备份了重要数据！
        </div>
      </div>

      <!-- 底部按钮区域 -->
      <div class="reset-dialog-footer">
        <button class="btn reset-dialog-cancel" id="reset-cancel-btn">取消</button>
        <button class="btn btn-danger reset-dialog-confirm" id="reset-confirm-btn">确认撤销</button>
      </div>
    `;

    // 把对话框添加到遮罩层上
    overlay.appendChild(dialog);
    // 把遮罩层添加到页面中
    document.body.appendChild(overlay);

    // 绑定事件监听器
    this.bindEvents(overlay);
  }

  /**
   * 绑定对话框内的事件监听器
   * 
   * 处理以下交互：
   * 1. 单选按钮切换 - 更新选中的模式，显示/隐藏硬重置警告
   * 2. 取消按钮 - 关闭对话框，不执行任何操作
   * 3. 确认按钮 - 执行撤销操作（硬重置时先二次确认）
   * 4. 点击遮罩层 - 关闭对话框（等同于取消）
   * 
   * @param overlay - 遮罩层 DOM 元素
   */
  private bindEvents(overlay: HTMLElement): void {
    // 获取所有单选按钮
    const radios = overlay.querySelectorAll<HTMLInputElement>('input[name="reset-mode"]');
    // 获取警告提示元素
    const warning = overlay.querySelector<HTMLElement>('#reset-warning');

    // 给每个单选按钮绑定 change 事件
    // 当用户切换模式时，更新 selectedMode 并控制警告提示的显示
    radios.forEach((radio) => {
      radio.addEventListener('change', () => {
        // 更新当前选中的模式
        this.selectedMode = radio.value;
        // 如果选择了 hard 模式，显示警告提示；否则隐藏
        if (warning) {
          warning.style.display = radio.value === 'hard' ? 'block' : 'none';
        }
      });
    });

    // 取消按钮 - 点击后关闭对话框
    const cancelBtn = overlay.querySelector<HTMLElement>('#reset-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        this.close(overlay);
      });
    }

    // 确认按钮 - 执行撤销操作
    const confirmBtn = overlay.querySelector<HTMLElement>('#reset-confirm-btn');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => {
        this.handleConfirm(overlay);
      });
    }

    // 点击遮罩层（对话框外面的区域）也可以关闭对话框
    overlay.addEventListener('click', (e) => {
      // 只有点击的是遮罩层本身才关闭，点击对话框内部不关闭
      if (e.target === overlay) {
        this.close(overlay);
      }
    });
  }

  /**
   * 处理确认按钮的点击事件
   * 
   * 执行流程：
   * 1. 如果选择了 hard 模式，先弹出浏览器的 confirm 二次确认对话框
   * 2. 用户确认后，调用后端 API 执行 git reset
   * 3. 成功后关闭对话框并触发回调刷新界面
   * 4. 失败时弹出错误提示
   * 
   * @param overlay - 遮罩层 DOM 元素，用于在操作完成后关闭对话框
   */
  private async handleConfirm(overlay: HTMLElement): Promise<void> {
    // 硬重置的二次确认 - 防止用户手滑误操作
    // 使用浏览器原生的 confirm 对话框，返回 true 表示用户点击了"确定"
    if (this.selectedMode === 'hard') {
      const confirmed = confirm(
        '⚠️ 确定要执行硬重置吗？\n\n' +
        '这将永久删除最近一次提交的所有更改，包括：\n' +
        '- 暂存区的修改\n' +
        '- 工作区的修改\n\n' +
        '此操作不可恢复！建议先备份重要文件。'
      );
      // 用户在二次确认中点击了"取消"，则不执行操作
      if (!confirmed) return;
    }

    try {
      // 禁用确认按钮，防止用户重复点击
      const confirmBtn = overlay.querySelector<HTMLElement>('#reset-confirm-btn');
      if (confirmBtn) {
        confirmBtn.textContent = '撤销中...';
        confirmBtn.setAttribute('disabled', 'true');
      }

      // 调用后端 API 执行 git reset
      // repoPath: 仓库路径，mode: 撤销模式（soft/mixed/hard）
      await repoService.resetCommit(this.repoPath, this.selectedMode);

      // 撤销成功 - 关闭对话框
      this.close(overlay);

      // 执行成功回调，刷新界面组件（文件列表、提交历史等）
      this.onSuccess();
    } catch (err) {
      // 撤销失败 - 弹出错误提示
      console.error('撤销提交失败:', err);
      alert('撤销提交失败：' + String(err));

      // 恢复确认按钮状态，让用户可以重试
      const confirmBtn = overlay.querySelector<HTMLElement>('#reset-confirm-btn');
      if (confirmBtn) {
        confirmBtn.textContent = '确认撤销';
        confirmBtn.removeAttribute('disabled');
      }
    }
  }

  /**
   * 关闭并销毁对话框
   * 
   * 从页面中移除遮罩层和对话框的 DOM 元素，释放内存。
   * 
   * @param overlay - 要移除的遮罩层 DOM 元素
   */
  private close(overlay: HTMLElement): void {
    // 从页面中移除遮罩层（包括里面的对话框）
    overlay.remove();
    // 清空引用，帮助垃圾回收
    this.dialogEl = null;
  }
}
