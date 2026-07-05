/*
 * 提交详情组件
 * 
 * 显示单个提交的完整详细信息，包括：
 * - 完整哈希和短哈希
 * - 作者名字和邮箱
 * - 提交日期（从提交信息中获取，ISO 8601 格式转为本地时间）
 * - 完整提交消息（第一行标题 + 正文描述）
 * - 涉及的文件列表及变更统计（新增/删除行数）
 * 
 * 数据来源：
 * - repoService.getCommitLog() → 获取提交元信息（作者、邮箱、日期、消息）
 * - repoService.getCommitDiff() → 获取文件变更列表和行数统计
 * 
 * 使用方式：
 * const commitDetail = new CommitDetail('detail-body');
 * await commitDetail.showCommit(repoPath, commitHash);
 */

import { repoService, type CommitInfo, type DiffResult } from '../services/repo-service.js';

/**
 * 提交详情组件类
 * 
 * 管理提交详情的显示，包括：
 * - 同时获取提交元信息和文件变更数据
 * - 将两个数据源合并后渲染完整的提交详情视图
 * - 显示作者、日期、消息、文件变更列表等
 */
export class CommitDetail {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 文件点击回调函数，参数为文件路径和提交哈希 */
  private onFileClick: ((filePath: string, commitHash: string) => void) | null;
  /** 当前提交哈希（用于文件点击回调） */
  private currentCommitHash: string | null = null;

  /**
   * 创建提交详情组件
   * 
   * @param containerId - 容器 DOM 元素的 ID
   * @param onFileClick - 文件点击回调函数（可选），参数为文件路径和提交哈希
   */
  constructor(containerId: string, onFileClick?: (filePath: string, commitHash: string) => void) {
    this.containerId = containerId;
    this.onFileClick = onFileClick || null;
  }

  /**
   * 获取容器 DOM 元素
   * 
   * 每次使用时重新查询 DOM，避免 app.render() 重新渲染后引用失效。
   * 
   * @returns 容器 DOM 元素，如果不存在则返回 null
   */
  private get container(): HTMLElement | null {
    return document.getElementById(this.containerId);
  }

  /**
   * 显示提交详情
   * 
   * 同时获取提交的元信息（作者、日期、消息）和文件变更数据，
   * 然后合并两个数据源渲染完整的提交详情。
   * 
   * 实现步骤：
   * 1. 调用 repoService.getCommitLog() 获取提交列表
   * 2. 从列表中通过哈希匹配找到目标提交的元信息
   * 3. 调用 repoService.getCommitDiff() 获取文件变更列表
   * 4. 将元信息和 diff 数据一起传给 render() 渲染
   * 
   * @param repoPath - 仓库路径
   * @param commitHash - 提交的完整哈希值
   */
  async showCommit(repoPath: string, commitHash: string): Promise<void> {
    if (!this.container) return;

    try {
      // 并行获取提交元信息和文件变更数据，提升加载速度
      // getCommitLog 获取提交列表（包含作者、邮箱、日期、消息）
      // getCommitDiff 获取该提交的文件变更列表（包含每个文件的新增/删除行数）
      const [commitList, diffResult] = await Promise.all([
        repoService.getCommitLog(repoPath, 100),
        repoService.getCommitDiff(repoPath, commitHash),
      ]);

      // 从提交列表中查找目标提交的元信息
      // 通过完整哈希匹配，找到对应的 CommitInfo 对象
      const commitInfo = commitList.commits.find(c => c.hash === commitHash);

      if (!commitInfo) {
        // 如果在最近 100 条提交中找不到，显示错误提示
        this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">找不到该提交的信息: ${commitHash}</p>`;
        return;
      }

      // 将提交元信息和文件变更数据一起传给渲染方法
      this.currentCommitHash = commitHash;
      this.render(commitInfo, diffResult);
    } catch (err) {
      console.error('获取提交详情失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取提交详情失败: ${err}</p>`;
    }
  }

  /**
   * 解析提交消息，分离标题和正文
   * 
   * Git 提交消息的格式约定：
   * - 第一行是标题（简短的描述）
   * - 空行分隔后是正文（详细的描述，可能有多行）
   * 
   * 例如：
   *   "修复登录页面的验证问题\n\n详细修改了表单验证逻辑..."
   *   → title: "修复登录页面的验证问题"
   *   → body: "详细修改了表单验证逻辑..."
   * 
   * @param message - 完整的提交消息字符串
   * @returns 包含 title（标题）和 body（正文）的对象
   */
  private parseCommitMessage(message: string): { title: string; body: string } {
    // 按换行符分割消息
    const lines = message.split('\n');

    // 第一行就是标题
    const title = lines[0] || '(无提交消息)';

    // 从第二行开始是正文，跳过标题和标题后的空行
    // 找到第一个非空行作为正文的起始位置
    let bodyStartIndex = 1;
    while (bodyStartIndex < lines.length && lines[bodyStartIndex].trim() === '') {
      bodyStartIndex++;
    }

    // 将正文部分的所有行拼接起来
    const body = lines.slice(bodyStartIndex).join('\n').trim();

    return { title, body };
  }

  /**
   * 将 ISO 8601 格式的日期字符串转为本地可读格式
   * 
   * 后端返回的日期格式示例：
   * - "2024-03-15T10:30:00+08:00"
   * - "2024-03-15T02:30:00Z"
   * 
   * 转换后的本地格式示例：
   * - "2024/3/15 10:30:00"
   * 
   * @param isoDate - ISO 8601 格式的日期字符串（从 CommitInfo.date 获取）
   * @returns 本地化的日期字符串，如果解析失败则返回原始字符串
   */
  private formatDate(isoDate: string): string {
    try {
      // 使用 Date 构造函数解析 ISO 8601 格式
      const date = new Date(isoDate);
      // 检查日期是否有效（无效日期的 getTime() 返回 NaN）
      if (isNaN(date.getTime())) {
        return isoDate;
      }
      // 转为中文本地时间格式
      return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
    } catch {
      // 解析失败时返回原始字符串
      return isoDate;
    }
  }

  /**
   * 对 HTML 特殊字符进行转义，防止 XSS 攻击
   * 
   * 提交消息中可能包含 <、>、& 等 HTML 特殊字符，
   * 直接插入 innerHTML 会导致显示异常或安全问题，
   * 所以需要先将这些字符转为 HTML 实体。
   * 
   * @param text - 需要转义的原始文本
   * @returns 转义后的安全文本
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 渲染提交详情
   * 
   * 将提交元信息和文件变更数据合并渲染成完整的 HTML 视图。
   * 视图结构分为三个区域：
   * 1. 头部区域 - 显示提交标题（消息第一行）
   * 2. 信息区域 - 显示哈希、作者、邮箱、日期、完整消息
   * 3. 文件区域 - 显示变更文件列表和行数统计
   * 
   * @param commitInfo - 提交的元信息（哈希、作者、邮箱、日期、消息）
   * @param diffResult - 提交的文件变更数据（文件列表、新增/删除行数统计）
   */
  private render(commitInfo: CommitInfo, diffResult: DiffResult): void {
    if (!this.container) return;

    // 解析提交消息，分离标题和正文
    const { title, body } = this.parseCommitMessage(commitInfo.message);

    // 格式化提交日期（从 ISO 8601 转为本地可读格式）
    const dateStr = this.formatDate(commitInfo.date);

    // 对可能包含 HTML 特殊字符的内容进行转义
    const safeTitle = this.escapeHtml(title);
    const safeBody = this.escapeHtml(body);
    const safeAuthor = this.escapeHtml(commitInfo.author);
    const safeEmail = this.escapeHtml(commitInfo.email);

    // 生成完整的提交详情 HTML
    let html = `
      <div class="commit-detail-container">
        <!-- 头部区域：显示提交标题 -->
        <div class="commit-detail-header">
          <h3 class="commit-detail-title">${safeTitle}</h3>
        </div>
        
        <!-- 信息区域：显示提交的详细元信息 -->
        <div class="commit-detail-info">
          <!-- 完整哈希（40 位 SHA-1） -->
          <div class="commit-detail-row">
            <span class="commit-detail-label">哈希:</span>
            <span class="commit-detail-value commit-hash-full" title="${commitInfo.hash}">
              ${commitInfo.hash}
            </span>
          </div>
          <!-- 短哈希（通常 7 位，方便复制和引用） -->
          <div class="commit-detail-row">
            <span class="commit-detail-label">短哈希:</span>
            <span class="commit-detail-value">${commitInfo.short_hash}</span>
          </div>
          <!-- 作者名字 -->
          <div class="commit-detail-row">
            <span class="commit-detail-label">作者:</span>
            <span class="commit-detail-value">${safeAuthor}</span>
          </div>
          <!-- 作者邮箱 -->
          <div class="commit-detail-row">
            <span class="commit-detail-label">邮箱:</span>
            <span class="commit-detail-value">${safeEmail}</span>
          </div>
          <!-- 提交日期（从提交信息中获取，不是当前时间） -->
          <div class="commit-detail-row">
            <span class="commit-detail-label">日期:</span>
            <span class="commit-detail-value">${dateStr}</span>
          </div>
    `;

    // 如果有正文内容（正文不为空），则显示正文区域
    if (safeBody) {
      html += `
          <!-- 提交消息正文（详细描述） -->
          <div class="commit-detail-row commit-detail-message-body">
            <span class="commit-detail-label">描述:</span>
            <pre class="commit-detail-value commit-message-pre">${safeBody}</pre>
          </div>
      `;
    }

    // 文件变更区域：显示涉及的文件列表和统计信息
    html += `
        </div>

        <!-- 文件变更区域 -->
        <div class="commit-detail-files">
          <h4 class="commit-detail-subtitle">
            文件变更 (${diffResult.files.length})
            <!-- 总变更统计：总新增行数和总删除行数 -->
            <span class="commit-detail-stats">
              <span class="diff-additions">+${diffResult.total_additions}</span>
              <span class="diff-deletions">-${diffResult.total_deletions}</span>
            </span>
          </h4>
          <div class="commit-file-list">
    `;

    // 遍历每个变更的文件，生成文件列表项
    for (const file of diffResult.files) {
      // 根据文件变更类型选择不同的图标
      const icon = file.is_new ? '➕' : file.is_deleted ? '🗑️' : file.is_renamed ? '✂️' : '📄';
      // 根据文件变更类型选择不同的状态文字
      const statusText = file.is_new ? '新增' : file.is_deleted ? '删除' : file.is_renamed ? '重命名' : '修改';

      html += `
        <div class="commit-file-item" data-file-path="${this.escapeHtml(file.path)}" style="cursor: pointer;">
          <!-- 文件状态图标 -->
          <span class="commit-file-icon">${icon}</span>
          <!-- 文件路径（鼠标悬停显示完整路径） -->
          <span class="commit-file-path" title="${this.escapeHtml(file.path)}">${this.escapeHtml(file.path)}</span>
          <!-- 文件变更状态 -->
          <span class="commit-file-status">${statusText}</span>
          <!-- 文件变更行数统计 -->
          <span class="commit-file-stats">
            <span class="diff-additions">+${file.additions}</span>
            <span class="diff-deletions">-${file.deletions}</span>
          </span>
        </div>
      `;
    }

    // 闭合所有 HTML 标签
    html += `
          </div>
        </div>
      </div>
    `;

    // 将生成的 HTML 插入到容器中
    this.container.innerHTML = html;

    // 绑定文件点击事件
    this.bindFileClickEvents();
  }

  /**
   * 绑定文件列表项的点击事件
   * 
   * 点击文件时，如果设置了 onFileClick 回调，则调用它来显示左右分栏对比视图。
   */
  private bindFileClickEvents(): void {
    if (!this.container || !this.onFileClick || !this.currentCommitHash) return;

    const fileItems = this.container.querySelectorAll('.commit-file-item');
    for (const item of fileItems) {
      const filePath = item.getAttribute('data-file-path');
      if (filePath) {
        item.addEventListener('click', () => {
          this.onFileClick!(filePath, this.currentCommitHash!);
        });
      }
    }
  }
}
