/*
 * Git 提交节点图模块
 *
 * 此模块负责获取和解析 Git 的提交历史节点图数据。
 *
 * 历史版本（向后兼容）：
 * - 通过执行 `git log --graph --pretty=format:...` 命令，
 *   构建结构化的提交节点列表，包含 ASCII 图形线、提交哈希、父提交和消息。
 * - 用于旧版前端 ASCII 节点图渲染。
 *
 * 新增版本（与 gitgraph 项目对齐）：
 * - 通过并行调用 get_log_enhanced + get_refs + get_stashes 三路数据，
 *   组装出带 ref 注解的 AnnotatedCommit 列表。
 * - 每个 commit 注解 heads/tags/remotes/stash 列表。
 * - 当 HEAD 在已加载 commits 中且 show_uncommitted_changes=true 时，
 *   在 commits 头部注入虚拟 UNCOMMITTED 节点。
 * - 把 stashes 注入到对应 base_hash 的 commit 后（如果 stash 自身的 hash 不在列表中）。
 * - 返回 AnnotatedCommitGraph（commits + head + more_commits_available）。
 *
 * 节点图用于可视化展示分支、合并等 Git 操作的历史关系。
 */

use super::commands::{run_git, GitError};
use super::log::{get_log_enhanced, CommitOrdering, LogQueryParams};
use super::refs::{get_refs, RefMap};
use super::stash::{get_stashes, StashInfo};

/**
 * 旧版单个提交节点的详细信息（保持向后兼容）
 *
 * 包含节点图的 ASCII 线条、提交哈希、父提交列表和提交消息。
 * 此结构体保留是为了不破坏旧版前端代码。
 *
 * Task 13.8：已标记为 deprecated（弃用）。
 * 新代码应使用 AnnotatedCommit 结构体（带 ref 注解的新版节点图数据结构）。
 * AnnotatedCommit 提供 heads/tags/remotes/stash 注解字段，支持前端 Canvas 渲染。
 */
#[deprecated(
    since = "0.1.0",
    note = "使用 AnnotatedCommit 代替。新版节点图改用 Canvas 渲染，不再需要 ASCII 线条字段。"
)]
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct GraphCommit {
    /// 节点图的 ASCII 线条（如 "* ", "| ", "|\\", "|/" 等）
    /// 这些字符构成了可视化的分支/合并结构
    pub graph_line: String,

    /// 提交的完整哈希值（40 位十六进制）
    pub hash: String,

    /// 提交的短哈希值（通常 7 位）
    pub short_hash: String,

    /// 父提交的哈希列表
    /// 普通提交有 1 个父提交，合并提交有 2 个或更多
    pub parents: Vec<String>,

    /// 作者名字
    pub author: String,

    /// 提交日期（ISO 8601 格式）
    pub date: String,

    /// 提交消息（第一行）
    pub message: String,
}

/**
 * 旧版完整的提交节点图数据（保持向后兼容）
 *
 * Task 13.8：已标记为 deprecated（弃用）。
 * 新代码应使用 AnnotatedCommitGraph 结构体（带 ref 注解的新版节点图返回数据）。
 * AnnotatedCommitGraph 包含 head 引用和 more_commits_available 标志，支持增量加载。
 */
#[deprecated(
    since = "0.1.0",
    note = "使用 AnnotatedCommitGraph 代替。新版节点图返回数据包含 head 引用和 more_commits_available 标志。"
)]
#[allow(deprecated)]
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct CommitGraph {
    /// 所有提交节点列表（按时间倒序，最新的在前）
    pub commits: Vec<GraphCommit>,

    /// 提交总数
    pub total_count: u32,
}

/**
 * UNCOMMITTED 虚拟节点的 hash 值
 *
 * 对应 gitgraph 项目中 utils.ts 的 `UNCOMMITTED = '*'` 常量。
 * 当工作区有未提交变更且 HEAD 在已加载 commits 中时，
 * 会在 commits 头部插入一个 hash 为 "*" 的虚拟节点，
 * 表示"未提交变更"。
 */
pub const UNCOMMITTED: &str = "*";

/**
 * 单个 commit 上的 tag 注解信息
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitCommitTag` 接口。
 * 表示一个 commit 上挂载的标签（branch 不属于此结构体）。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitTagAnnotation {
    /// 标签名（例如 "v1.0.0"）
    pub name: String,
    /// 是否是 annotated（附注）标签
    /// true = annotated 标签（带元数据，通过 `^{}` 解引用）
    /// false = lightweight 标签（仅是一个指向 commit 的指针）
    pub annotated: bool,
}

/**
 * 单个 commit 上的 remote 注解信息
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitCommitRemote` 接口。
 * 表示一个 commit 上挂载的远程分支引用。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitRemoteAnnotation {
    /// 远程分支名（已去除 `refs/remotes/` 前缀）
    /// 例如 "origin/main"、"origin/feature/login"
    pub name: String,
    /// 远程仓库名（从 name 中解析得到，例如 "origin"）
    /// None 表示无法识别对应的远程仓库名
    pub remote: Option<String>,
}

/**
 * 单个 commit 上的 stash 注解信息
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitCommitStash` 接口。
 * 表示一个 commit 是 stash commit（或被注入为 stash 节点）。
 * stash 注解包含 selector、base_hash 和 untracked_files_hash。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）：
 * - base_hash -> baseHash
 * - untracked_files_hash -> untrackedFilesHash
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitStashAnnotation {
    /// stash 的选择器（用于 git stash apply/pop/drop 命令）
    /// 例如 "stash@{0}"、"stash@{1}"
    pub selector: String,
    /// stash 创建时的 HEAD commit 的完整哈希值
    /// 这是 stash 的第一个 parent（parent[0]）
    /// 用于在节点图中将 stash 显示在对应 commit 之后
    pub base_hash: String,
    /// 包含未跟踪文件的 commit 的完整哈希值
    /// 只有当 stash 是用 `git stash push --include-untracked` 创建时才有值
    /// 否则为 None
    pub untracked_files_hash: Option<String>,
}

/**
 * 带 ref 注解的提交节点（新版节点图数据结构）
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitCommit` 接口。
 * 在 RawCommit 基础上增加了 heads/tags/remotes/stash 注解字段，
 * 用于在前端 Canvas 节点图中渲染分支、标签、远程、stash 标记。
 *
 * 与旧版 GraphCommit 的区别：
 * - 没有 graph_line（ASCII 线条）字段，前端改用 Canvas 绘制
 * - 没有 short_hash 字段，前端自行截取
 * - date 是 i64（Unix 时间戳）而非 ISO 字符串
 * - 新增 heads/tags/remotes/stash 注解字段
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct AnnotatedCommit {
    /// 提交的完整哈希值（40 位十六进制）
    pub hash: String,

    /// 父提交的哈希列表
    /// 普通提交有 1 个父提交，合并提交有 2 个或更多
    pub parents: Vec<String>,

    /// 作者名字
    pub author: String,

    /// 作者邮箱
    pub email: String,

    /// 提交日期（Unix 时间戳，单位：秒）
    pub date: i64,

    /// 提交消息（第一行）
    pub message: String,

    /// 此 commit 上挂载的本地分支名列表
    /// 例如 ["main", "feature/login"] 表示此 commit 是这两个分支的尖端
    pub heads: Vec<String>,

    /// 此 commit 上挂载的标签列表
    pub tags: Vec<CommitTagAnnotation>,

    /// 此 commit 上挂载的远程分支列表
    pub remotes: Vec<CommitRemoteAnnotation>,

    /// 此 commit 的 stash 注解
    /// None = 此 commit 不是 stash commit
    /// Some(annotation) = 此 commit 是 stash commit，包含 stash 元信息
    pub stash: Option<CommitStashAnnotation>,
}

/**
 * 新版节点图查询参数
 *
 * 封装了 get_annotated_commit_graph 的所有可选参数。
 * 对应 gitgraph 项目中 `DataSource.getCommits()` 的参数列表。
 *
 * 此结构体实现了 serde::Deserialize，可直接作为 Tauri 命令的参数接收前端传来的 JSON 对象。
 * 序列化/反序列化时使用 camelCase 命名（与前端的 TypeScript 参数名匹配）：
 * - max_commits -> maxCommits
 * - show_tags -> showTags
 * - show_remote_branches -> showRemoteBranches
 * - include_reflogs -> includeReflogs
 * - only_first_parent -> onlyFirstParent
 * - hide_remotes -> hideRemotes
 * - use_mailmap -> useMailmap
 * - show_uncommitted_changes -> showUncommittedChanges
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphQueryParams {
    /// 要查询的分支列表
    /// - None: 显示所有分支的提交（使用 --branches）
    /// - Some(vec): 只显示指定分支的提交
    pub branches: Option<Vec<String>>,

    /// 最大返回的提交数量
    /// 函数内部会 +1 来探测 more_commits_available
    pub max_commits: u32,

    /// 是否在 commit 上注解 tags
    pub show_tags: bool,

    /// 是否包含远程分支（影响 get_refs 和 get_log_enhanced 的行为）
    pub show_remote_branches: bool,

    /// 是否包含 reflog 中提到的提交
    pub include_reflogs: bool,

    /// 是否只跟随第一个 parent（--first-parent）
    pub only_first_parent: bool,

    /// 提交排序方式
    pub ordering: CommitOrdering,

    /// 已知的 remote 名称列表（用于注解 remote 名称和 --glob 过滤）
    pub remotes: Vec<String>,

    /// 要隐藏的 remote 名称列表
    pub hide_remotes: Vec<String>,

    /// 是否启用 mailmap（%aN/%aE 替换 %an/%ae）
    pub use_mailmap: bool,

    /// 是否在 HEAD 在已加载 commits 中时注入 UNCOMMITTED 虚拟节点
    pub show_uncommitted_changes: bool,
}

/**
 * GraphQueryParams 的默认实现
 *
 * 提供一组合理的默认值，便于调用方使用 ..Default::default() 语法。
 */
impl Default for GraphQueryParams {
    fn default() -> Self {
        Self {
            branches: None,
            max_commits: 100,
            show_tags: true,
            show_remote_branches: false,
            include_reflogs: false,
            only_first_parent: false,
            ordering: CommitOrdering::Default,
            remotes: Vec::new(),
            hide_remotes: Vec::new(),
            use_mailmap: false,
            show_uncommitted_changes: true,
        }
    }
}

/**
 * 新版节点图的返回数据
 *
 * 对应 gitgraph 项目中 `GitCommitData` 接口。
 * 包含带 ref 注解的提交列表、HEAD 引用、以及是否还有更多提交的标志。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）：
 * - more_commits_available -> moreCommitsAvailable
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnnotatedCommitGraph {
    /// 带 ref 注解的提交列表（按时间倒序，最新的在前）
    /// 可能包含 UNCOMMITTED 虚拟节点（在头部）和注入的 stash 节点
    pub commits: Vec<AnnotatedCommit>,

    /// HEAD 引用指向的 commit hash
    /// None 表示没有 HEAD 引用（例如空仓库）
    pub head: Option<String>,

    /// 是否还有更多提交可加载
    /// true = 实际查询到的提交数 == max_commits + 1，说明还有更多
    /// false = 实际查询到的提交数 <= max_commits，已全部加载
    pub more_commits_available: bool,
}

/**
 * 获取仓库的提交节点图（旧版，保持向后兼容）
 *
 * 执行 `git log --graph --pretty=format:...` 命令，
 * 获取带有 ASCII 图形线的提交历史记录。
 *
 * 此函数保留是为了不破坏旧版前端代码。
 * 新代码应使用 get_annotated_commit_graph。
 *
 * Task 13.8：已标记为 deprecated（弃用）。
 * 新版节点图使用 get_annotated_commit_graph 函数，返回带 ref 注解的 AnnotatedCommitGraph，
 * 支持前端 Canvas 渲染、增量加载（more_commits_available）和 stash/UNCOMMITTED 注入。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - count: 要获取的提交数量（0 表示全部）
 *
 * 返回值：
 * - Ok(CommitGraph) - 查询成功
 * - Err(GitError) - 查询失败
 */
#[deprecated(
    since = "0.1.0",
    note = "使用 get_annotated_commit_graph 代替。新版节点图返回带 ref 注解的 AnnotatedCommitGraph。"
)]
#[allow(deprecated)]
pub fn get_commit_graph(repo_path: &str, count: u32) -> Result<CommitGraph, GitError> {
    // 构建 format 字符串
    // 使用 § (U+00A7) 作为字段分隔符，不会出现在正常提交数据中
    // 与 |||SEP||| 不同，§ 是单字符，空字段不会产生多余元素
    // 末尾加 %n 确保每个提交占一行（--pretty=format: 不会自动添加换行符）
    let sep = "§";
    let format_str = format!(
        "%H{sep}%h{sep}%P{sep}%an{sep}%aI{sep}%s%n"
    );
    let full_format = format!("--pretty=format:{}", format_str);

    // 构建参数列表
    let mut args: Vec<String> = vec![
        "log".to_string(),
        "--graph".to_string(),
        full_format,
    ];

    if count > 0 {
        args.push(format!("-n{}", count));
    }

    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let output = run_git(repo_path, &args_refs);

    // 如果 git log 失败（比如仓库还没有任何提交，或其他原因），
    // 返回空的节点图而不是报错，避免前端显示"获取节点图失败"
    // git log 失败的原因可能有很多：空仓库、无效引用、格式错误等
    // 统一处理：任何 git log 失败都返回空节点图
    match output {
        Ok(out) => {
            let commits = parse_graph_output(&out.stdout);
            let total_count = commits.len() as u32;
            Ok(CommitGraph { commits, total_count })
        }
        Err(GitError::CommandFailed { .. }) => {
            // 任何 git log 命令失败（空仓库、无效引用、格式问题等），
            // 都返回空节点图，让前端显示"暂无提交记录"
            Ok(CommitGraph { commits: vec![], total_count: 0 })
        }
        Err(e) => Err(e),
    }
}

/**
 * 获取带 ref 注解的提交节点图（新版，与 gitgraph 项目对齐）
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getCommits()` 的核心逻辑。
 *
 * 算法步骤：
 * 1. 调用 get_log_enhanced 获取 commits（max_commits + 1 探测 more_commits_available）
 * 2. 调用 get_refs 获取 ref_data（heads/tags/remotes/head）
 * 3. 调用 get_stashes 获取 stashes 列表
 * 4. 探测 more_commits_available（commits.len() > max_commits）
 * 5. 如果 HEAD 在 commits 中且 show_uncommitted_changes=true，
 *    检查未提交变更数量并注入 UNCOMMITTED 虚拟节点
 * 6. 建立 commit_lookup 哈希表（hash -> index）
 * 7. 注入 stashes：
 *    - 如果 stash.hash 已在 commits 中，注解其 stash 字段
 *    - 否则如果 stash.base_hash 在 commits 中，记录待插入项
 *    - 按 base_hash 的 index 排序（同 index 按 date 倒序），从后往前插入
 * 8. 重新建立 commit_lookup（因为插入 stash 后索引变了）
 * 9. 注解 heads：遍历 ref_data.heads，在对应 commit 上添加分支名
 * 10. 注解 tags：如果 show_tags=true，遍历 ref_data.tags，在对应 commit 上添加标签
 * 11. 注解 remotes：遍历 ref_data.remotes，在对应 commit 上添加远程分支
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - params: 查询参数（见 GraphQueryParams 结构体）
 *
 * 返回值：
 * - Ok(AnnotatedCommitGraph) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_annotated_commit_graph(
    repo_path: &str,
    params: &GraphQueryParams,
) -> Result<AnnotatedCommitGraph, GitError> {
    // 步骤 1：获取 stash 列表（用于传入 log 查询的 stash_base_hashes）
    let stashes = get_stashes(repo_path)?;

    // 步骤 2：构建 log 查询参数
    let stash_base_hashes: Vec<String> = stashes
        .iter()
        .map(|s| s.base_hash.clone())
        .collect();

    let log_params = LogQueryParams {
        branches: params.branches.clone(),
        max_commits: params.max_commits,
        include_tags: params.show_tags,
        include_remotes: params.show_remote_branches,
        include_reflogs: params.include_reflogs,
        only_first_parent: params.only_first_parent,
        ordering: params.ordering,
        remotes: params.remotes.clone(),
        hide_remotes: params.hide_remotes.clone(),
        stash_base_hashes,
        use_mailmap: params.use_mailmap,
        // graph 中固定使用 Author 日期（与 gitgraph 默认行为一致）
        date_type: super::log::DateType::Author,
    };

    // 步骤 3：调用 get_log_enhanced 获取 commits
    let log_result = get_log_enhanced(repo_path, &log_params)?;
    let more_commits_available = log_result.more_commits_available;
    let mut commits = log_result.commits;

    // 步骤 4：调用 get_refs 获取 ref_data
    // hide_remotes 转换为 &[&str]
    let hide_remotes_refs: Vec<&str> = params
        .hide_remotes
        .iter()
        .map(|s| s.as_str())
        .collect();
    let ref_data = get_refs(repo_path, &hide_remotes_refs)?;

    // 步骤 5：注入 UNCOMMITTED 虚拟节点
    // 当 HEAD 在已加载 commits 中且 show_uncommitted_changes=true 时，
    // 检查未提交变更数量，如果 > 0 则在 commits 头部插入虚拟节点
    if params.show_uncommitted_changes {
        if let Some(ref head_hash) = ref_data.head {
            // 检查 HEAD 是否在已加载的 commits 中
            let head_in_commits = commits.iter().any(|c| c.hash == *head_hash);
            if head_in_commits {
                // 获取未提交变更数量
                let num_uncommitted = get_uncommitted_changes_count(repo_path)?;
                if num_uncommitted > 0 {
                    // 在 commits 头部插入 UNCOMMITTED 虚拟节点
                    // 对应 gitgraph: commits.unshift({ hash: UNCOMMITTED, parents: [refData.head], author: '*', email: '', date: now, message: 'Uncommitted Changes (N)' })
                    // 使用标准库 SystemTime 获取当前 Unix 时间戳，避免引入 chrono 依赖
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    let uncommitted_commit = super::log::RawCommit {
                        hash: UNCOMMITTED.to_string(),
                        parents: vec![head_hash.clone()],
                        author: "*".to_string(),
                        email: String::new(),
                        date: now,
                        message: format!("Uncommitted Changes ({})", num_uncommitted),
                    };
                    commits.insert(0, uncommitted_commit);
                }
            }
        }
    }

    // 步骤 6：将 RawCommit 转换为 AnnotatedCommit（初始化空的注解）
    let mut commit_nodes: Vec<AnnotatedCommit> = commits
        .into_iter()
        .map(|c| AnnotatedCommit {
            hash: c.hash,
            parents: c.parents,
            author: c.author,
            email: c.email,
            date: c.date,
            message: c.message,
            heads: Vec::new(),
            tags: Vec::new(),
            remotes: Vec::new(),
            stash: None,
        })
        .collect();

    // 步骤 7：建立 commit_lookup 哈希表（hash -> index）
    let mut commit_lookup: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (i, node) in commit_nodes.iter().enumerate() {
        commit_lookup.insert(node.hash.clone(), i);
    }

    // 步骤 8：注入 stashes
    // 算法对应 gitgraph dataSource.ts 行 207-240
    // 1. 先注解已存在的 stash commit（stash.hash 在 commit_lookup 中）
    // 2. 收集待插入项（stash.hash 不在 commit_lookup 中，但 stash.base_hash 在）
    // 3. 按 base_hash 的 index 排序（同 index 按 date 倒序）
    // 4. 从后往前插入到对应 commit 后
    let mut to_add: Vec<(usize, &StashInfo)> = Vec::new();

    for stash in &stashes {
        if let Some(&stash_index) = commit_lookup.get(&stash.hash) {
            // stash.hash 已在 commit_lookup 中：注解其 stash 字段
            commit_nodes[stash_index].stash = Some(CommitStashAnnotation {
                selector: stash.selector.clone(),
                base_hash: stash.base_hash.clone(),
                untracked_files_hash: stash.untracked_files_hash.clone(),
            });
        } else if let Some(&base_index) = commit_lookup.get(&stash.base_hash) {
            // stash.hash 不在 commit_lookup 中，但 stash.base_hash 在：记录待插入项
            to_add.push((base_index, stash));
        }
    }

    // 按 base_hash 的 index 升序排序（同 index 按 stash.date 倒序）
    // 对应 gitgraph: toAdd.sort((a, b) => a.index !== b.index ? a.index - b.index : b.data.date - a.data.date)
    to_add.sort_by(|a, b| {
        if a.0 != b.0 {
            a.0.cmp(&b.0)
        } else {
            b.1.date.cmp(&a.1.date)
        }
    });

    // 从后往前插入（避免影响前面已计算的 index）
    // 对应 gitgraph: for (i = toAdd.length - 1; i >= 0; i--) { commitNodes.splice(toAdd[i].index, 0, {...}); }
    for i in (0..to_add.len()).rev() {
        let (base_index, stash) = to_add[i];
        // 在 base_index 位置后插入（gitgraph 的 splice(index, 0, item) 是在 index 前插入，
        // 但 gitgraph 的 base_index 是 stash 应该插入的位置，从后往前插入确保前面的 index 不变）
        // 实际上 gitgraph 的 splice(index, 0, item) 是在 index 位置前插入，
        // 所以这里用 insert(base_index, ...) 对应
        let stash_node = AnnotatedCommit {
            hash: stash.hash.clone(),
            parents: vec![stash.base_hash.clone()],
            author: stash.author.clone(),
            email: stash.email.clone(),
            date: stash.date,
            message: stash.message.clone(),
            heads: Vec::new(),
            tags: Vec::new(),
            remotes: Vec::new(),
            stash: Some(CommitStashAnnotation {
                selector: stash.selector.clone(),
                base_hash: stash.base_hash.clone(),
                untracked_files_hash: stash.untracked_files_hash.clone(),
            }),
        };
        commit_nodes.insert(base_index, stash_node);
    }

    // 步骤 9：重新建立 commit_lookup（因为插入 stash 后索引变了）
    // 对应 gitgraph: for (i = 0; i < commitNodes.length; i++) { commitLookup[commitNodes[i].hash] = i; }
    commit_lookup.clear();
    for (i, node) in commit_nodes.iter().enumerate() {
        commit_lookup.insert(node.hash.clone(), i);
    }

    // 步骤 10：注解 heads
    // 对应 gitgraph: for (i = 0; i < refData.heads.length; i++) { if (typeof commitLookup[refData.heads[i].hash] === 'number') commitNodes[commitLookup[refData.heads[i].hash]].heads.push(refData.heads[i].name); }
    annotate_heads(&mut commit_nodes, &commit_lookup, &ref_data);

    // 步骤 11：注解 tags（如果 show_tags=true）
    // 对应 gitgraph: if (showTags) { for (i = 0; i < refData.tags.length; i++) { if (typeof commitLookup[refData.tags[i].hash] === 'number') commitNodes[commitLookup[refData.tags[i].hash]].tags.push({ name: refData.tags[i].name, annotated: refData.tags[i].annotated }); } }
    if params.show_tags {
        annotate_tags(&mut commit_nodes, &commit_lookup, &ref_data);
    }

    // 步骤 12：注解 remotes
    // 对应 gitgraph: for (i = 0; i < refData.remotes.length; i++) { if (typeof commitLookup[refData.remotes[i].hash] === 'number') { let name = refData.remotes[i].name; let remote = remotes.find(remote => name.startsWith(remote + '/')); commitNodes[commitLookup[refData.remotes[i].hash]].remotes.push({ name: name, remote: remote ? remote : null }); } }
    annotate_remotes(&mut commit_nodes, &commit_lookup, &ref_data, &params.remotes);

    // 步骤 13：返回结果
    Ok(AnnotatedCommitGraph {
        commits: commit_nodes,
        head: ref_data.head,
        more_commits_available,
    })
}

/**
 * 获取未提交变更的数量
 *
 * 对应 gitgraph 项目中 `DataSource.getUncommittedChanges()` 的核心逻辑。
 * 执行 `git status -s --untracked-files=all --porcelain -z` 并统计条目数量。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(usize) - 未提交变更的文件数量
 * - Err(GitError) - 查询失败
 */
fn get_uncommitted_changes_count(repo_path: &str) -> Result<usize, GitError> {
    let entries = super::status::get_status_entries(repo_path)?;
    Ok(entries.len())
}

/**
 * 注解 heads（本地分支）
 *
 * 遍历 ref_data.heads，在对应 commit 上添加分支名。
 *
 * 参数：
 * - commit_nodes: 待注解的 commit 列表
 * - commit_lookup: hash -> index 的哈希表
 * - ref_data: 引用数据
 */
fn annotate_heads(
    commit_nodes: &mut [AnnotatedCommit],
    commit_lookup: &std::collections::HashMap<String, usize>,
    ref_data: &RefMap,
) {
    for head in &ref_data.heads {
        if let Some(&index) = commit_lookup.get(&head.hash) {
            commit_nodes[index].heads.push(head.name.clone());
        }
    }
}

/**
 * 注解 tags
 *
 * 遍历 ref_data.tags，在对应 commit 上添加标签注解。
 *
 * 参数：
 * - commit_nodes: 待注解的 commit 列表
 * - commit_lookup: hash -> index 的哈希表
 * - ref_data: 引用数据
 */
fn annotate_tags(
    commit_nodes: &mut [AnnotatedCommit],
    commit_lookup: &std::collections::HashMap<String, usize>,
    ref_data: &RefMap,
) {
    for tag in &ref_data.tags {
        if let Some(&index) = commit_lookup.get(&tag.hash) {
            commit_nodes[index].tags.push(CommitTagAnnotation {
                name: tag.name.clone(),
                annotated: tag.is_annotated,
            });
        }
    }
}

/**
 * 注解 remotes（远程分支）
 *
 * 遍历 ref_data.remotes，在对应 commit 上添加远程分支注解。
 * 同时根据 remote.name 的前缀匹配 params.remotes 中的远程仓库名。
 *
 * 参数：
 * - commit_nodes: 待注解的 commit 列表
 * - commit_lookup: hash -> index 的哈希表
 * - ref_data: 引用数据
 * - remotes: 已知的 remote 名称列表（用于匹配 name 前缀）
 */
fn annotate_remotes(
    commit_nodes: &mut [AnnotatedCommit],
    commit_lookup: &std::collections::HashMap<String, usize>,
    ref_data: &RefMap,
    remotes: &[String],
) {
    for remote in &ref_data.remotes {
        if let Some(&index) = commit_lookup.get(&remote.hash) {
            // 从 remote.name 中解析出 remote 仓库名
            // remote.name 形如 "origin/main"，匹配 remotes 列表中第一个满足
            // name.startsWith(remote + '/') 的 remote
            let matched_remote = remotes
                .iter()
                .find(|r| remote.name.starts_with(&format!("{}/", r)));

            commit_nodes[index].remotes.push(CommitRemoteAnnotation {
                name: remote.name.clone(),
                remote: matched_remote.cloned(),
            });
        }
    }
}

/**
 * 解析 git log --graph 的输出（旧版，保持向后兼容）
 *
 * git log --graph 的实际输出格式（加了 %n 后每行一个提交）：
 * ```
 * * hash|||SEP|||short|||SEP|||parents|||SEP|||author|||SEP|||date|||SEP|||message
 * |
 * * hash|||SEP|||short|||SEP|||parents|||SEP|||author|||SEP|||date|||SEP|||message
 * |\
 * * hash|||SEP|||short|||SEP|||parents|||SEP|||author|||SEP|||date|||SEP|||message
 * ```
 *
 * 图形线（*、|、|\ 等）和提交数据在同一行，用空格分隔。
 * 纯图形线行（如单独的 |、|\）没有 |||SEP||| 分隔符，会被跳过。
 *
 * 解析策略：逐行遍历，对包含 |||SEP||| 的行，
 * 提取行首的图形线部分，然后解析剩余的提交数据字段。
 *
 * 参数：
 * - output: git log --graph 的原始输出
 *
 * 返回值：
 * - Vec<GraphCommit> - 解析后的提交节点列表
 *
 * Task 13.8：GraphCommit 已标记为 deprecated。
 * 此函数仅被已弃用的 get_commit_graph 调用，使用 #[allow(deprecated)] 抑制弃用警告。
 */
#[allow(deprecated)]
fn parse_graph_output(output: &str) -> Vec<GraphCommit> {
    let mut commits: Vec<GraphCommit> = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }

        // 检查是否包含提交数据（有 § 分隔符）
        if !trimmed.contains('§') {
            continue;
        }

        // 找到第一个 § 的位置
        let sep_pos = match trimmed.find('§') {
            Some(pos) => pos,
            None => continue,
        };

        // § 之前的部分包含图形线 + commit hash（如 "* 3a910037..." 或 "| * abc123..."）
        let before_sep = &trimmed[..sep_pos];

        // 提取纯图形字符（如 "* "、"| * "）
        let graph_part = extract_graph_line(before_sep);

        // hash 是图形线之后、§ 之前的部分
        let hash = before_sep[graph_part.len()..].trim();

        // 构建完整的数据字符串：§hash§short_hash§parents§author§date§message
        let data_part = &trimmed[sep_pos..];  // "§short_hash§parents§..."
        let full_data = format!("§{}{}", hash, data_part);  // "§hash§short_hash§parents§..."

        if let Some(commit) = parse_commit_data(&graph_part, &full_data) {
            commits.push(commit);
        }
    }

    commits
}

/**
 * 从 git log 输出行中提取图形线部分（旧版，保持向后兼容）
 *
 * git log --graph 的每一行输出由两部分组成：
 * 1. 左边的 ASCII 图形线（由 *, |, \\, /, -, 空格组成）
 * 2. 右边的提交数据（commit hash、消息等）
 *
 * 详见旧版 graph.rs 的文档注释。
 */
fn extract_graph_line(prefix: &str) -> String {
    let bytes = prefix.as_bytes();
    let mut end = 0;

    for (i, &b) in bytes.iter().enumerate() {
        if b == b'*' || b == b'|' || b == b'\\' || b == b'/' || b == b'-' || b == b' ' {
            end = i + 1;
        } else {
            break;
        }
    }

    prefix[..end].to_string()
}

/**
 * 解析提交数据字段（旧版，保持向后兼容）
 *
 * Task 13.8：GraphCommit 已标记为 deprecated。
 * 此函数仅被已弃用的 get_commit_graph 调用，使用 #[allow(deprecated)] 抑制弃用警告。
 */
#[allow(deprecated)]
fn parse_commit_data(graph_line: &str, data: &str) -> Option<GraphCommit> {
    // 去掉开头的 § 分隔符
    let data = data.strip_prefix('§')?;

    // 用 § 分割字段
    let mut parts = data.splitn(6, '§');

    let hash = parts.next()?.trim().to_string();
    let short_hash = parts.next()?.trim().to_string();
    let parents_str = parts.next()?.trim();
    let author = parts.next()?.trim().to_string();
    let date = parts.next()?.trim().to_string();
    let message = parts.next().unwrap_or("").trim().to_string();

    // 解析父提交列表（空格分隔）
    let parents: Vec<String> = if parents_str.is_empty() {
        Vec::new()
    } else {
        parents_str.split_whitespace().map(|s| s.to_string()).collect()
    };

    Some(GraphCommit {
        graph_line: graph_line.to_string(),
        hash,
        short_hash,
        parents,
        author,
        date,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_graph_output_single_commit() {
        // 模拟 git log --graph 的实际输出（1 个提交，§ 分隔符）
        let output = "* 3e10d417fc4b2c4be966918daaddb803d6fd09e3§3e10d41§§sakamichi§2026-07-05T07:28:13+08:00§初始化\n";

        let commits = parse_graph_output(output);

        assert_eq!(commits.len(), 1, "应该解析出 1 个提交");
        assert_eq!(commits[0].short_hash, "3e10d41");
        assert_eq!(commits[0].message, "初始化");
        assert_eq!(commits[0].author, "sakamichi");
        assert_eq!(commits[0].graph_line, "* ");
        assert!(commits[0].parents.is_empty(), "初始提交应该没有父提交");
    }

    #[test]
    fn test_parse_graph_output_multiple_commits() {
        // 模拟多个提交的输出（§ 分隔符）
        let output = "* 3a9100371e728a0db53caea3d2f898461c951bd0§3a91003§53f6c4a57fd580ca6cc2b61aaa3ebd724342e3e8§sakamichi§2026-07-05T08:43:31+08:00§feat: 新增分支创建功能\n|\n* 53f6c4a57fd580ca6cc2b61aaa3ebd724342e3e8§53f6c4a§a3e22a67f090fe3f309ad816f2500d0141121355§sakamichi§2026-07-05T06:30:07+08:00§feat: 实现提交按钮状态更新\n";

        let commits = parse_graph_output(output);

        assert_eq!(commits.len(), 2, "应该解析出 2 个提交");
        assert_eq!(commits[0].short_hash, "3a91003");
        assert_eq!(commits[1].short_hash, "53f6c4a");
    }

    #[test]
    fn test_extract_graph_line() {
        assert_eq!(extract_graph_line("* "), "* ");
        assert_eq!(extract_graph_line("| * "), "| * ");
        assert_eq!(extract_graph_line("|\\ "), "|\\ ");
        assert_eq!(extract_graph_line("* 3e10d41"), "* ");
    }

    #[test]
    fn test_uncommitted_constant() {
        // UNCOMMITTED 常量应为 "*"
        assert_eq!(UNCOMMITTED, "*");
    }

    #[test]
    fn test_graph_query_params_default() {
        let params = GraphQueryParams::default();
        assert_eq!(params.max_commits, 100);
        assert!(params.show_tags);
        assert!(params.show_uncommitted_changes);
        assert!(!params.show_remote_branches);
        assert_eq!(params.ordering, CommitOrdering::Default);
    }

    #[test]
    fn test_annotate_heads() {
        use super::super::refs::{RefHead, RefMap};

        let mut nodes = vec![
            AnnotatedCommit {
                hash: "abc123".to_string(),
                parents: vec![],
                author: "张三".to_string(),
                email: "zhangsan@example.com".to_string(),
                date: 1700000000,
                message: "测试提交".to_string(),
                heads: Vec::new(),
                tags: Vec::new(),
                remotes: Vec::new(),
                stash: None,
            },
            AnnotatedCommit {
                hash: "def456".to_string(),
                parents: vec!["abc123".to_string()],
                author: "李四".to_string(),
                email: "lisi@example.com".to_string(),
                date: 1700000001,
                message: "第二个提交".to_string(),
                heads: Vec::new(),
                tags: Vec::new(),
                remotes: Vec::new(),
                stash: None,
            },
        ];

        let mut lookup = std::collections::HashMap::new();
        lookup.insert("abc123".to_string(), 0);
        lookup.insert("def456".to_string(), 1);

        let ref_data = RefMap {
            heads: vec![
                RefHead {
                    name: "main".to_string(),
                    hash: "def456".to_string(),
                },
                RefHead {
                    name: "feature/x".to_string(),
                    hash: "abc123".to_string(),
                },
            ],
            tags: vec![],
            remotes: vec![],
            head: Some("def456".to_string()),
        };

        annotate_heads(&mut nodes, &lookup, &ref_data);

        assert_eq!(nodes[0].heads, vec!["feature/x"]);
        assert_eq!(nodes[1].heads, vec!["main"]);
    }
}
