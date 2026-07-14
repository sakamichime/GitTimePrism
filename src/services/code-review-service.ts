/*
 * Code Review 服务模块
 *
 * 管理 GitTimePrism 的代码审查（Code Review）状态。
 * 使用 localStorage 持久化 Code Review 进度，让用户可以分多次审阅同一个提交/对比的文件变更。
 *
 * 数据结构（CodeReviewState）：
 *   - repoPath：仓库路径（用作 localStorage 键的一部分，避免不同仓库的 Code Review 状态互相污染）
 *   - commitHash：被审查的提交哈希；对比模式下使用 fromHash→toHash 的组合字符串
 *   - startDate：开始审查的时间戳（毫秒）
 *   - lastActivityDate：最后一次活动（标记文件已审/未审）的时间戳（毫秒），用于判断是否过期
 *   - reviewedFiles：已审文件路径列表（newFilePath）
 *
 * 过期策略：
 *   - 超过 90 天未活动的 Code Review 状态会被清理（cleanupExpiredReviews 方法）
 *   - 调用方在应用启动或打开仓库时应主动调用 cleanupExpiredReviews()
 *
 * 使用方式：
 *   import { codeReviewService } from '../services/code-review-service';
 *   codeReviewService.startCodeReview(repoPath, commitHash);
 *   codeReviewService.markFileAsReviewed(repoPath, filePath);
 *   const progress = codeReviewService.getProgress(repoPath);
 */

/**
 * Code Review 状态结构
 *
 * 描述一次代码审查的完整状态，会被序列化后存入 localStorage。
 */
export interface CodeReviewState {
  /** 仓库路径（用作 localStorage 键的隔离维度） */
  repoPath: string;
  /** 被审查的提交哈希；对比模式下为 'fromHash→toHash' 的组合字符串 */
  commitHash: string;
  /** 开始 Code Review 的时间戳（毫秒，Date.now()） */
  startDate: number;
  /** 最后一次活动的时间戳（毫秒）；用于计算 90 天过期 */
  lastActivityDate: number;
  /** 已审文件路径列表（文件在 GitFileChange 中的 newFilePath） */
  reviewedFiles: string[];
}

/**
 * localStorage 键名前缀
 *
 * 每个仓库的 Code Review 状态单独存储，键名格式：
 *   gittimeprism:codeReview:<仓库路径>
 * 这样切换仓库时不会互相影响。
 */
const CODE_REVIEW_STORAGE_PREFIX: string = 'gittimeprism:codeReview:';

/**
 * Code Review 过期时间（毫秒）
 *
 * 90 天未活动后，Code Review 状态会被自动清理。
 * 90 天 = 90 * 24 * 60 * 60 * 1000 毫秒
 */
const CODE_REVIEW_EXPIRY_MS: number = 90 * 24 * 60 * 60 * 1000;

/**
 * 拼接指定仓库的 Code Review localStorage 键名
 *
 * 使用 encodeURIComponent 编码仓库路径，避免路径中的特殊字符
 * （如反斜杠、冒号、空格）影响 localStorage 键的解析。
 *
 * @param repoPath - 仓库路径
 * @returns 该仓库对应的 localStorage 键名
 */
function buildStorageKey(repoPath: string): string {
  return CODE_REVIEW_STORAGE_PREFIX + encodeURIComponent(repoPath);
}

/**
 * Code Review 服务对象
 *
 * 提供以下方法：
 *   - startCodeReview：开始一次新的 Code Review（覆盖之前的同名状态）
 *   - endCodeReview：结束并清除 Code Review 状态
 *   - getCodeReviewState：读取当前 Code Review 状态（不存在则返回 null）
 *   - isFileReviewed：判断指定文件是否已审
 *   - markFileAsReviewed：标记文件为已审
 *   - markFileAsNotReviewed：取消文件的已审标记
 *   - getProgress：获取审查进度（已审数 / 总数）
 *   - cleanupExpiredReviews：清理所有过期的 Code Review 状态（90 天未活动）
 */
export const codeReviewService = {
  /**
   * 开始一次 Code Review
   *
   * 如果该仓库已有 Code Review 状态，会被覆盖。
   * 初始状态下 reviewedFiles 为空数组（所有文件都未审）。
   *
   * @param repoPath - 仓库路径
   * @param commitHash - 被审查的提交哈希（对比模式可传 'fromHash→toHash'）
   */
  startCodeReview(repoPath: string, commitHash: string): void {
    const now: number = Date.now();
    const state: CodeReviewState = {
      repoPath,
      commitHash,
      startDate: now,
      lastActivityDate: now,
      reviewedFiles: [],
    };
    try {
      localStorage.setItem(buildStorageKey(repoPath), JSON.stringify(state));
    } catch (err) {
      // localStorage 写入失败时仅打印警告，不抛出异常（避免阻塞 UI）
      console.warn('[CodeReviewService] 写入 localStorage 失败:', err);
    }
  },

  /**
   * 结束 Code Review 并清除状态
   *
   * 调用此方法后，该仓库的所有已审文件记录都会被清除。
   *
   * @param repoPath - 仓库路径
   */
  endCodeReview(repoPath: string): void {
    try {
      localStorage.removeItem(buildStorageKey(repoPath));
    } catch (err) {
      console.warn('[CodeReviewService] 移除 localStorage 失败:', err);
    }
  },

  /**
   * 获取指定仓库的 Code Review 状态
   *
   * 如果该仓库没有进行中的 Code Review，返回 null。
   * 如果存储的数据格式损坏（JSON 解析失败或字段缺失），返回 null。
   *
   * @param repoPath - 仓库路径
   * @returns Code Review 状态；不存在或损坏则返回 null
   */
  getCodeReviewState(repoPath: string): CodeReviewState | null {
    try {
      const raw: string | null = localStorage.getItem(buildStorageKey(repoPath));
      if (raw === null) return null;
      const parsed = JSON.parse(raw) as Partial<CodeReviewState>;
      // 校验必填字段，损坏数据视为不存在
      if (
        typeof parsed.repoPath !== 'string' ||
        typeof parsed.commitHash !== 'string' ||
        typeof parsed.startDate !== 'number' ||
        typeof parsed.lastActivityDate !== 'number' ||
        !Array.isArray(parsed.reviewedFiles)
      ) {
        return null;
      }
      return {
        repoPath: parsed.repoPath,
        commitHash: parsed.commitHash,
        startDate: parsed.startDate,
        lastActivityDate: parsed.lastActivityDate,
        reviewedFiles: parsed.reviewedFiles as string[],
      };
    } catch (err) {
      console.warn('[CodeReviewService] 读取 localStorage 失败:', err);
      return null;
    }
  },

  /**
   * 判断指定文件是否已被审查
   *
   * 如果当前仓库没有进行中的 Code Review，所有文件都视为未审（返回 false）。
   *
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径（GitFileChange.newFilePath）
   * @returns true = 已审，false = 未审或无 Code Review 进行中
   */
  isFileReviewed(repoPath: string, filePath: string): boolean {
    const state: CodeReviewState | null = this.getCodeReviewState(repoPath);
    if (state === null) return false;
    return state.reviewedFiles.includes(filePath);
  },

  /**
   * 标记文件为已审
   *
   * 如果文件已在已审列表中，不会重复添加。
   * 同时更新 lastActivityDate，重置 90 天过期计时。
   *
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径
   */
  markFileAsReviewed(repoPath: string, filePath: string): void {
    const state: CodeReviewState | null = this.getCodeReviewState(repoPath);
    if (state === null) return;
    // 避免重复添加
    if (!state.reviewedFiles.includes(filePath)) {
      state.reviewedFiles.push(filePath);
    }
    state.lastActivityDate = Date.now();
    try {
      localStorage.setItem(buildStorageKey(repoPath), JSON.stringify(state));
    } catch (err) {
      console.warn('[CodeReviewService] 更新 localStorage 失败:', err);
    }
  },

  /**
   * 取消文件的已审标记（标记为未审）
   *
   * 同时更新 lastActivityDate。
   *
   * @param repoPath - 仓库路径
   * @param filePath - 文件路径
   */
  markFileAsNotReviewed(repoPath: string, filePath: string): void {
    const state: CodeReviewState | null = this.getCodeReviewState(repoPath);
    if (state === null) return;
    state.reviewedFiles = state.reviewedFiles.filter((p: string) => p !== filePath);
    state.lastActivityDate = Date.now();
    try {
      localStorage.setItem(buildStorageKey(repoPath), JSON.stringify(state));
    } catch (err) {
      console.warn('[CodeReviewService] 更新 localStorage 失败:', err);
    }
  },

  /**
   * 获取 Code Review 进度
   *
   * @param repoPath - 仓库路径
   * @param totalFiles - 本次提交/对比涉及的文件总数；如果不传，total 字段返回已审数
   * @returns { reviewed: 已审文件数, total: 文件总数 }
   */
  getProgress(repoPath: string, totalFiles?: number): { reviewed: number; total: number } {
    const state: CodeReviewState | null = this.getCodeReviewState(repoPath);
    if (state === null) {
      return { reviewed: 0, total: totalFiles ?? 0 };
    }
    return {
      reviewed: state.reviewedFiles.length,
      total: totalFiles ?? state.reviewedFiles.length,
    };
  },

  /**
   * 清理所有过期的 Code Review 状态
   *
   * 遍历 localStorage 中所有以 CODE_REVIEW_STORAGE_PREFIX 开头的键，
   * 如果对应状态的 lastActivityDate 距今超过 90 天，则删除该键。
   *
   * 应在应用启动或打开仓库时调用此方法，避免 localStorage 中堆积无效数据。
   */
  cleanupExpiredReviews(): void {
    const now: number = Date.now();
    // 收集需要删除的键，避免在遍历过程中修改 localStorage 导致索引错乱
    const keysToDelete: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key: string | null = localStorage.key(i);
        if (key === null || !key.startsWith(CODE_REVIEW_STORAGE_PREFIX)) continue;
        try {
          const raw: string | null = localStorage.getItem(key);
          if (raw === null) continue;
          const parsed = JSON.parse(raw) as Partial<CodeReviewState>;
          if (typeof parsed.lastActivityDate !== 'number') {
            // 字段损坏，直接清理
            keysToDelete.push(key);
            continue;
          }
          if (now - parsed.lastActivityDate > CODE_REVIEW_EXPIRY_MS) {
            keysToDelete.push(key);
          }
        } catch {
          // JSON 解析失败，直接清理
          keysToDelete.push(key);
        }
      }
      // 批量删除
      for (const key of keysToDelete) {
        localStorage.removeItem(key);
      }
      if (keysToDelete.length > 0) {
        console.log(`[CodeReviewService] 已清理 ${keysToDelete.length} 个过期的 Code Review 状态`);
      }
    } catch (err) {
      console.warn('[CodeReviewService] 清理过期 Code Review 失败:', err);
    }
  },
};
