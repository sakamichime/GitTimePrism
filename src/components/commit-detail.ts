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
 * 此外还支持以下扩展功能：
 * - 对比模式（showComparison）：显示两个提交之间的文件变更列表
 * - 文件树（FileTree）/ 文件列表（FileList）两种视图切换
 * - compactFolders：折叠只含单个子文件夹的路径（如 a/b/c → a / b / c）
 * - Code Review：标记文件已审/未审，进度指示，状态持久化到 localStorage
 * - 文件右键菜单（View Diff / View File at Revision / Open File / Mark as Reviewed / Copy Path 等）
 *
 * 数据来源：
 * - repoService.getCommitLog() → 获取提交元信息（作者、邮箱、日期、消息）
 * - repoService.getCommitDiff() → 获取单提交文件变更列表和行数统计
 * - repoService.getCommitComparison() → 获取两提交之间的对比结果（GitFileChange 列表）
 *
 * 使用方式：
 * const commitDetail = new CommitDetail('detail-body');
 * await commitDetail.showCommit(repoPath, commitHash);
 * await commitDetail.showComparison(repoPath, fromHash, toHash);
 */

import { repoService, type CommitInfo, type DiffResult, type FileDiff } from '../services/repo-service.js';
// 导入 Git 类型定义
// GitFileChange：对比模式返回的文件变更结构（含 oldFilePath/newFilePath/type/additions/deletions）
// GitFileStatus：文件变更类型枚举（Added/Modified/Deleted/Renamed/Untracked）
// FileViewType：文件视图类型枚举（Default/Tree/List）
// GitSignature：GPG 签名信息结构（key/signer/status）（阶段 9：Task 9.5：用于在提交详情中显示签名状态）
// GitSignatureStatus：GPG 签名状态枚举（G/U/X/Y/R/E/B）
// GitCommitDetails：提交详情结构（含 author/committer 双套字段、signature、body）（Task 13.4：用于显示 committer 信息）
import type { GitFileChange, GitSignature, GitCommitDetails } from '../utils/git-types.js';
import { GitFileStatus, FileViewType, GitSignatureStatus } from '../utils/git-types.js';
// 导入右键菜单组件（用于文件右键菜单）
import { contextMenu, type ContextMenuAction, type ContextMenuTarget } from './context-menu.js';
// 导入 Code Review 服务（用于持久化审查状态）
import { codeReviewService } from '../services/code-review-service.js';
// 导入文本格式化工具（Task 11.2：用于格式化提交消息的标题和正文）
// formatLine：主入口函数，支持 Markdown/Emoji/Issue Linking 等完整格式化
import { formatLine } from '../utils/text-formatter.js';
// 导入配置服务（Task 11.2：读取 markdown/emoji/issueLinking 等配置）
import { configService } from '../services/config-service.js';

/**
 * 文件树节点接口
 *
 * 文件树的统一节点结构，文件夹和文件都用此结构表示。
 * - 文件夹节点：type='folder'，children 包含子节点
 * - 文件节点：type='file'，fileChange 包含该文件的变更信息
 */
export interface FileTreeNode {
  /** 节点名称（文件夹名或文件名，不含路径前缀） */
  name: string;
  /** 节点完整路径（相对于仓库根目录） */
  path: string;
  /** 节点类型：'folder' = 文件夹，'file' = 文件 */
  type: 'folder' | 'file';
  /** 子节点列表（仅文件夹节点有） */
  children?: FileTreeNode[];
  /** 文件变更信息（仅文件节点有） */
  fileChange?: NormalizedFileChange;
  /** 文件夹是否展开（仅文件夹节点有意义；默认 true） */
  open?: boolean;
  /** 该节点下的所有文件是否都已审查（Code Review 时使用） */
  reviewed?: boolean;
}

/**
 * 归一化后的文件变更信息
 *
 * 将 DiffResult 中的 FileDiff 和 CommitComparison 中的 GitFileChange
 * 统一为同一结构，方便文件树渲染逻辑使用。
 */
export interface NormalizedFileChange {
  /** 变更后的文件路径（新路径；删除文件时仍为原路径） */
  path: string;
  /** 变更前的文件路径（仅重命名文件有值；其他情况与 path 相同） */
  oldPath: string | null;
  /** 新增行数；无法统计时为 null */
  additions: number | null;
  /** 删除行数；无法统计时为 null */
  deletions: number | null;
  /** 文件变更类型（Added/Modified/Deleted/Renamed/Untracked） */
  status: GitFileStatus;
}

/**
 * 提交详情视图模式
 *
 * 区分当前显示的是单提交详情还是两提交对比。
 * - 'commit'：单提交详情（显示作者、日期、消息 + 文件变更）
 * - 'comparison'：两提交对比（只显示文件变更列表）
 */
type DetailViewMode = 'commit' | 'comparison';

/**
 * 提交详情组件类
 *
 * 管理提交详情的显示，支持单提交详情和两提交对比两种模式。
 *
 * 主要职责：
 *   1. 调用后端 API 获取提交元信息和文件变更数据
 *   2. 渲染提交详情或对比视图
 *   3. 提供文件树/文件列表两种视图切换
 *   4. 集成 Code Review（标记已审、进度指示、持久化）
 *   5. 集成文件右键菜单
 *
 * 使用方式：
 *   const detail = new CommitDetail('detail-body', (filePath, commitHash) => {
 *     // 点击文件时打开 diff 面板
 *   });
 *   await detail.showCommit(repoPath, hash);
 */
export class CommitDetail {
  /** 容器 DOM 元素的 ID */
  private containerId: string;
  /** 文件点击回调函数，参数为文件路径和提交哈希 */
  private onFileClick: ((filePath: string, commitHash: string) => void) | null;
  /** Task 13.5：文件历史查看回调函数，参数为文件路径（用于右键菜单"查看文件历史"） */
  private onFileHistory: ((filePath: string) => void) | null;

  /** 当前视图模式：'commit' = 单提交详情，'comparison' = 两提交对比 */
  private viewMode: DetailViewMode = 'commit';
  /** 当前仓库路径（用于调用后端 API 和 Code Review 持久化） */
  private currentRepoPath: string | null = null;
  /** 当前提交哈希（单提交模式下使用） */
  private currentCommitHash: string | null = null;
  /** 对比模式的起始提交哈希（from） */
  private compareFromHash: string | null = null;
  /** 对比模式的目标提交哈希（to） */
  private compareToHash: string | null = null;

  /** 当前文件变更列表（归一化后的统一格式） */
  private fileChanges: NormalizedFileChange[] = [];
  /** 当前文件树根节点（仅 FileTree 视图使用） */
  private fileTreeRoot: FileTreeNode | null = null;

  /** 文件视图类型：Tree（树形）或 List（列表） */
  private fileViewType: FileViewType = FileViewType.Tree;
  /** 是否启用 compactFolders（折叠只含单个子文件夹的路径） */
  private compactFolders: boolean = true;

  /** 当前提交的元信息（仅 'commit' 模式有值；'comparison' 模式为 null） */
  private commitInfo: CommitInfo | null = null;

  /**
   * 当前提交的 GPG 签名信息（阶段 9：Task 9.5）
   *
   * 通过 repoService.getCommitDetails() 获取，包含签名状态、签名者和密钥 ID。
   * - null = 此提交没有签名，或获取签名信息失败
   * - 非 null = 此提交有签名，包含签名详情
   *
   * 仅 'commit' 模式下有值；'comparison' 模式下为 null。
   */
  private commitSignature: GitSignature | null = null;

  /**
   * 当前提交的完整详情（Task 13.4：用于显示 committer 双套字段）
   *
   * 通过 repoService.getCommitDetails() 获取，包含 author 和 committer 双套字段。
   * - null = 此提交详情未获取或获取失败（此时只显示 commitInfo 中的 author 信息）
   * - 非 null = 包含完整的提交详情，可用于显示 committer 信息
   *
   * 仅 'commit' 模式下有值；'comparison' 模式下为 null。
   * 注意：获取此对象的目的之一是显示 committer（提交者）信息，
   * 当 committer 与 author 不同时（例如 rebase、cherry-pick、patch 应用等情况），
   * 会同时显示两套字段，帮助用户区分代码作者和实际执行 commit 的人。
   */
  private commitDetails: GitCommitDetails | null = null;

  /**
   * 创建提交详情组件
   *
   * @param containerId - 容器 DOM 元素的 ID
   * @param onFileClick - 文件点击回调函数（可选），参数为文件路径和提交哈希
   * @param onFileHistory - Task 13.5：文件历史查看回调函数（可选），参数为文件路径
   */
  constructor(
    containerId: string,
    onFileClick?: (filePath: string, commitHash: string) => void,
    onFileHistory?: (filePath: string) => void
  ) {
    this.containerId = containerId;
    this.onFileClick = onFileClick || null;
    this.onFileHistory = onFileHistory || null;
    // 应用启动时清理过期的 Code Review 状态（90 天未活动）
    try {
      codeReviewService.cleanupExpiredReviews();
    } catch (err) {
      console.warn('[CommitDetail] 清理过期 Code Review 失败:', err);
    }
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

  /* ============================================================
   * 公开方法：单提交详情
   * ============================================================ */

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
   * 4. 将 FileDiff[] 转为归一化的 NormalizedFileChange[]
   * 5. 渲染提交详情视图
   *
   * @param repoPath - 仓库路径
   * @param commitHash - 提交的完整哈希值
   */
  async showCommit(repoPath: string, commitHash: string): Promise<void> {
    if (!this.container) return;

    try {
      // 并行获取提交元信息和文件变更数据
      const [commitList, diffResult] = await Promise.all([
        repoService.getCommitLog(repoPath, 100),
        repoService.getCommitDiff(repoPath, commitHash),
      ]);

      // 从提交列表中查找目标提交的元信息
      const commitInfo = commitList.commits.find(c => c.hash === commitHash);

      if (!commitInfo) {
        // 如果在最近 100 条提交中找不到，显示错误提示
        this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">找不到该提交的信息: ${commitHash}</p>`;
        return;
      }

      // 设置当前状态
      this.viewMode = 'commit';
      this.currentRepoPath = repoPath;
      this.currentCommitHash = commitHash;
      this.compareFromHash = null;
      this.compareToHash = null;
      this.commitInfo = commitInfo;
      // 将 FileDiff 转换为统一的 NormalizedFileChange 格式
      this.fileChanges = this.normalizeFileDiffs(diffResult.files);
      // 构建文件树
      this.fileTreeRoot = this.createFileTree(this.fileChanges);

      // 阶段 9：Task 9.5：获取提交的 GPG 签名信息
      // 调用后端 get_commit_details 命令获取签名信息（含 %G?/%GS/%GK 字段）
      // 签名信息的获取失败不应影响提交详情的正常显示，因此用 try-catch 包裹
      // 并将 commitSignature 初始化为 null（无签名或获取失败时保持 null）
      //
      // Task 13.4：同时保存完整的 commitDetails 对象（含 committer 双套字段），
      // 用于在 renderCommitHeader 中显示提交者信息（当 committer 与 author 不同时）
      this.commitSignature = null;
      this.commitDetails = null;
      try {
        // getCommitDetails 需要 hasParents 参数：
        //   true = 普通提交（有父提交），后端使用 commit^ 作为 diff 基准
        //   false = 初始提交（无父提交），后端使用 commit 自身作为 diff 基准
        // 由于我们只关心签名信息（来自 commit 本身，不依赖 diff 基准），
        // 先尝试 hasParents=true（大多数提交都有父提交），
        // 如果失败（初始提交没有父提交，commit^ 不存在导致命令失败），
        // 再用 hasParents=false 重试，确保初始提交也能获取签名信息
        try {
          const commitDetails = await repoService.getCommitDetails(repoPath, commitHash, true);
          // Task 13.4：保存完整的 commitDetails 对象（含 committer 字段）
          this.commitDetails = commitDetails;
          this.commitSignature = commitDetails.signature;
        } catch {
          // hasParents=true 失败，可能是初始提交，用 hasParents=false 重试
          const commitDetails = await repoService.getCommitDetails(repoPath, commitHash, false);
          // Task 13.4：保存完整的 commitDetails 对象（含 committer 字段）
          this.commitDetails = commitDetails;
          this.commitSignature = commitDetails.signature;
        }
      } catch (sigErr) {
        // 签名信息获取失败不影响提交详情显示，仅记录警告日志
        console.warn('[CommitDetail] 获取签名信息失败:', sigErr);
        this.commitSignature = null;
        this.commitDetails = null;
      }

      // 渲染视图
      this.render();
    } catch (err) {
      console.error('获取提交详情失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取提交详情失败: ${err}</p>`;
    }
  }

  /**
   * 显示两个提交之间的对比视图（Task 4.3）
   *
   * 调用 repoService.getCommitComparison() 获取两提交之间的文件变更列表，
   * 然后渲染对比视图（仅显示文件变更列表，不显示提交元信息）。
   *
   * @param repoPath - 仓库路径
   * @param fromHash - 对比的起始提交哈希
   * @param toHash - 对比的目标提交哈希（'*' 表示与工作区对比）
   */
  async showComparison(repoPath: string, fromHash: string, toHash: string): Promise<void> {
    if (!this.container) return;

    try {
      // 显示加载中提示
      this.container.innerHTML = `<p style="color: var(--text-muted); padding: 16px;">正在加载对比信息...</p>`;

      // 调用后端获取对比结果
      const comparison = await repoService.getCommitComparison(repoPath, fromHash, toHash);

      // 设置当前状态
      this.viewMode = 'comparison';
      this.currentRepoPath = repoPath;
      this.currentCommitHash = fromHash;  // 用于 onFileClick 回调
      this.compareFromHash = fromHash;
      this.compareToHash = toHash;
      this.commitInfo = null;
      // Task 13.4：对比模式下不需要提交详情和签名信息，重置为 null
      this.commitDetails = null;
      this.commitSignature = null;
      // 将 GitFileChange[] 转换为统一的 NormalizedFileChange 格式
      this.fileChanges = this.normalizeGitFileChanges(comparison.fileChanges);
      // 构建文件树
      this.fileTreeRoot = this.createFileTree(this.fileChanges);

      // 渲染对比视图
      this.render();
    } catch (err) {
      console.error('获取提交对比失败:', err);
      this.container.innerHTML = `<p style="color: var(--error); padding: 16px;">获取提交对比失败: ${err}</p>`;
    }
  }

  /* ============================================================
   * 数据归一化与文件树构建
   * ============================================================ */

  /**
   * 将 DiffResult 中的 FileDiff[] 转换为统一的 NormalizedFileChange[] 格式
   *
   * FileDiff 字段映射：
   *   - path → path
   *   - old_path → oldPath（重命名时为旧路径，其他为 null）
   *   - additions → additions
   *   - deletions → deletions
   *   - is_new/is_deleted/is_renamed → 推断 GitFileStatus
   *
   * @param files - FileDiff 数组（来自 getCommitDiff）
   * @returns 归一化后的文件变更数组
   */
  private normalizeFileDiffs(files: FileDiff[]): NormalizedFileChange[] {
    return files.map((file: FileDiff): NormalizedFileChange => {
      // 根据 is_new/is_deleted/is_renamed 推断变更类型
      let status: GitFileStatus;
      if (file.is_new) {
        status = GitFileStatus.Added;
      } else if (file.is_deleted) {
        status = GitFileStatus.Deleted;
      } else if (file.is_renamed) {
        status = GitFileStatus.Renamed;
      } else {
        status = GitFileStatus.Modified;
      }
      return {
        path: file.path,
        // old_path 为 null 时与 path 相同（非重命名文件）
        oldPath: file.is_renamed ? file.old_path : null,
        additions: file.additions,
        deletions: file.deletions,
        status,
      };
    });
  }

  /**
   * 将 CommitComparison 中的 GitFileChange[] 转换为统一的 NormalizedFileChange[] 格式
   *
   * GitFileChange 字段直接映射到 NormalizedFileChange，无需额外转换。
   *
   * @param files - GitFileChange 数组（来自 getCommitComparison）
   * @returns 归一化后的文件变更数组
   */
  private normalizeGitFileChanges(files: ReadonlyArray<GitFileChange>): NormalizedFileChange[] {
    return files.map((file: GitFileChange): NormalizedFileChange => ({
      path: file.newFilePath,
      // 非重命名文件 oldFilePath 与 newFilePath 相同，存为 null
      oldPath: file.type === GitFileStatus.Renamed ? file.oldFilePath : null,
      additions: file.additions,
      deletions: file.deletions,
      status: file.type,
    }));
  }

  /**
   * 构建文件树（Task 4.5）
   *
   * 将扁平的文件变更列表转换为树形结构。
   * 例如：
   *   ['src/a.ts', 'src/b.ts', 'README.md']
   * 转换为：
   *   root
   *   ├── src (folder)
   *   │   ├── a.ts (file)
   *   │   └── b.ts (file)
   *   └── README.md (file)
   *
   * 如果启用了 compactFolders，会合并只含单个子文件夹的路径。
   * 例如 ['a/b/c/d.ts'] 在 compactFolders=true 时显示为 'a / b / c / d.ts'。
   *
   * @param fileChanges - 归一化后的文件变更列表
   * @returns 文件树根节点
   */
  private createFileTree(fileChanges: NormalizedFileChange[]): FileTreeNode {
    // 根节点（虚拟节点，name 为空字符串）
    const root: FileTreeNode = {
      name: '',
      path: '',
      type: 'folder',
      children: [],
      open: true,
      reviewed: true,
    };

    // 遍历每个文件变更，按路径层级插入到树中
    for (const fileChange of fileChanges) {
      // 按斜杠分割路径（同时支持正斜杠和反斜杠，避免 Windows 路径问题）
      const segments: string[] = fileChange.path.split(/[\\/]/);
      let currentPath: string = '';
      let currentNode: FileTreeNode = root;

      // 逐级创建/查找文件夹节点
      for (let i = 0; i < segments.length - 1; i++) {
        const segment: string = segments[i];
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;

        // 在当前节点的 children 中查找名为 segment 的子文件夹
        let child: FileTreeNode | undefined = currentNode.children?.find(
          (c: FileTreeNode) => c.type === 'folder' && c.name === segment
        );

        if (!child) {
          // 不存在则创建新的文件夹节点
          child = {
            name: segment,
            path: currentPath,
            type: 'folder',
            children: [],
            open: true,
            reviewed: true,
          };
          currentNode.children!.push(child);
        }
        currentNode = child;
      }

      // 最后一段是文件名，创建文件节点
      const fileName: string = segments[segments.length - 1];
      if (fileName) {
        const fileNode: FileTreeNode = {
          name: fileName,
          path: fileChange.path,
          type: 'file',
          fileChange,
          // 已审状态由 Code Review 决定（无 Code Review 时默认已审）
          reviewed: true,
        };
        currentNode.children!.push(fileNode);
      }
    }

    // 对树进行排序：文件夹在前，文件在后；同类型按名称排序
    this.sortFileTree(root);

    // 如果启用 compactFolders，合并只含单个子文件夹的路径
    if (this.compactFolders) {
      this.applyCompactFolders(root);
    }

    // 如果有 Code Review 进行中，重新计算各文件夹的已审状态
    if (this.currentRepoPath && this.isCodeReviewActive()) {
      this.calcFoldersReviewed(root);
    }

    return root;
  }

  /**
   * 对文件树节点进行排序
   *
   * 排序规则：
   *   1. 文件夹节点排在文件节点前面
   *   2. 同类型节点按名称（localeCompare）排序
   *
   * @param node - 要排序的节点（递归排序所有子节点）
   */
  private sortFileTree(node: FileTreeNode): void {
    if (!node.children || node.children.length === 0) return;

    node.children.sort((a: FileTreeNode, b: FileTreeNode) => {
      // 文件夹在前，文件在后
      if (a.type === 'folder' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'folder') return 1;
      // 同类型按名称排序
      return a.name.localeCompare(b.name);
    });

    // 递归排序子节点
    for (const child of node.children) {
      this.sortFileTree(child);
    }
  }

  /**
   * 应用 compactFolders 优化
   *
   * 合并只含单个子文件夹的路径。例如：
   *   a/b/c/d.ts
   * 在 compactFolders 启用后，'a/b/c' 三个嵌套的单子文件夹会被合并显示为 'a / b / c'。
   *
   * 实现方式：将合并后的文件夹的 name 改为 'a / b / c' 形式，
   * path 保持为完整路径 'a/b/c'，children 直接指向最深层级的 children。
   *
   * @param node - 当前处理的节点
   * @param isTopLevel - 是否是顶层节点（顶层不合并）
   */
  private applyCompactFolders(node: FileTreeNode, isTopLevel: boolean = true): void {
    if (!node.children || node.children.length === 0) return;

    // 递归处理所有子节点
    for (const child of node.children) {
      if (child.type === 'folder') {
        this.applyCompactFolders(child, false);
      }
    }

    // 非顶层节点，且只有一个子文件夹，且没有文件 → 合并
    if (!isTopLevel && node.children.length === 1 && node.children[0].type === 'folder') {
      const onlyChild: FileTreeNode = node.children[0];
      // 合并 name（用 ' / ' 连接，提示用户这是被合并的路径）
      node.name = `${node.name} / ${onlyChild.name}`;
      // path 保持为更深的子节点路径
      node.path = onlyChild.path;
      // 直接继承子节点的 children
      node.children = onlyChild.children;
      // 继承子节点的已审状态
      node.reviewed = onlyChild.reviewed;
    }
  }

  /**
   * 递归计算各文件夹的已审状态
   *
   * 文件夹的 reviewed = 所有子节点（包括子文件夹和文件）都已审时为 true。
   * 此方法在 Code Review 进行中时调用，用于更新文件树中文件夹的已审状态。
   *
   * @param folder - 文件夹节点
   * @returns 该文件夹及其所有子节点是否都已审
   */
  private calcFoldersReviewed(folder: FileTreeNode): boolean {
    if (!folder.children || folder.children.length === 0) {
      return folder.reviewed ?? true;
    }

    let allReviewed: boolean = true;
    for (const child of folder.children) {
      if (child.type === 'folder') {
        // 递归计算子文件夹
        const childReviewed: boolean = this.calcFoldersReviewed(child);
        if (!childReviewed) allReviewed = false;
      } else {
        // 文件节点：检查 Code Review 状态
        const reviewed: boolean = this.isFileReviewed(child.path);
        child.reviewed = reviewed;
        if (!reviewed) allReviewed = false;
      }
    }
    folder.reviewed = allReviewed;
    return allReviewed;
  }

  /* ============================================================
   * 渲染主流程
   * ============================================================ */

  /**
   * 渲染提交详情或对比视图
   *
   * 根据 viewMode 决定渲染哪种视图：
   *   - 'commit'：渲染完整提交详情（头部 + 信息 + 文件树/列表）
   *   - 'comparison'：渲染对比视图（仅显示 from→to + 文件树/列表）
   *
   * 文件区域统一使用文件树/文件列表，由 fileViewType 决定。
   */
  private render(): void {
    if (!this.container) return;

    // 构建头部 HTML（单提交模式显示完整信息，对比模式显示 from→to）
    let html: string = '<div class="commit-detail-container">';

    if (this.viewMode === 'commit' && this.commitInfo) {
      html += this.renderCommitHeader();
    } else if (this.viewMode === 'comparison') {
      html += this.renderComparisonHeader();
    }

    // 渲染文件区域（包含工具栏 + 文件树/列表）
    html += this.renderFilesSection();

    html += '</div>';

    // 插入到容器
    this.container.innerHTML = html;

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 渲染单提交模式的头部（标题 + 元信息）
   *
   * @returns 头部 HTML 字符串
   */
  private renderCommitHeader(): string {
    if (!this.commitInfo) return '';

    // 解析提交消息，分离标题和正文
    const { title, body } = this.parseCommitMessage(this.commitInfo.message);
    // 格式化提交日期
    const dateStr: string = this.formatDate(this.commitInfo.date);

    // Task 11.2：使用 TextFormatter 格式化标题和正文
    // 从 configService 读取配置（markdown/emoji/issueLinking）
    const cfg = configService.getAppConfig();
    // 构建 issueLinking 配置（如果启用）
    let issueLinkingConfig: { regex: string; urlTemplate: string } | undefined;
    if (cfg.issueLinking && cfg.issueLinkingPattern && cfg.issueLinkingUrl) {
      issueLinkingConfig = {
        regex: cfg.issueLinkingPattern,
        urlTemplate: cfg.issueLinkingUrl,
      };
    }

    // 格式化标题：单行，启用 markdown/emoji/issueLinking，不启用 urls/commits
    const formattedTitle: string = formatLine(title, {
      issueLinking: issueLinkingConfig,
      emoji: cfg.markdown,
      markdown: cfg.markdown,
      urls: false,
      commits: false,
    });

    // 格式化正文：多行内容，启用 markdown/emoji/issueLinking/urls/commits
    // 正文可能包含 URL 和 commit hash 引用，所以启用 urls 和 commits
    const formattedBody: string = body
      ? formatLine(body, {
          issueLinking: issueLinkingConfig,
          emoji: cfg.markdown,
          markdown: cfg.markdown,
          urls: true,
          commits: false, // commit hash 链接需要 commits 列表，暂不启用
        })
          // 将换行符转为 <br>（正文是多行的）
          .replace(/\n/g, '<br/>')
      : '';

    // HTML 转义其他元信息
    const safeAuthor: string = this.escapeHtml(this.commitInfo.author);
    const safeEmail: string = this.escapeHtml(this.commitInfo.email);

    // Task 13.4：判断是否需要显示 committer（提交者）双套字段
    // 当 commitDetails 存在，且 committer 的姓名或邮箱与 author 不同时，显示双套字段
    // 常见于 rebase、cherry-pick、patch 应用、squash 等操作，此时作者和提交者不是同一人
    // committerDate 是 Unix 时间戳（秒），需要 *1000 转为毫秒再格式化
    let showCommitter: boolean = false;
    let safeCommitter: string = '';
    let safeCommitterEmail: string = '';
    let committerDateStr: string = '';
    if (this.commitDetails) {
      // 比较 committer 与 author 的姓名和邮箱（任一不同即视为不同）
      const committerName: string = this.commitDetails.committer;
      const committerEmail: string = this.commitDetails.committerEmail;
      if (committerName !== this.commitInfo.author || committerEmail !== this.commitInfo.email) {
        showCommitter = true;
        // HTML 转义 committer 的姓名和邮箱（避免 XSS）
        safeCommitter = this.escapeHtml(committerName);
        safeCommitterEmail = this.escapeHtml(committerEmail);
        // 将 Unix 时间戳（秒）转为 ISO 8601 字符串，再用 formatDate 格式化
        // new Date() 接收毫秒，所以 committerDate * 1000
        const committerDateMs: number = this.commitDetails.committerDate * 1000;
        committerDateStr = this.formatDate(new Date(committerDateMs).toISOString());
      }
    }

    let html: string = `
      <!-- 头部区域：显示提交标题 -->
      <div class="commit-detail-header">
        <h3 class="commit-detail-title">${formattedTitle}</h3>
      </div>

      <!-- 信息区域：显示提交的详细元信息 -->
      <div class="commit-detail-info">
        <div class="commit-detail-row">
          <span class="commit-detail-label">哈希:</span>
          <span class="commit-detail-value commit-hash-full" title="${this.commitInfo.hash}">
            ${this.commitInfo.hash}
          </span>
        </div>
        <div class="commit-detail-row">
          <span class="commit-detail-label">短哈希:</span>
          <span class="commit-detail-value">${this.commitInfo.short_hash}</span>
        </div>
        <div class="commit-detail-row">
          <span class="commit-detail-label">作者:</span>
          <span class="commit-detail-value">${safeAuthor}</span>
        </div>
        <div class="commit-detail-row">
          <span class="commit-detail-label">邮箱:</span>
          <span class="commit-detail-value">${safeEmail}</span>
        </div>
        <div class="commit-detail-row">
          <span class="commit-detail-label">日期:</span>
          <span class="commit-detail-value">${dateStr}</span>
        </div>
    `;

    // Task 13.4：显示 committer（提交者）双套字段
    // 仅当 committer 与 author 不同时才显示，避免普通提交显示冗余信息
    // 提交者字段帮助用户区分"编写代码的人"（author）和"实际执行 commit 的人"（committer）
    if (showCommitter) {
      html += `
        <div class="commit-detail-row commit-detail-committer-row">
          <span class="commit-detail-label">提交者:</span>
          <span class="commit-detail-value">${safeCommitter}</span>
        </div>
        <div class="commit-detail-row commit-detail-committer-row">
          <span class="commit-detail-label">提交者邮箱:</span>
          <span class="commit-detail-value">${safeCommitterEmail}</span>
        </div>
        <div class="commit-detail-row commit-detail-committer-row">
          <span class="commit-detail-label">提交日期:</span>
          <span class="commit-detail-value">${committerDateStr}</span>
        </div>
      `;
    }

    // 阶段 9：Task 9.5：显示 GPG 签名状态
    // 如果提交有签名信息（commitSignature 不为 null），显示签名状态行
    // 签名状态用图标 + 文字表示，不同状态用不同颜色：
    //   G (有效) = 绿色 ✓，U (未知可信度) = 黄色 ?，X/Y (过期) = 橙色 ⚠，
    //   R (密钥吊销) = 红色 ⚠，E (无法检查) = 灰色 ?，B (签名错误) = 红色 ✗
    // 悬停时通过 title 属性显示签名者和密钥 ID 的详情
    if (this.commitSignature) {
      // 获取签名状态的显示信息（图标、文字、CSS 类名）
      const sigDisplay = this.getSignatureDisplay(this.commitSignature.status);
      // HTML 转义签名者和密钥 ID（避免 XSS）
      const safeSigner: string = this.escapeHtml(this.commitSignature.signer);
      const safeKey: string = this.escapeHtml(this.commitSignature.key);
      // 构建 title 提示文本（悬停显示详情）
      const sigTitle: string = `签名者: ${safeSigner}\n密钥 ID: ${safeKey}\n状态: ${sigDisplay.text}`;
      html += `
        <div class="commit-detail-row commit-detail-signature-row">
          <span class="commit-detail-label">签名:</span>
          <span class="commit-detail-value commit-signature ${sigDisplay.cssClass}" title="${sigTitle}">
            <span class="commit-signature-icon">${sigDisplay.icon}</span>
            <span class="commit-signature-text">${sigDisplay.text}</span>
          </span>
        </div>
      `;
    }

    // 如果有正文内容，显示正文区域
    if (formattedBody) {
      html += `
        <div class="commit-detail-row commit-detail-message-body">
          <span class="commit-detail-label">描述:</span>
          <div class="commit-detail-value commit-message-pre">${formattedBody}</div>
        </div>
      `;
    }

    html += `</div>`;
    return html;
  }

  /**
   * 获取 GPG 签名状态的显示信息（阶段 9：Task 9.5）
   *
   * 将 GitSignatureStatus 枚举值映射为用户可读的图标、文字和 CSS 类名。
   * 用于在提交详情头部显示签名状态。
   *
   * 状态映射表：
   *   - GoodAndValid (G): ✓ 绿色 "签名有效"
   *   - GoodWithUnknownValidity (U): ? 黄色 "签名有效（可信度未知）"
   *   - GoodButExpired (X): ⚠ 橙色 "签名已过期"
   *   - GoodButMadeByExpiredKey (Y): ⚠ 橙色 "签名密钥已过期"
   *   - GoodButMadeByRevokedKey (R): ⚠ 红色 "签名密钥已吊销"
   *   - CannotBeChecked (E): ? 灰色 "无法验证签名"
   *   - Bad (B): ✗ 红色 "签名无效"
   *
   * @param status - GPG 签名状态枚举值
   * @returns 包含 icon（图标）、text（描述文字）、cssClass（CSS 类名）的对象
   */
  private getSignatureDisplay(status: GitSignatureStatus): { icon: string; text: string; cssClass: string } {
    switch (status) {
      case GitSignatureStatus.GoodAndValid:
        // G - 签名良好且有效：绿色对勾
        return { icon: '✓', text: '签名有效', cssClass: 'commit-signature-valid' };
      case GitSignatureStatus.GoodWithUnknownValidity:
        // U - 签名良好但可信度未知：黄色问号
        return { icon: '?', text: '签名有效（可信度未知）', cssClass: 'commit-signature-unknown' };
      case GitSignatureStatus.GoodButExpired:
        // X - 签名已过期：橙色警告
        return { icon: '⚠', text: '签名已过期', cssClass: 'commit-signature-expired' };
      case GitSignatureStatus.GoodButMadeByExpiredKey:
        // Y - 签名密钥已过期：橙色警告
        return { icon: '⚠', text: '签名密钥已过期', cssClass: 'commit-signature-expired' };
      case GitSignatureStatus.GoodButMadeByRevokedKey:
        // R - 签名密钥已吊销：红色警告
        return { icon: '⚠', text: '签名密钥已吊销', cssClass: 'commit-signature-revoked' };
      case GitSignatureStatus.CannotBeChecked:
        // E - 无法检查签名（如缺少公钥）：灰色问号
        return { icon: '?', text: '无法验证签名', cssClass: 'commit-signature-unchecked' };
      case GitSignatureStatus.Bad:
        // B - 签名无效：红色叉号
        return { icon: '✗', text: '签名无效', cssClass: 'commit-signature-bad' };
      default:
        // 未知状态：灰色问号（理论上不会走到这里）
        return { icon: '?', text: '未知签名状态', cssClass: 'commit-signature-unchecked' };
    }
  }

  /**
   * 渲染对比模式的头部（显示 from→to 信息）
   *
   * @returns 头部 HTML 字符串
   */
  private renderComparisonHeader(): string {
    const fromHash: string = this.compareFromHash || '';
    const toHash: string = this.compareToHash || '';
    // 显示短哈希（前 7 位），更易读
    const fromShort: string = fromHash.substring(0, 7);
    const toShort: string = toHash === '*' ? '工作区' : toHash.substring(0, 7);

    return `
      <div class="commit-detail-header commit-comparison-header">
        <h3 class="commit-detail-title">提交对比</h3>
        <div class="commit-comparison-info">
          <span class="commit-comparison-hash" title="起始提交: ${this.escapeHtml(fromHash)}">${this.escapeHtml(fromShort)}</span>
          <span class="commit-comparison-arrow">→</span>
          <span class="commit-comparison-hash" title="目标提交: ${this.escapeHtml(toHash)}">${this.escapeHtml(toShort)}</span>
        </div>
      </div>
    `;
  }

  /**
   * 渲染文件区域（标题栏 + 工具按钮 + 文件树/列表）
   *
   * 工具按钮包括：
   *   - 切换 FileTree/FileList 视图
   *   - Start/End Code Review 按钮
   *   - Code Review 进度指示
   *
   * @returns 文件区域 HTML 字符串
   */
  private renderFilesSection(): string {
    // 计算总新增/删除行数（仅当 additions/deletions 非 null 时计入）
    let totalAdditions: number = 0;
    let totalDeletions: number = 0;
    for (const file of this.fileChanges) {
      if (file.additions !== null) totalAdditions += file.additions;
      if (file.deletions !== null) totalDeletions += file.deletions;
    }

    // 获取 Code Review 状态
    const codeReviewActive: boolean = this.isCodeReviewActive();
    const progress: { reviewed: number; total: number } = codeReviewService.getProgress(
      this.currentRepoPath || '',
      this.fileChanges.length
    );

    let html: string = `
      <div class="commit-detail-files">
        <div class="commit-detail-files-toolbar">
          <h4 class="commit-detail-subtitle">
            文件变更 (${this.fileChanges.length})
            <span class="commit-detail-stats">
              <span class="diff-additions">+${totalAdditions}</span>
              <span class="diff-deletions">-${totalDeletions}</span>
            </span>
          </h4>
          <div class="commit-detail-files-actions">
            <!-- Code Review 进度指示（仅 Code Review 进行中时显示） -->
            ${codeReviewActive ? `
              <span class="code-review-progress" title="已审文件数 / 总文件数">
                审查进度: ${progress.reviewed} / ${progress.total}
              </span>
            ` : ''}
            <!-- 切换 FileTree/FileList 视图按钮 -->
            <button class="cdv-view-btn ${this.fileViewType === FileViewType.Tree ? 'active' : ''}"
                    data-view-type="${FileViewType.Tree}"
                    title="树形视图">📁 树形</button>
            <button class="cdv-view-btn ${this.fileViewType === FileViewType.List ? 'active' : ''}"
                    data-view-type="${FileViewType.List}"
                    title="列表视图">📋 列表</button>
            <!-- Start/End Code Review 按钮 -->
            <button class="cdv-code-review-btn ${codeReviewActive ? 'active' : ''}"
                    title="${codeReviewActive ? '结束 Code Review' : '开始 Code Review'}">
              ${codeReviewActive ? '⏹ 结束审查' : '▶ 开始审查'}
            </button>
          </div>
        </div>
        <div class="commit-file-view">
    `;

    // 根据视图类型渲染文件树或文件列表
    if (this.fileViewType === FileViewType.Tree) {
      html += this.renderFileTreeHtml(this.fileTreeRoot);
    } else {
      html += this.renderFileListHtml();
    }

    html += `
        </div>
      </div>
    `;
    return html;
  }

  /**
   * 渲染文件树 HTML（递归）
   *
   * 生成 <ul> 嵌套的树形结构：
   *   <ul class="file-tree">
   *     <li class="file-tree-folder">
   *       <span class="file-tree-folder-label">📁 文件夹名</span>
   *       <ul class="file-tree-children">
   *         <li class="file-tree-file">📄 文件名</li>
   *       </ul>
   *     </li>
   *   </ul>
   *
   * 文件夹支持折叠/展开（点击切换 .open 类）。
   * 文件夹图标：📁（展开）/ 📂（折叠，使用 emoji 表示状态）
   * 文件图标：📄
   * 未审文件（Code Review 期间）添加 .unreviewed 类（CSS 中加粗显示）
   *
   * @param node - 文件树节点
   * @param isTopLevel - 是否是顶层（顶层不渲染 <li> 包裹）
   * @returns 文件树 HTML 字符串
   */
  private renderFileTreeHtml(node: FileTreeNode | null, isTopLevel: boolean = true): string {
    if (!node || !node.children || node.children.length === 0) {
      return '<ul class="file-tree file-tree-empty"><li class="file-tree-empty-msg">无文件变更</li></ul>';
    }

    let html: string = isTopLevel ? '<ul class="file-tree">' : '';

    for (const child of node.children) {
      if (child.type === 'folder') {
        // 文件夹节点
        const folderIcon: string = child.open ? '📂' : '📁';
        // 未审文件夹添加 unreviewed 类
        const folderClass: string = `file-tree-folder-label${child.reviewed === false ? ' unreviewed' : ''}`;
        // children 区域根据 open 状态显示/隐藏
        const childrenStyle: string = child.open ? '' : ' style="display: none;"';

        html += `
          <li class="file-tree-folder" data-path="${this.escapeHtml(child.path)}">
            <span class="${folderClass}" data-folder-path="${this.escapeHtml(child.path)}">
              <span class="file-tree-toggle">${folderIcon}</span>
              <span class="file-tree-name">${this.escapeHtml(child.name)}</span>
            </span>
            <ul class="file-tree-children"${childrenStyle}>
              ${this.renderFileTreeHtml(child, false)}
            </ul>
          </li>
        `;
      } else {
        // 文件节点
        html += this.renderFileLeafHtml(child);
      }
    }

    if (isTopLevel) html += '</ul>';
    return html;
  }

  /**
   * 渲染单个文件叶子节点 HTML
   *
   * @param node - 文件节点
   * @returns 文件叶子 HTML 字符串
   */
  private renderFileLeafHtml(node: FileTreeNode): string {
    if (!node.fileChange) return '';

    const file: NormalizedFileChange = node.fileChange;
    // 根据变更类型选择图标
    const icon: string = this.getFileStatusIcon(file.status);
    // 根据变更类型选择状态文字
    const statusText: string = this.getFileStatusText(file.status);
    // 未审文件（Code Review 期间）添加 unreviewed 类
    const fileClass: string = `file-tree-file${node.reviewed === false ? ' unreviewed' : ''}`;

    return `
      <li class="${fileClass}"
          data-file-path="${this.escapeHtml(node.path)}"
          data-old-path="${file.oldPath ? this.escapeHtml(file.oldPath) : ''}"
          data-status="${file.status}"
          title="${this.escapeHtml(node.path)} • ${statusText}">
        <span class="file-tree-file-icon">${icon}</span>
        <span class="file-tree-name">${this.escapeHtml(node.name)}</span>
        <span class="file-tree-file-status">${statusText}</span>
        ${this.renderFileStatsHtml(file)}
      </li>
    `;
  }

  /**
   * 渲染文件统计信息 HTML（新增/删除行数）
   *
   * @param file - 文件变更信息
   * @returns 统计 HTML 字符串（无统计信息时返回空字符串）
   */
  private renderFileStatsHtml(file: NormalizedFileChange): string {
    // 新增/删除文件不显示行数统计
    if (file.status === GitFileStatus.Added || file.status === GitFileStatus.Untracked) {
      return '';
    }
    if (file.status === GitFileStatus.Deleted) {
      return '';
    }
    // additions 或 deletions 为 null 时不显示
    if (file.additions === null || file.deletions === null) {
      return '';
    }
    return `
      <span class="file-tree-file-stats">
        <span class="diff-additions">+${file.additions}</span>
        <span class="diff-deletions">-${file.deletions}</span>
      </span>
    `;
  }

  /**
   * 渲染文件列表 HTML（FileList 视图）
   *
   * 将所有文件平铺显示，按完整路径排序。
   * 与文件树视图共享 renderFileLeafHtml 的渲染逻辑。
   *
   * @returns 文件列表 HTML 字符串
   */
  private renderFileListHtml(): string {
    if (this.fileChanges.length === 0) {
      return '<ul class="file-tree file-tree-empty"><li class="file-tree-empty-msg">无文件变更</li></ul>';
    }

    // 按完整路径排序
    const sortedFiles: NormalizedFileChange[] = [...this.fileChanges].sort(
      (a: NormalizedFileChange, b: NormalizedFileChange) => a.path.localeCompare(b.path)
    );

    let html: string = '<ul class="file-tree file-list">';
    for (const file of sortedFiles) {
      // 构造一个临时文件节点用于渲染
      const tempNode: FileTreeNode = {
        name: file.path,  // 列表视图直接显示完整路径
        path: file.path,
        type: 'file',
        fileChange: file,
        reviewed: this.isFileReviewed(file.path),
      };
      // 列表视图直接显示完整路径，不显示状态文字（更紧凑）
      const icon: string = this.getFileStatusIcon(file.status);
      const statusText: string = this.getFileStatusText(file.status);
      const fileClass: string = `file-tree-file file-list-item${tempNode.reviewed === false ? ' unreviewed' : ''}`;

      html += `
        <li class="${fileClass}"
            data-file-path="${this.escapeHtml(file.path)}"
            data-old-path="${file.oldPath ? this.escapeHtml(file.oldPath) : ''}"
            data-status="${file.status}"
            title="${this.escapeHtml(file.path)} • ${statusText}">
          <span class="file-tree-file-icon">${icon}</span>
          <span class="file-tree-name">${this.escapeHtml(file.path)}</span>
          <span class="file-tree-file-status">${statusText}</span>
          ${this.renderFileStatsHtml(file)}
        </li>
      `;
    }
    html += '</ul>';
    return html;
  }

  /**
   * 获取文件变更类型的图标
   *
   * @param status - 文件变更类型
   * @returns 对应的 emoji 图标
   */
  private getFileStatusIcon(status: GitFileStatus): string {
    switch (status) {
      case GitFileStatus.Added:
        return '➕';
      case GitFileStatus.Deleted:
        return '🗑️';
      case GitFileStatus.Renamed:
        return '✂️';
      case GitFileStatus.Untracked:
        return '❓';
      case GitFileStatus.Modified:
      default:
        return '📄';
    }
  }

  /**
   * 获取文件变更类型的中文描述
   *
   * @param status - 文件变更类型
   * @returns 对应的中文文字
   */
  private getFileStatusText(status: GitFileStatus): string {
    switch (status) {
      case GitFileStatus.Added:
        return '新增';
      case GitFileStatus.Deleted:
        return '删除';
      case GitFileStatus.Renamed:
        return '重命名';
      case GitFileStatus.Untracked:
        return '未跟踪';
      case GitFileStatus.Modified:
      default:
        return '修改';
    }
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */

  /**
   * 绑定所有事件
   *
   * 包括：
   *   - 文件点击事件（触发 onFileClick 回调）
   *   - 文件夹折叠/展开事件
   *   - 文件右键菜单事件
   *   - 视图切换按钮事件
   *   - Code Review 按钮事件
   *   - URL 点击事件（Task 11.2：提交消息中的外部链接在默认浏览器打开）
   */
  private bindEvents(): void {
    if (!this.container) return;

    this.bindFileClickEvents();
    this.bindFolderToggleEvents();
    this.bindFileContextMenuEvents();
    this.bindViewToggleEvents();
    this.bindCodeReviewButtonEvent();
    /* Task 11.2：绑定提交消息中的外部 URL 点击事件 */
    this.bindUrlClickEvents();
  }

  /**
   * 绑定 URL 点击事件（Task 11.2）
   *
   * 提交消息的正文（body）经过 TextFormatter 格式化后，外部 URL 会渲染为
   * <a class="externalUrl" href="..."> 标签。此处绑定点击事件，使其在默认
   * 浏览器中打开，而不是在应用内导航。
   *
   * 实现方式：
   *   1. 查询容器内所有 a.externalUrl 元素
   *   2. 阻止默认的链接导航行为（preventDefault）
   *   3. 阻止事件冒泡（stopPropagation）
   *   4. 调用 Tauri 后端命令 open_external_url 在默认浏览器中打开
   *
   * 注意：commit-detail 中 commits 配置为 false，所以不会有内部 commit hash
   * 链接（span.internalUrl），只处理外部 URL 即可。
   */
  private bindUrlClickEvents(): void {
    if (!this.container) return;

    /* 查询所有外部 URL 链接 */
    const externalLinks: NodeListOf<HTMLAnchorElement> = this.container.querySelectorAll('a.externalUrl');
    for (const link of externalLinks) {
      link.addEventListener('click', async (event: Event) => {
        /* 阻止默认的链接导航行为（避免在应用内打开） */
        event.preventDefault();
        /* 阻止事件冒泡 */
        event.stopPropagation();
        /* 获取链接的 href 属性 */
        const url: string | null = link.getAttribute('href');
        if (url) {
          try {
            /* 动态导入 Tauri 的 invoke 函数（避免在模块顶层加载） */
            const { invoke } = await import('@tauri-apps/api/core');
            /* 调用后端命令在默认浏览器中打开 URL */
            await invoke('open_external_url', { url });
          } catch (err) {
            console.error('[CommitDetail] 打开外部链接失败:', err);
          }
        }
      });
    }
  }

  /**
   * 绑定文件点击事件
   *
   * 点击文件时：
   *   1. 如果设置了 onFileClick 回调，调用它来显示 diff 面板
   *   2. 如果 Code Review 进行中，标记该文件为已审
   */
  private bindFileClickEvents(): void {
    if (!this.container) return;

    const fileItems: NodeListOf<HTMLElement> = this.container.querySelectorAll('.file-tree-file, .file-list-item');
    for (const item of fileItems) {
      const filePath: string | null = item.getAttribute('data-file-path');
      if (!filePath) continue;

      item.addEventListener('click', (event: MouseEvent) => {
        // 调用文件点击回调（如果有）
        if (this.onFileClick && this.currentCommitHash) {
          this.onFileClick(filePath, this.currentCommitHash);
        }

        // 如果 Code Review 进行中，标记该文件为已审
        if (this.currentRepoPath && this.isCodeReviewActive()) {
          codeReviewService.markFileAsReviewed(this.currentRepoPath, filePath);
          // 更新 UI（移除 unreviewed 类）
          item.classList.remove('unreviewed');
          // 重新计算并更新进度指示
          this.updateCodeReviewProgressUI();
          // 更新父文件夹的已审状态
          this.updateParentFolderReviewedState(item);
        }
      });
    }
  }

  /**
   * 绑定文件夹折叠/展开事件
   *
   * 点击文件夹标签时切换 open 状态：
   *   - 折叠 → 展开（显示 children）
   *   - 展开 → 折叠（隐藏 children）
   *   - 切换文件夹图标（📂 ↔ 📁）
   */
  private bindFolderToggleEvents(): void {
    if (!this.container) return;

    const folderLabels: NodeListOf<HTMLElement> = this.container.querySelectorAll('.file-tree-folder-label');
    for (const label of folderLabels) {
      label.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
        const folderLi: HTMLElement | null = label.parentElement;
        if (!folderLi) return;
        const childrenUl: HTMLElement | null = folderLi.querySelector(':scope > .file-tree-children');
        if (!childrenUl) return;

        // 切换 children 的显示状态
        const isHidden: boolean = childrenUl.style.display === 'none';
        if (isHidden) {
          childrenUl.style.display = '';
          folderLi.classList.remove('collapsed');
        } else {
          childrenUl.style.display = 'none';
          folderLi.classList.add('collapsed');
        }

        // 切换文件夹图标
        const iconSpan: HTMLElement | null = label.querySelector('.file-tree-toggle');
        if (iconSpan) {
          iconSpan.textContent = isHidden ? '📂' : '📁';
        }
      });
    }
  }

  /**
   * 绑定文件右键菜单事件
   *
   * 右键文件时显示上下文菜单，包含以下选项：
   *   - View Diff（查看 diff）
   *   - View File at this Revision（查看此版本的文件内容）
   *   - View Diff with Working File（与工作区文件对比）
   *   - Open File（打开文件）
   *   - Mark as Reviewed / Not Reviewed（仅 Code Review 期间）
   *   - Reset File to this Revision（重置文件到此版本）
   *   - Copy Absolute / Relative Path（复制路径）
   */
  private bindFileContextMenuEvents(): void {
    if (!this.container) return;

    const fileItems: NodeListOf<HTMLElement> = this.container.querySelectorAll('.file-tree-file, .file-list-item');
    for (const item of fileItems) {
      const filePath: string | null = item.getAttribute('data-file-path');
      if (!filePath) continue;

      item.addEventListener('contextmenu', (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();

        // 获取文件变更信息
        const status: string = item.getAttribute('data-status') || GitFileStatus.Modified;
        const oldPath: string | null = item.getAttribute('data-old-path') || null;

        // 构造右键菜单目标
        const target: ContextMenuTarget = {
          type: 'CommitDetailsView',
          elem: item,
          hash: this.currentCommitHash || '',
          index: 0,
        };

        // 是否能查看 diff（新增/删除/未跟踪/二进制文件等情况下不可用）
        const diffPossible: boolean = status !== GitFileStatus.Deleted;
        // 文件是否在此版本存在（删除文件不存在）
        const fileExistsAtThisRevision: boolean = status !== GitFileStatus.Deleted;
        // Code Review 状态
        const codeReviewActive: boolean = this.isCodeReviewActive();
        const isReviewed: boolean = this.isFileReviewed(filePath);

        // 构建菜单项
        const actions: ReadonlyArray<ReadonlyArray<ContextMenuAction>> = [
          [
            {
              title: 'View Diff',
              visible: diffPossible,
              onClick: () => {
                if (this.onFileClick && this.currentCommitHash) {
                  this.onFileClick(filePath, this.currentCommitHash);
                }
              },
            },
            {
              title: 'View File at this Revision',
              visible: fileExistsAtThisRevision && diffPossible,
              onClick: () => {
                this.viewFileAtRevision(filePath);
              },
            },
            {
              title: 'View Diff with Working File',
              visible: fileExistsAtThisRevision && diffPossible,
              onClick: () => {
                this.viewDiffWithWorkingFile(filePath);
              },
            },
            {
              title: 'View Blame',
              visible: fileExistsAtThisRevision,
              onClick: () => {
                this.viewBlame(filePath);
              },
            },
            {
              /* Task 13.5：查看文件历史 - 触发 onFileHistory 回调显示该文件的提交历史视图
               * 仅在设置了 onFileHistory 回调时显示 */
              title: 'View File History',
              visible: !!this.onFileHistory,
              onClick: () => {
                if (this.onFileHistory) {
                  this.onFileHistory(filePath);
                }
              },
            },
            {
              title: 'Open File',
              visible: fileExistsAtThisRevision,
              onClick: () => {
                this.openFile(filePath);
              },
            },
            {
              // 阶段 9：Task 9.6：在外部 difftool 中打开目录对比
              // 调用后端 open_dir_diff 命令，执行 git difftool --dir-diff from to
              // 在单提交模式下，from = 当前提交哈希，to = '*'（工作区），
              // 这样会在外部 difftool 中打开此提交与工作区的目录对比
              title: 'Open in Diff Tool',
              visible: this.viewMode === 'commit' && !!this.currentRepoPath && !!this.currentCommitHash,
              onClick: () => {
                this.openInDiffTool();
              },
            },
          ],
          [
            {
              title: 'Mark as Reviewed',
              visible: codeReviewActive && !isReviewed,
              onClick: () => {
                if (this.currentRepoPath) {
                  codeReviewService.markFileAsReviewed(this.currentRepoPath, filePath);
                  item.classList.remove('unreviewed');
                  this.updateCodeReviewProgressUI();
                  this.updateParentFolderReviewedState(item);
                }
              },
            },
            {
              title: 'Mark as Not Reviewed',
              visible: codeReviewActive && isReviewed,
              onClick: () => {
                if (this.currentRepoPath) {
                  codeReviewService.markFileAsNotReviewed(this.currentRepoPath, filePath);
                  item.classList.add('unreviewed');
                  this.updateCodeReviewProgressUI();
                  this.updateParentFolderReviewedState(item);
                }
              },
            },
          ],
          [
            {
              title: 'Reset File to this Revision',
              visible: fileExistsAtThisRevision && this.viewMode === 'commit',
              onClick: () => {
                this.resetFileToRevision(filePath);
              },
            },
          ],
          [
            {
              /* Task 13.5：添加到 .gitignore - 将该文件路径追加到仓库根目录的 .gitignore 文件中
               * 仅在提交详情模式（有仓库路径）时显示 */
              title: 'Add to .gitignore',
              visible: !!this.currentRepoPath,
              onClick: () => {
                this.addToGitignore(filePath);
              },
            },
          ],
          [
            {
              title: 'Copy Absolute Path',
              visible: true,
              onClick: () => {
                this.copyFilePath(filePath, true);
              },
            },
            {
              title: 'Copy Relative Path',
              visible: true,
              onClick: () => {
                this.copyFilePath(filePath, false);
              },
            },
          ],
        ];

        // 显示菜单（frameElem 使用容器，让菜单在详情面板内定位）
        const frameElem: HTMLElement = this.container || document.body;
        contextMenu.show(actions as ContextMenuAction[][], false, target, event, frameElem);
      });
    }
  }

  /**
   * 绑定视图切换按钮事件
   *
   * 点击 FileTree/FileList 按钮时切换视图类型并重新渲染文件区域。
   */
  private bindViewToggleEvents(): void {
    if (!this.container) return;

    const buttons: NodeListOf<HTMLElement> = this.container.querySelectorAll('.cdv-view-btn');
    for (const btn of buttons) {
      btn.addEventListener('click', (event: MouseEvent) => {
        event.stopPropagation();
        const viewTypeStr: string = btn.getAttribute('data-view-type') || '';
        // 将字符串转为 FileViewType 枚举
        const viewType: FileViewType = viewTypeStr === String(FileViewType.List)
          ? FileViewType.List
          : FileViewType.Tree;

        if (viewType !== this.fileViewType) {
          this.fileViewType = viewType;
          // 重新渲染整个视图（简单实现，避免局部更新的复杂性）
          this.render();
        }
      });
    }
  }

  /**
   * 绑定 Code Review 按钮事件
   *
   * 点击按钮时：
   *   - Code Review 未启动：开始 Code Review
   *   - Code Review 进行中：结束 Code Review
   */
  private bindCodeReviewButtonEvent(): void {
    if (!this.container) return;

    const btn: HTMLElement | null = this.container.querySelector('.cdv-code-review-btn');
    if (!btn) return;

    btn.addEventListener('click', (event: MouseEvent) => {
      event.stopPropagation();
      if (!this.currentRepoPath) return;

      if (this.isCodeReviewActive()) {
        // 结束 Code Review
        codeReviewService.endCodeReview(this.currentRepoPath);
        console.log('[CommitDetail] 已结束 Code Review');
      } else {
        // 开始 Code Review
        // commitHash 标识：单提交模式用 commitHash；对比模式用 'from→to' 组合
        const reviewKey: string = this.viewMode === 'comparison' && this.compareFromHash && this.compareToHash
          ? `${this.compareFromHash}→${this.compareToHash}`
          : (this.currentCommitHash || '');
        codeReviewService.startCodeReview(this.currentRepoPath, reviewKey);
        console.log('[CommitDetail] 已开始 Code Review, key:', reviewKey);
      }

      // 重新渲染以更新 UI（按钮状态、文件已审状态等）
      // 同时重新构建文件树以反映已审状态
      if (this.fileChanges.length > 0) {
        this.fileTreeRoot = this.createFileTree(this.fileChanges);
      }
      this.render();
    });
  }

  /* ============================================================
   * Code Review 辅助方法
   * ============================================================ */

  /**
   * 判断当前是否处于 Code Review 进行中状态
   *
   * @returns true = Code Review 进行中，false = 未进行
   */
  private isCodeReviewActive(): boolean {
    if (!this.currentRepoPath) return false;
    return codeReviewService.getCodeReviewState(this.currentRepoPath) !== null;
  }

  /**
   * 判断指定文件是否已审
   *
   * @param filePath - 文件路径
   * @returns true = 已审，false = 未审或无 Code Review
   */
  private isFileReviewed(filePath: string): boolean {
    if (!this.currentRepoPath) return true;
    if (!this.isCodeReviewActive()) return true;
    return codeReviewService.isFileReviewed(this.currentRepoPath, filePath);
  }

  /**
   * 更新 Code Review 进度指示 UI
   *
   * 不重新渲染整个视图，仅更新进度文字。
   */
  private updateCodeReviewProgressUI(): void {
    if (!this.container) return;
    const progressElem: HTMLElement | null = this.container.querySelector('.code-review-progress');
    if (!progressElem) return;

    const progress: { reviewed: number; total: number } = codeReviewService.getProgress(
      this.currentRepoPath || '',
      this.fileChanges.length
    );
    progressElem.textContent = `审查进度: ${progress.reviewed} / ${progress.total}`;

    // 如果所有文件都已审，自动结束 Code Review（参考 gitgraph 的行为）
    if (progress.total > 0 && progress.reviewed >= progress.total) {
      if (this.currentRepoPath && this.isCodeReviewActive()) {
        console.log('[CommitDetail] 所有文件已审完，自动结束 Code Review');
        codeReviewService.endCodeReview(this.currentRepoPath);
        // 重新渲染以更新按钮状态
        this.render();
      }
    }
  }

  /**
   * 更新父文件夹的已审状态
   *
   * 当某个文件的已审状态改变后，需要向上递归更新所有父文件夹的已审状态。
   * 通过 DOM 结构向上查找父文件夹的 <li> 元素并更新其 .unreviewed 类。
   *
   * @param fileElem - 文件 DOM 元素
   */
  private updateParentFolderReviewedState(fileElem: HTMLElement): void {
    if (!this.container || !this.fileTreeRoot) return;

    // 获取文件路径
    const filePath: string = fileElem.getAttribute('data-file-path') || '';
    if (!filePath) return;

    // 从文件树重新计算已审状态
    this.calcFoldersReviewed(this.fileTreeRoot);

    // 更新 DOM 上所有文件夹的 unreviewed 类
    const folderLabels: NodeListOf<HTMLElement> = this.container.querySelectorAll('.file-tree-folder-label');
    for (const label of folderLabels) {
      const folderPath: string = label.getAttribute('data-folder-path') || '';
      if (!folderPath) continue;

      // 在 fileTreeRoot 中查找对应文件夹节点
      const folderNode: FileTreeNode | null = this.findNodeByPath(this.fileTreeRoot, folderPath);
      if (folderNode) {
        if (folderNode.reviewed === false) {
          label.classList.add('unreviewed');
        } else {
          label.classList.remove('unreviewed');
        }
      }
    }
  }

  /**
   * 在文件树中按路径查找节点
   *
   * @param root - 文件树根节点
   * @param path - 要查找的节点路径
   * @returns 找到的节点；未找到返回 null
   */
  private findNodeByPath(root: FileTreeNode, path: string): FileTreeNode | null {
    if (root.path === path) return root;
    if (!root.children) return null;
    for (const child of root.children) {
      const found: FileTreeNode | null = this.findNodeByPath(child, path);
      if (found) return found;
    }
    return null;
  }

  /* ============================================================
   * 文件操作方法（右键菜单调用）
   * ============================================================ */

  /**
   * 查看指定版本的文件内容
   *
   * 调用后端 getFileContentAtCommit 获取该提交中文件的内容，
   * 然后通过 onFileClick 回调显示（这里复用 diff 面板的回调，
   * 因为当前应用只有 diff 面板可以显示文件内容）。
   *
   * @param filePath - 文件路径
   */
  private async viewFileAtRevision(filePath: string): Promise<void> {
    if (!this.currentRepoPath || !this.currentCommitHash) return;
    try {
      // 调用后端获取该提交中文件的内容
      const content: string = await repoService.getFileContentAtCommit(
        this.currentRepoPath,
        this.currentCommitHash,
        filePath
      );
      console.log(`[CommitDetail] 获取文件内容成功: ${filePath} (${content.length} 字符)`);
      // TODO: 未来可以通过专门的文件查看器显示；当前先打印日志
    } catch (err) {
      console.error('[CommitDetail] 查看文件版本失败:', err);
    }
  }

  /**
   * 查看文件与工作区版本的 diff
   *
   * @param filePath - 文件路径
   */
  private async viewDiffWithWorkingFile(filePath: string): Promise<void> {
    if (!this.currentRepoPath || !this.currentCommitHash) return;
    try {
      // 获取该提交中文件的内容
      const oldContent: string = await repoService.getFileContentAtCommit(
        this.currentRepoPath,
        this.currentCommitHash,
        filePath
      );
      // 获取工作区中文件的内容
      const newContent: string = await repoService.getWorktreeFileContent(
        this.currentRepoPath,
        filePath
      );
      console.log(`[CommitDetail] 工作区对比: ${filePath} (旧 ${oldContent.length} 字符 → 新 ${newContent.length} 字符)`);
      // TODO: 未来通过专门的 diff 面板显示
    } catch (err) {
      console.error('[CommitDetail] 查看工作区对比失败:', err);
    }
  }

  /**
   * 打开文件（在工作区中打开）
   *
   * @param filePath - 文件路径
   */
  private async openFile(filePath: string): Promise<void> {
    if (!this.currentRepoPath) return;
    try {
      // 获取工作区中文件的内容（触发后端读取）
      const content: string = await repoService.getWorktreeFileContent(
        this.currentRepoPath,
        filePath
      );
      console.log(`[CommitDetail] 打开文件: ${filePath} (${content.length} 字符)`);
      // TODO: 未来可以通过 Tauri 的 opener 插件在系统默认编辑器中打开
    } catch (err) {
      console.error('[CommitDetail] 打开文件失败:', err);
    }
  }

  /**
   * 在外部 difftool 中打开目录对比（阶段 9：Task 9.6）
   *
   * 在文件右键菜单中点击"Open in Diff Tool"时调用。
   * 调用后端 open_dir_diff 命令，执行 `git difftool --dir-diff <from> <to>`，
   * 在用户配置的外部 difftool（如 Beyond Compare、KDiff3、Meld 等）中
   * 打开两个提交之间的目录对比视图。
   *
   * 对比范围：
   * - from = 当前提交哈希（this.currentCommitHash）
   * - to = '*'（工作区）
   * 即对比"当前提交"与"工作区"的差异，让用户在 difftool 中查看
   * 工作区相对于此提交的所有文件变更。
   *
   * 注意：此操作会阻塞直到 difftool 关闭（后端使用 std::process::Command::status()）。
   *
   * @throws 如果仓库路径或提交哈希缺失，或后端命令执行失败，则记录错误日志
   */
  private async openInDiffTool(): Promise<void> {
    // 前置检查：确保仓库路径和提交哈希都有值
    if (!this.currentRepoPath || !this.currentCommitHash) {
      console.error('[CommitDetail] 无法打开 difftool：仓库路径或提交哈希缺失');
      return;
    }
    try {
      // 调用后端 open_dir_diff 命令
      // from = 当前提交哈希，to = '*'（工作区）
      // 后端会执行 git difftool --dir-diff <from> <to>
      await repoService.openDirDiff(
        this.currentRepoPath,
        this.currentCommitHash,
        '*'  // '*' 表示工作区
      );
      console.log(`[CommitDetail] 已在外部 difftool 中打开目录对比: ${this.currentCommitHash} ↔ 工作区`);
    } catch (err) {
      console.error('[CommitDetail] 打开 difftool 失败:', err);
    }
  }

  /**
   * 查看文件的 Blame 信息（Task 8.4）
   *
   * 在文件右键菜单中点击"View Blame"时调用。
   * 打开 Blame 视图，显示文件每行的提交溯源信息（commit hash/author/date）。
   * 用户点击某行的 commit hash 可跳转到对应提交的详情视图。
   *
   * 实现说明：
   * - 使用全局单例 blameViewer（在 blame-viewer.ts 中导出）
   * - 如果 Blame 视图已经打开，会先关闭再重新打开
   * - Blame 视图以模态浮层形式显示，覆盖整个窗口
   *
   * @param filePath - 文件路径（相对于仓库根目录）
   */
  private async viewBlame(filePath: string): Promise<void> {
    if (!this.currentRepoPath) return;
    try {
      // 导入 Blame 视图组件（延迟导入，避免循环依赖）
      const { blameViewer } = await import('./blame-viewer.js');
      // 打开 Blame 视图，加载文件每行的提交溯源信息
      await blameViewer.open(this.currentRepoPath, filePath);
      console.log(`[CommitDetail] 打开 Blame 视图: ${filePath}`);
    } catch (err) {
      console.error('[CommitDetail] 打开 Blame 视图失败:', err);
    }
  }

  /**
   * Task 13.5：添加文件路径到 .gitignore
   *
   * 将指定文件路径追加到仓库根目录的 .gitignore 文件中。
   * 如果 .gitignore 不存在则会创建新文件。
   * 如果路径已存在于 .gitignore 中，则提示用户不重复添加。
   *
   * 实现步骤：
   *   1. 读取当前 .gitignore 内容（文件不存在时视为空字符串）
   *   2. 检查文件路径是否已存在（避免重复添加）
   *   3. 追加新行到 .gitignore 末尾
   *   4. 调用后端 write_file_content 命令写回 .gitignore
   *
   * 注意：此方法在提交详情视图中使用，添加到 .gitignore 后不会刷新文件列表
   * （因为提交详情视图显示的是历史提交的文件变更，不是工作区状态）。
   *
   * @param filePath - 要添加到 .gitignore 的文件路径（相对于仓库根目录）
   */
  private async addToGitignore(filePath: string): Promise<void> {
    /* 必须有当前仓库路径才能操作 .gitignore 文件 */
    if (!this.currentRepoPath) return;
    console.log('[CommitDetail] 添加到 .gitignore:', filePath);
    try {
      /* 步骤 1：读取当前 .gitignore 内容（文件不存在时视为空字符串） */
      let currentContent: string = '';
      try {
        currentContent = await repoService.getWorktreeFileContent(this.currentRepoPath, '.gitignore');
      } catch {
        /* .gitignore 文件不存在，currentContent 保持为空字符串，后续会创建新文件 */
        console.log('[CommitDetail] .gitignore 文件不存在，将创建新文件');
      }

      /* 步骤 2：检查文件路径是否已存在于 .gitignore 中（避免重复添加） */
      const lines: string[] = currentContent.split(/\r?\n/);
      if (lines.includes(filePath)) {
        console.log('[CommitDetail] 文件路径已存在于 .gitignore 中，不重复添加');
        alert(`"${filePath}" 已在 .gitignore 中`);
        return;
      }

      /* 步骤 3：追加新行到 .gitignore
       * 如果当前内容不为空且不以换行结尾，先添加换行符保证格式规范 */
      const newLine: string = currentContent.length > 0 && !currentContent.endsWith('\n')
        ? `\n${filePath}\n`
        : `${filePath}\n`;
      const newContent: string = currentContent + newLine;

      /* 步骤 4：调用后端 write_file_content 命令写回 .gitignore */
      await repoService.writeFileContent(this.currentRepoPath, '.gitignore', newContent);
      console.log('[CommitDetail] 已添加到 .gitignore');
      alert(`已将 "${filePath}" 添加到 .gitignore`);
    } catch (err) {
      console.error('[CommitDetail] 添加到 .gitignore 失败:', err);
      alert(`添加到 .gitignore 失败: ${err}`);
    }
  }

  /**
   * 重置文件到指定版本
   *
   * 注意：此操作会丢失工作区中该文件的所有未提交变更。
   * 当前阶段仅打印日志，实际重置功能需要在后端添加命令。
   *
   * @param filePath - 文件路径
   */
  private async resetFileToRevision(filePath: string): Promise<void> {
    if (!this.currentRepoPath || !this.currentCommitHash) return;
    // 当前后端没有直接的 reset_file_to_revision 命令
    // 这里先打印日志，未来扩展后端时再实现
    console.warn(`[CommitDetail] 重置文件到此版本（暂未实现）: ${filePath} @ ${this.currentCommitHash}`);
  }

  /**
   * 复制文件路径到剪贴板
   *
   * @param filePath - 文件路径（相对路径）
   * @param absolute - true = 复制绝对路径，false = 复制相对路径
   */
  private async copyFilePath(filePath: string, absolute: boolean): Promise<void> {
    if (!this.currentRepoPath) return;
    const fullPath: string = absolute
      ? `${this.currentRepoPath.replace(/[\\/]+$/, '')}/${filePath}`
      : filePath;
    try {
      await navigator.clipboard.writeText(fullPath);
      console.log(`[CommitDetail] 已复制${absolute ? '绝对' : '相对'}路径: ${fullPath}`);
    } catch (err) {
      console.error('[CommitDetail] 复制路径失败:', err);
    }
  }

  /* ============================================================
   * 工具方法
   * ============================================================ */

  /**
   * 解析提交消息，分离标题和正文
   *
   * Git 提交消息的格式约定：
   * - 第一行是标题（简短的描述）
   * - 空行分隔后是正文（详细的描述，可能有多行）
   *
   * @param message - 完整的提交消息字符串
   * @returns 包含 title（标题）和 body（正文）的对象
   */
  private parseCommitMessage(message: string): { title: string; body: string } {
    const lines: string[] = message.split('\n');
    const title: string = lines[0] || '(无提交消息)';

    // 跳过标题后的空行，找到正文起始
    let bodyStartIndex: number = 1;
    while (bodyStartIndex < lines.length && lines[bodyStartIndex].trim() === '') {
      bodyStartIndex++;
    }
    const body: string = lines.slice(bodyStartIndex).join('\n').trim();
    return { title, body };
  }

  /**
   * 将 ISO 8601 格式的日期字符串转为本地可读格式
   *
   * @param isoDate - ISO 8601 格式的日期字符串
   * @returns 本地化的日期字符串
   */
  private formatDate(isoDate: string): string {
    try {
      const date: Date = new Date(isoDate);
      if (isNaN(date.getTime())) return isoDate;
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
      return isoDate;
    }
  }

  /**
   * 对 HTML 特殊字符进行转义，防止 XSS 攻击
   *
   * @param text - 需要转义的原始文本
   * @returns 转义后的安全文本
   */
  private escapeHtml(text: string): string {
    const div: HTMLDivElement = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
