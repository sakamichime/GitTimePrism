/**
 * 分支列表组件
 * 
 * 在工具栏中显示当前分支名，并提供分支切换功能。
 * 点击分支按钮会弹出下拉列表，显示所有本地和远程分支。
 * 点击分支项可以切换到该分支。
 * 
 * 数据来源：
 * - repoService.getBranches() → 获取本地和远程分支列表
 * - repoService.checkoutBranch() → 切换到指定分支
 * 
 * 使用方式：
 * const branchList = new BranchList('toolbar', repoPath, onBranchChange);
 * await branchList.refresh();
 */

import { repoService, type BranchList as BranchListData, type BranchInfo } from '../services/repo-service.js';

/**
 * 分支列表组件类
 * 
 * 管理分支列表的显示和交互，包括：
 * - 在工具栏中显示当前分支名
 * - 弹出分支列表下拉菜单
 * - 点击分支项执行切换操作
 * - 切换成功后刷新所有组件
 */
export class BranchList {
  /** 工具栏容器 DOM 元素的 ID */
  private toolbarId: string;
  /** 仓库路径 */
  private repoPath: string;
  /** 分支切换成功后的回调函数 */
  private onBranchChange: () => void;
  /** 工具栏容器 DOM 元素引用 */
  private toolbar: HTMLElement | null = null;
  /** 分支按钮 DOM 元素引用 */
  private branchButton: HTMLElement | null = null;
  /** 分支列表下拉菜单 DOM 元素引用 */
  private dropdown: HTMLElement | null = null;
  /** 当前分支数据 */
  private currentBranch: BranchInfo | null = null;
  /** 分支列表数据 */
  private branchData: BranchListData | null = null;
  /** 下拉菜单是否可见 */
  private dropdownVisible: boolean = false;

  /**
   * 创建分支列表组件
   * 
   * @param toolbarId - 工具栏容器 DOM 元素的 ID
   * @param repoPath - 仓库路径
   * @param onBranchChange - 分支切换成功后的回调函数
   */
  constructor(toolbarId: string, repoPath: string, onBranchChange: () => void) {
    this.toolbarId = toolbarId;
    this.repoPath = repoPath;
    this.onBranchChange = onBranchChange;
    this.toolbar = document.getElementById(toolbarId);
  }

  /**
   * 刷新分支列表
   * 
   * 从后端获取最新的分支列表数据，并更新工具栏中的分支显示。
   * 每次切换分支后应调用此方法刷新显示。
   */
  async refresh(): Promise<void> {
    if (!this.toolbar) return;

    try {
      // 获取分支列表数据
      this.branchData = await repoService.getBranches(this.repoPath);

      // 查找当前分支（is_current 为 true 的分支）
      this.currentBranch = this.branchData.local.find(b => b.is_current) || null;

      // 渲染分支按钮
      this.renderBranchButton();
    } catch (err) {
      console.error('获取分支列表失败:', err);
    }
  }

  /**
   * 渲染分支按钮
   * 
   * 在工具栏中显示当前分支名的按钮。
   * 如果还没有分支按钮，则创建并添加到工具栏中。
   */
  private renderBranchButton(): void {
    if (!this.toolbar) return;

    // 如果分支按钮已存在，只更新文本内容
    if (this.branchButton) {
      const branchName = this.currentBranch ? this.currentBranch.name : '无分支';
      this.branchButton.textContent = `🌿 ${branchName}`;
      return;
    }

    // 创建分支按钮
    this.branchButton = document.createElement('button');
    this.branchButton.className = 'btn branch-button';
    this.branchButton.id = 'btn-branch-list';
    
    const branchName = this.currentBranch ? this.currentBranch.name : '无分支';
    this.branchButton.textContent = `🌿 ${branchName}`;
    this.branchButton.title = '切换分支';

    // 绑定点击事件，显示/隐藏下拉菜单
    this.branchButton.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // 将分支按钮插入到工具栏左侧区域的末尾
    const toolbarLeft = this.toolbar.querySelector('#toolbar-left');
    if (toolbarLeft) {
      toolbarLeft.appendChild(this.branchButton);
    }

    // 创建下拉菜单（初始隐藏）
    this.createDropdown();

    // 绑定全局点击事件，点击其他地方时关闭下拉菜单
    document.addEventListener('click', () => {
      this.hideDropdown();
    });
  }

  /**
   * 创建分支列表下拉菜单
   * 
   * 创建一个绝对定位的下拉菜单，用于显示所有分支列表。
   * 初始状态为隐藏。
   */
  private createDropdown(): void {
    if (!this.branchButton) return;

    // 创建下拉菜单容器
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'branch-dropdown';
    this.dropdown.style.display = 'none';

    // 将下拉菜单添加到 body（避免被父元素的 overflow 裁剪）
    document.body.appendChild(this.dropdown);

    // 更新下拉菜单的位置（相对于分支按钮）
    this.updateDropdownPosition();
  }

  /**
   * 更新下拉菜单的位置
   * 
   * 根据分支按钮的位置，计算下拉菜单的绝对定位坐标。
   * 下拉菜单显示在分支按钮的正下方。
   */
  private updateDropdownPosition(): void {
    if (!this.branchButton || !this.dropdown) return;

    const rect = this.branchButton.getBoundingClientRect();
    this.dropdown.style.position = 'fixed';
    this.dropdown.style.top = `${rect.bottom + 4}px`;
    this.dropdown.style.left = `${rect.left}px`;
    this.dropdown.style.minWidth = `${rect.width}px`;
  }

  /**
   * 切换下拉菜单的显示/隐藏状态
   * 
   * 如果下拉菜单当前隐藏，则显示它并渲染分支列表。
   * 如果当前显示，则隐藏它。
   */
  private toggleDropdown(): void {
    if (this.dropdownVisible) {
      this.hideDropdown();
    } else {
      this.showDropdown();
    }
  }

  /**
   * 显示下拉菜单
   * 
   * 渲染分支列表内容，更新位置，并显示下拉菜单。
   */
  private showDropdown(): void {
    if (!this.dropdown) return;

    // 渲染分支列表内容
    this.renderDropdownContent();

    // 更新位置（可能在窗口调整后位置变化）
    this.updateDropdownPosition();

    // 显示下拉菜单
    this.dropdown.style.display = 'block';
    this.dropdownVisible = true;
  }

  /**
   * 隐藏下拉菜单
   * 
   * 将下拉菜单的 display 设置为 none。
   */
  private hideDropdown(): void {
    if (!this.dropdown) return;

    this.dropdown.style.display = 'none';
    this.dropdownVisible = false;
  }

  /**
   * 渲染下拉菜单的内容
   * 
   * 将分支列表数据渲染为 HTML，包括：
   * - 创建新分支按钮
   * - 本地分支列表（带当前分支标记）
   * - 远程分支列表（如果有）
   * - 每个分支项包含分支名和最新提交信息
   */
  private renderDropdownContent(): void {
    if (!this.dropdown || !this.branchData) return;

    let html = '';

    // 创建新分支按钮
    html += `<div class="branch-section">`;
    html += `<div class="branch-list">`;
    html += `<div class="branch-item branch-create-new" data-action="create">`;
    html += `<span class="branch-item-name">✨ 创建新分支</span>`;
    html += `</div>`;
    html += `</div>`;
    html += `</div>`;

    // 本地分支列表
    if (this.branchData.local.length > 0) {
      html += `<div class="branch-section">`;
      html += `<div class="branch-section-title">本地分支</div>`;
      html += `<div class="branch-list">`;

      for (const branch of this.branchData.local) {
        html += this.renderBranchItem(branch, false);
      }

      html += `</div>`;
      html += `</div>`;
    }

    // 远程分支列表
    if (this.branchData.remote.length > 0) {
      html += `<div class="branch-section">`;
      html += `<div class="branch-section-title">远程分支</div>`;
      html += `<div class="branch-list">`;

      for (const branch of this.branchData.remote) {
        html += this.renderBranchItem(branch, true);
      }

      html += `</div>`;
      html += `</div>`;
    }

    this.dropdown.innerHTML = html;

    // 为每个分支项绑定点击事件
    this.bindBranchClickEvents();
  }

  /**
   * 渲染单个分支项
   * 
   * @param branch - 分支信息
   * @param isRemote - 是否是远程分支
   * @returns 分支项的 HTML 字符串
   */
  private renderBranchItem(branch: BranchInfo, isRemote: boolean): string {
    // 当前分支的标记
    const currentMark = branch.is_current ? ' ✓' : '';
    const currentClass = branch.is_current ? ' branch-item-current' : '';

    // 分支名显示（远程分支显示完整名称，如 origin/main）
    const displayName = isRemote ? branch.name : branch.name;

    // 领先/落后信息（如果有上游分支）
    let aheadBehind = '';
    if (branch.upstream && (branch.ahead > 0 || branch.behind > 0)) {
      aheadBehind = `<span class="branch-ahead-behind">`;
      if (branch.ahead > 0) {
        aheadBehind += `<span class="branch-ahead">↑${branch.ahead}</span>`;
      }
      if (branch.behind > 0) {
        aheadBehind += `<span class="branch-behind">↓${branch.behind}</span>`;
      }
      aheadBehind += `</span>`;
    }

    return `
      <div class="branch-item${currentClass}" data-branch-name="${branch.name}" data-is-remote="${isRemote}">
        <span class="branch-item-name">${displayName}${currentMark}</span>
        ${aheadBehind}
      </div>
    `;
  }

  /**
   * 为分支项绑定点击事件
   * 
   * 点击分支项后，执行分支切换操作。
   * 如果点击的是当前分支，则不做任何操作。
   * 如果点击的是"创建新分支"，则弹出输入框让用户输入分支名。
   */
  private bindBranchClickEvents(): void {
    if (!this.dropdown) return;

    const branchItems = this.dropdown.querySelectorAll('.branch-item');
    branchItems.forEach((item) => {
      item.addEventListener('click', async (e) => {
        e.stopPropagation();

        // 检查是否是"创建新分支"按钮
        const action = item.getAttribute('data-action');
        if (action === 'create') {
          this.hideDropdown();
          await this.handleCreateBranch();
          return;
        }

        // 从 data 属性获取分支名和是否是远程分支
        const branchName = item.getAttribute('data-branch-name');
        const isRemote = item.getAttribute('data-is-remote') === 'true';

        if (!branchName) return;

        // 如果点击的是当前分支，关闭下拉菜单即可
        if (this.currentBranch && this.currentBranch.name === branchName && !isRemote) {
          this.hideDropdown();
          return;
        }

        // 执行分支切换
        await this.handleBranchSwitch(branchName, isRemote);
      });
    });
  }

  /**
   * 处理创建新分支
   * 
   * 弹出输入框让用户输入新分支名称，
   * 然后调用后端创建分支并切换到新分支。
   */
  private async handleCreateBranch(): Promise<void> {
    const branchName = prompt('请输入新分支名称：');
    if (!branchName || !branchName.trim()) return;

    const trimmedName = branchName.trim();

    try {
      // 调用后端创建分支并切换（git checkout -b）
      await repoService.createAndCheckout(this.repoPath, trimmedName);
      console.log('[BranchList] 创建分支成功:', trimmedName);

      // 刷新分支列表
      await this.refresh();

      // 调用回调函数，刷新所有组件
      this.onBranchChange();
    } catch (err) {
      console.error('[BranchList] 创建分支失败:', err);
      alert(`创建分支失败: ${err}`);
    }
  }

  /**
   * 获取当前分支名称
   *
   * 供外部组件（如 app.ts）调用，用于获取当前检出的分支名。
   *
   * @returns 当前分支名，如果没有则返回 null
   */
  getCurrentBranchName(): string | null {
    return this.currentBranch?.name ?? null;
  }

  /**
   * 处理分支切换
   * 
   * 调用后端执行分支切换操作，处理成功和失败情况。
   * 
   * @param branchName - 要切换到的分支名
   * @param isRemote - 是否是远程分支
   */
  private async handleBranchSwitch(branchName: string, isRemote: boolean): Promise<void> {
    try {
      // 如果是远程分支，需要先切换到对应的本地分支（如果不存在则创建）
      // 这里简化处理：直接切换到远程分支名（Git 会自动创建本地跟踪分支）
      const targetBranch = isRemote ? branchName : branchName;

      // 调用后端执行分支切换
      await repoService.checkoutBranch(this.repoPath, targetBranch);

      console.log(`切换到分支: ${branchName}`);

      // 关闭下拉菜单
      this.hideDropdown();

      // 调用回调函数，刷新所有组件
      this.onBranchChange();

      // 刷新分支列表（更新当前分支显示）
      await this.refresh();
    } catch (err) {
      console.error('切换分支失败:', err);
      alert(`切换分支失败: ${err}`);
    }
  }
}
