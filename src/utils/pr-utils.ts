/**
 * Pull Request 创建工具（PR Creation Utilities）
 *
 * 此模块提供 Pull Request 创建相关功能：
 * 1. Provider 自动检测：根据远程仓库 URL 匹配 GitHub / GitLab / Bitbucket
 * 2. 远程 URL 解析：从 HTTPS 或 SSH 格式的远程 URL 中提取 owner 和 repo 名称
 * 3. PR 创建 URL 生成：根据 Provider 和分支信息生成预填表单的 URL
 * 4. 打开 URL：通过 Tauri 后端命令在默认浏览器中打开 URL
 *
 * 参考实现：
 * - docs/git/src/utils.ts 的 createPullRequest 函数
 * - docs/git/web/settingsWidget.ts 的 Provider 自动检测逻辑
 *
 * 使用方式：
 * ```typescript
 * import { detectPullRequestProvider, createPullRequest } from '../utils/pr-utils';
 *
 * // 检测 Provider
 * const provider = detectPullRequestProvider('https://github.com/owner/repo.git');
 * // 返回: 'github'
 *
 * // 创建 PR
 * await createPullRequest({
 *   provider: 'github',
 *   hostRootUrl: 'https://github.com',
 *   sourceOwner: 'owner',
 *   sourceRepo: 'repo',
 *   sourceBranch: 'feature-branch',
 *   destOwner: 'owner',
 *   destRepo: 'repo',
 *   destBranch: 'main',
 * });
 * ```
 */

import { invoke } from '@tauri-apps/api/core';

/* ========================================================================== *
 * 第一部分：类型定义
 * ========================================================================== */

/**
 * Pull Request 提供商类型
 * - 'github'：GitHub（github.com 或企业版 GitHub）
 * - 'gitlab'：GitLab（gitlab.com 或自托管 GitLab）
 * - 'bitbucket'：Bitbucket（bitbucket.org）
 * - 'custom'：自定义提供商（使用用户配置的 URL 模板）
 */
export type PullRequestProvider = 'github' | 'gitlab' | 'bitbucket' | 'custom';

/**
 * Pull Request 创建配置
 *
 * 包含创建 PR 所需的所有信息：
 * - 源分支信息（从哪个分支创建 PR）
 * - 目标分支信息（PR 合并到哪个分支）
 * - Provider 信息（使用哪个平台创建 PR）
 */
export interface PullRequestConfig {
  /** PR 提供商 */
  provider: PullRequestProvider;
  /** 平台根 URL（如 'https://github.com'，企业版可自定义为内部域名） */
  hostRootUrl: string;
  /** 源仓库的 owner（用户名或组织名） */
  sourceOwner: string;
  /** 源仓库名 */
  sourceRepo: string;
  /** 源分支名（PR 的源分支） */
  sourceBranch: string;
  /** 目标仓库的 owner（通常与 sourceOwner 相同，fork 场景下不同） */
  destOwner: string;
  /** 目标仓库名 */
  destRepo: string;
  /** 目标分支名（PR 合并到的分支，如 'main'） */
  destBranch: string;
  /** （仅 GitLab）目标项目 ID，用于跨项目 MR */
  destProjectId?: string;
  /** （仅 Custom）自定义 URL 模板 */
  customTemplateUrl?: string;
}

/**
 * 从远程 URL 解析出的仓库信息
 */
interface ParsedRemoteUrl {
  /** 平台根 URL（如 'https://github.com'） */
  hostRootUrl: string;
  /** 仓库 owner（用户名或组织名） */
  owner: string;
  /** 仓库名 */
  repo: string;
}

/* ========================================================================== *
 * 第二部分：Provider 自动检测
 * ========================================================================== */

/**
 * GitHub 远程 URL 匹配正则
 * 匹配以下格式：
 * - HTTPS: https://github.com/owner/repo.git
 * - SSH:   git@github.com:owner/repo.git
 */
const GITHUB_URL_REGEXP = /^(https?:\/\/|git@)[^/]*github/;

/**
 * GitLab 远程 URL 匹配正则
 * 匹配以下格式：
 * - HTTPS: https://gitlab.com/owner/repo.git
 * - SSH:   git@gitlab.com:owner/repo.git
 */
const GITLAB_URL_REGEXP = /^(https?:\/\/|git@)[^/]*gitlab/;

/**
 * Bitbucket 远程 URL 匹配正则
 * 匹配以下格式：
 * - HTTPS: https://bitbucket.org/owner/repo.git
 * - SSH:   git@bitbucket.org:owner/repo.git
 */
const BITBUCKET_URL_REGEXP = /^(https?:\/\/|git@)[^/]*bitbucket/;

/**
 * 根据 remote URL 自动检测 PR 提供商
 *
 * 匹配规则（与 gitgraph settingsWidget.ts 一致）：
 * 1. URL 包含 "github" → GitHub
 * 2. URL 包含 "gitlab" → GitLab
 * 3. URL 包含 "bitbucket" → Bitbucket
 * 4. 都不匹配 → 默认 Bitbucket（与 gitgraph 行为一致）
 *
 * @param remoteUrl - 远程仓库 URL（如 'https://github.com/owner/repo.git'）
 * @returns 检测到的 PR 提供商
 */
export function detectPullRequestProvider(remoteUrl: string): PullRequestProvider {
  // 如果 URL 为空，默认返回 Bitbucket
  if (!remoteUrl) return 'bitbucket';

  // 按优先级匹配：GitHub → GitLab → Bitbucket → 默认
  if (GITHUB_URL_REGEXP.test(remoteUrl)) {
    return 'github';
  }
  if (GITLAB_URL_REGEXP.test(remoteUrl)) {
    return 'gitlab';
  }
  if (BITBUCKET_URL_REGEXP.test(remoteUrl)) {
    return 'bitbucket';
  }
  // 默认返回 Bitbucket（与 gitgraph 行为一致）
  return 'bitbucket';
}

/* ========================================================================== *
 * 第三部分：远程 URL 解析
 * ========================================================================== */

/**
 * HTTPS 远程 URL 解析正则
 * 匹配格式：https://[host]/[owner]/[repo].git 或 https://[host]/[owner]/[repo]
 *
 * 捕获组：
 * - $1: host（含协议，如 'https://github.com'）
 * - $2: owner（如 'mhutchie'）
 * - $3: repo（如 'vscode-git-graph'，不含 .git 后缀）
 */
const HTTPS_REMOTE_URL_REGEXP = /^(https?:\/\/[^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/;

/**
 * SSH 远程 URL 解析正则
 * 匹配格式：git@[host]:[owner]/[repo].git 或 git@[host]:[owner]/[repo]
 *
 * 捕获组：
 * - $1: host（不含用户名，如 'github.com'）
 * - $2: owner（如 'mhutchie'）
 * - $3: repo（如 'vscode-git-graph'，不含 .git 后缀）
 */
const SSH_REMOTE_URL_REGEXP = /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/;

/**
 * 解析远程仓库 URL，提取平台根 URL、owner 和 repo
 *
 * 支持两种格式的远程 URL：
 * 1. HTTPS 格式：https://github.com/owner/repo.git
 * 2. SSH 格式：git@github.com:owner/repo.git
 *
 * @param remoteUrl - 远程仓库 URL
 * @returns 解析结果，如果 URL 格式无法识别返回 null
 */
export function parseRemoteUrl(remoteUrl: string): ParsedRemoteUrl | null {
  // 尝试 HTTPS 格式匹配
  const httpsMatch = remoteUrl.match(HTTPS_REMOTE_URL_REGEXP);
  if (httpsMatch) {
    return {
      hostRootUrl: httpsMatch[1], // 如 'https://github.com'
      owner: httpsMatch[2],       // 如 'owner'
      repo: httpsMatch[3],        // 如 'repo'
    };
  }

  // 尝试 SSH 格式匹配
  const sshMatch = remoteUrl.match(SSH_REMOTE_URL_REGEXP);
  if (sshMatch) {
    // SSH 格式的 host 不含协议，需要补上 https://
    return {
      hostRootUrl: `https://${sshMatch[1]}`, // 如 'https://github.com'
      owner: sshMatch[2],                     // 如 'owner'
      repo: sshMatch[3],                      // 如 'repo'
    };
  }

  // URL 格式无法识别
  return null;
}

/* ========================================================================== *
 * 第四部分：PR 创建 URL 生成
 * ========================================================================== */

/**
 * 匹配 URL 模板中 $1 到 $8 占位符的正则表达式
 * 占位符含义：
 * - $1: hostRootUrl（平台根 URL）
 * - $2: sourceOwner（源仓库 owner）
 * - $3: sourceRepo（源仓库名）
 * - $4: sourceBranch（源分支名）
 * - $5: destOwner（目标仓库 owner）
 * - $6: destRepo（目标仓库名）
 * - $7: destProjectId（目标项目 ID，仅 GitLab 使用）
 * - $8: destBranch（目标分支名）
 */
const PR_URL_PLACEHOLDER_REGEXP = /\$([1-8])/g;

/**
 * 根据 Provider 获取 PR 创建的 URL 模板
 *
 * 各 Provider 的 PR 创建 URL 格式：
 * - GitHub:  {hostRootUrl}/{destOwner}/{destRepo}/compare/{destBranch}...{sourceOwner}:{sourceBranch}
 * - GitLab:  {hostRootUrl}/{sourceOwner}/{sourceRepo}/-/merge_requests/new?merge_request[source_branch]={sourceBranch}&merge_request[target_branch]={destBranch}
 * - Bitbucket: {hostRootUrl}/{sourceOwner}/{sourceRepo}/pull-requests/new?source={sourceOwner}/{sourceRepo}::{sourceBranch}&dest={destOwner}/{destRepo}::{destBranch}
 * - Custom:  使用用户配置的自定义模板
 *
 * @param config - PR 创建配置
 * @returns URL 模板字符串
 */
function getPrUrlTemplate(config: PullRequestConfig): string {
  switch (config.provider) {
    case 'github':
      // GitHub: compare 页面，格式为 dest...source
      // 示例: https://github.com/owner/repo/compare/main...owner:feature-branch
      return '$1/$5/$6/compare/$8...$2:$4';
    case 'gitlab':
      // GitLab: 新建 merge_request 页面，通过查询参数指定源分支和目标分支
      // 示例: https://gitlab.com/owner/repo/-/merge_requests/new?merge_request[source_branch]=feature-branch&merge_request[target_branch]=main
      // 如果有 destProjectId，添加 target_project_id 参数（用于跨项目 MR）
      return '$1/$2/$3/-/merge_requests/new?merge_request[source_branch]=$4&merge_request[target_branch]=$8' +
        (config.destProjectId ? '&merge_request[target_project_id]=$7' : '');
    case 'bitbucket':
      // Bitbucket: 新建 pull-request 页面，通过查询参数指定源和目标
      // 示例: https://bitbucket.org/owner/repo/pull-requests/new?source=owner/repo::feature-branch&dest=owner/repo::main
      return '$1/$2/$3/pull-requests/new?source=$2/$3::$4&dest=$5/$6::$8';
    case 'custom':
      // Custom: 使用用户配置的自定义模板
      return config.customTemplateUrl ?? '';
    default:
      return '';
  }
}

/**
 * 生成 PR 创建的完整 URL
 *
 * 将 URL 模板中的 $1-$8 占位符替换为实际的配置值。
 *
 * @param config - PR 创建配置
 * @returns 完整的 PR 创建 URL
 */
export function generatePullRequestUrl(config: PullRequestConfig): string {
  // 获取 URL 模板
  const templateUrl = getPrUrlTemplate(config);
  if (!templateUrl) return '';

  // 占位符对应的值列表（索引 0 对应 $1，索引 1 对应 $2，依此类推）
  const urlFieldValues = [
    config.hostRootUrl,    // $1
    config.sourceOwner,    // $2
    config.sourceRepo,     // $3
    config.sourceBranch,   // $4
    config.destOwner,      // $5
    config.destRepo,       // $6
    config.destProjectId ?? '', // $7
    config.destBranch,     // $8
  ];

  // 替换模板中的占位符
  const url = templateUrl.replace(PR_URL_PLACEHOLDER_REGEXP, (_, index) => {
    const i = parseInt(index, 10) - 1; // 占位符 $1 对应索引 0
    return i >= 0 && i < urlFieldValues.length ? urlFieldValues[i] : '';
  });

  return url;
}

/* ========================================================================== *
 * 第五部分：PR 创建主函数
 * ========================================================================== */

/**
 * 创建 Pull Request
 *
 * 根据 Provider 和分支信息生成 PR 创建 URL，并在默认浏览器中打开。
 *
 * 工作流程：
 * 1. 生成 PR 创建 URL（调用 generatePullRequestUrl）
 * 2. 通过 Tauri 后端命令 open_external_url 在默认浏览器中打开 URL
 *
 * @param config - PR 创建配置
 * @throws 如果 URL 生成失败或打开浏览器失败
 */
export async function createPullRequest(config: PullRequestConfig): Promise<void> {
  // 生成 PR 创建 URL
  const url = generatePullRequestUrl(config);
  if (!url) {
    throw new Error('无法生成 Pull Request URL，请检查 PR 配置');
  }

  try {
    // 调用 Tauri 后端命令在默认浏览器中打开 URL
    await invoke('open_external_url', { url });
  } catch (err) {
    // 打开浏览器失败，抛出错误
    throw new Error(`打开 Pull Request URL 失败: ${String(err)}`);
  }
}

/**
 * 从远程仓库配置自动构建 PR 创建配置
 *
 * 此函数简化了 PR 创建流程：
 * 1. 从远程 URL 自动检测 Provider
 * 2. 从远程 URL 解析 owner 和 repo
 * 3. 默认目标分支为仓库的默认分支（如 main / master）
 *
 * @param remoteUrl - 远程仓库 URL（如 'https://github.com/owner/repo.git'）
 * @param sourceBranch - 源分支名（PR 的源分支）
 * @param destBranch - 目标分支名（PR 合并到的分支，如 'main'）
 * @returns PR 创建配置，如果远程 URL 无法解析返回 null
 */
export function buildPullRequestConfigFromRemote(
  remoteUrl: string,
  sourceBranch: string,
  destBranch: string,
): PullRequestConfig | null {
  // 解析远程 URL
  const parsed = parseRemoteUrl(remoteUrl);
  if (!parsed) {
    return null;
  }

  // 检测 Provider
  const provider = detectPullRequestProvider(remoteUrl);

  // 构建 PR 创建配置
  // 默认源仓库和目标仓库相同（非 fork 场景）
  return {
    provider,
    hostRootUrl: parsed.hostRootUrl,
    sourceOwner: parsed.owner,
    sourceRepo: parsed.repo,
    sourceBranch,
    destOwner: parsed.owner,
    destRepo: parsed.repo,
    destBranch,
  };
}
