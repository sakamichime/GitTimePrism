/*
 * Git 引用（refs）查询模块
 *
 * 此模块负责获取 Git 仓库中的所有引用（refs）信息：
 * - 本地分支（refs/heads/ 下的所有引用）
 * - 标签（refs/tags/ 下的所有引用，包括 lightweight 和 annotated）
 * - 远程分支（refs/remotes/ 下的所有引用）
 * - HEAD 引用
 *
 * 通过执行 `git show-ref -d --head` 命令获取所有引用信息，
 * 并解析其输出为结构化的 RefMap 数据。
 *
 * 与 gitgraph 项目对齐：
 * - 严格遵循 `dataSource.ts` 中 `getRefs()` 的实现逻辑
 * - 支持 annotated 标签的 `^{}` 后缀解析
 * - 支持隐藏特定 remote 的引用
 * - 支持过滤 remote HEAD 引用
 *
 * git show-ref -d --head 输出格式说明：
 *   <hash> <ref-name>
 * 每行一个引用，hash 和 ref-name 用空格分隔。
 *
 * 输出示例：
 *   a1b2c3d4e5f6... HEAD
 *   a1b2c3d4e5f6... refs/heads/main
 *   a1b2c3d4e5f6... refs/heads/feature/login
 *   e5f6a1b2c3d4... refs/tags/v1.0
 *   e5f6a1b2c3d4... refs/tags/v1.0^{}   <- annotated 标签指向的实际 commit
 *   f6a1b2c3d4e5... refs/remotes/origin/main
 *   f6a1b2c3d4e5... refs/remotes/origin/HEAD
 *
 * -d 选项的作用：对 annotated 标签，额外输出一行带 `^{}` 后缀的记录，
 *   指向该标签解引用后的实际 commit hash
 * --head 选项的作用：在输出中包含 HEAD 引用
 */

use super::commands::{run_git, GitError};

/**
 * 单个本地分支（head）引用的信息
 *
 * 包含分支名和所指向的 commit hash。
 * 注意：这里的 "head" 指的是 `refs/heads/` 下的本地分支，
 * 与 Git 内部的 HEAD 引用不同（HEAD 是当前检出的分支指针）。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefHead {
    /// 分支名（已去除 `refs/heads/` 前缀）
    /// 例如 "main"、"feature/login"
    pub name: String,
    /// 该分支所指向的 commit 的完整哈希值（40 位十六进制）
    pub hash: String,
}

/**
 * 单个标签（tag）引用的信息
 *
 * 包含标签名、所指向的 commit hash 以及标签类型（annotated 或 lightweight）。
 *
 * 两种标签的区别：
 * - lightweight（轻量标签）：只是一个指向 commit 的引用，没有额外元数据
 * - annotated（附注标签）：是一个独立的 Git 对象，包含标签创建者、日期、消息、签名等
 *   annotated 标签通过 `git tag -a` 创建，自身有一个 hash，需要通过 `^{}` 解引用
 *   才能获取到它指向的实际 commit hash
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）：
 * - is_annotated -> isAnnotated
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefTag {
    /// 标签名（已去除 `refs/tags/` 前缀和 `^{}` 后缀）
    /// 例如 "v1.0.0"、"release-2024-01"
    pub name: String,
    /// 标签所指向的 commit 的完整哈希值（40 位十六进制）
    /// 对于 annotated 标签，这是解引用 `^{}` 后的实际 commit hash
    /// 对于 lightweight 标签，直接就是该 ref 的 hash
    pub hash: String,
    /// 是否是 annotated（附注）标签
    /// true = annotated 标签（带元数据，通过 `^{}` 解引用）
    /// false = lightweight 标签（仅是一个指向 commit 的指针）
    pub is_annotated: bool,
}

/**
 * 单个远程分支（remote）引用的信息
 *
 * 包含远程分支名和所指向的 commit hash。
 * 远程分支位于 `refs/remotes/<remote>/<branch>` 下，
 * 例如 `refs/remotes/origin/main` 对应远程 `origin` 的 `main` 分支。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefRemote {
    /// 远程分支名（已去除 `refs/remotes/` 前缀）
    /// 例如 "origin/main"、"origin/feature/login"
    pub name: String,
    /// 该远程分支所指向的 commit 的完整哈希值（40 位十六进制）
    pub hash: String,
}

/**
 * Git 仓库中所有引用的集合
 *
 * 此结构体是 `get_refs()` 的返回值，包含四类引用：
 * - heads: 所有本地分支
 * - tags: 所有标签（含 annotated 和 lightweight）
 * - remotes: 所有远程分支（已过滤掉隐藏的 remote）
 * - head: HEAD 引用所指向的 commit hash（如果有）
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 *
 * 前端使用示例：
 * ```javascript
 * const refs = await invoke('get_refs', { repoPath: '/path/to/repo' });
 * // 获取所有本地分支名
 * const branchNames = refs.heads.map(h => h.name);
 * // 获取 HEAD 指向的 commit
 * const headCommit = refs.head; // 例如 "a1b2c3d4..."
 * ```
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefMap {
    /// 所有本地分支列表（refs/heads/* 下的引用）
    pub heads: Vec<RefHead>,
    /// 所有标签列表（refs/tags/* 下的引用，含 annotated 和 lightweight）
    pub tags: Vec<RefTag>,
    /// 所有远程分支列表（refs/remotes/* 下的引用，已过滤隐藏的 remote）
    pub remotes: Vec<RefRemote>,
    /// HEAD 引用指向的 commit hash
    /// None 表示没有 HEAD 引用（例如空仓库）
    /// Some(hash) 表示 HEAD 指向某个 commit
    pub head: Option<String>,
}

/**
 * 获取 Git 仓库中的所有引用
 *
 * 执行 `git show-ref -d --head` 命令并解析输出，返回结构化的 RefMap。
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getRefs()` 的核心逻辑，
 * 但简化了部分参数（暂不支持 show_remote_branches/show_remote_heads 的细粒度控制，
 * 调用方可通过 hide_remotes 参数隐藏特定 remote 的引用）。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - hide_remotes: 要隐藏的 remote 名称列表
 *                 例如 ["upstream", "internal"] 会隐藏所有
 *                 `refs/remotes/upstream/` 和 `refs/remotes/internal/` 下的引用
 *
 * 返回值：
 * - Ok(RefMap) - 查询成功，包含所有引用信息
 * - Err(GitError) - 查询失败
 *
 * 错误处理说明：
 * - 空仓库或新仓库可能没有引用，此时 `git show-ref` 会返回非零退出码，
 *   但这不应被视为错误。函数会捕获此类错误并返回空的 RefMap。
 */
pub fn get_refs(repo_path: &str, hide_remotes: &[&str]) -> Result<RefMap, GitError> {
    // 构建命令参数
    // - show-ref: 列出仓库中的所有引用
    // - -d: 对 annotated 标签进行解引用（额外输出带 ^{} 后缀的行）
    // - --head: 包含 HEAD 引用
    let args = &["show-ref", "-d", "--head"];

    // 执行命令
    let output = match run_git(repo_path, args) {
        Ok(out) => out,
        Err(GitError::CommandFailed { .. }) => {
            // git show-ref 在空仓库或没有任何 ref 的仓库中会返回非零退出码
            // 此时不视为错误，返回空的 RefMap
            return Ok(RefMap {
                heads: Vec::new(),
                tags: Vec::new(),
                remotes: Vec::new(),
                head: None,
            });
        }
        Err(e) => return Err(e),
    };

    // 解析输出
    Ok(parse_refs_output(&output.stdout, hide_remotes))
}

/**
 * 解析 `git show-ref -d --head` 的输出
 *
 * 输出格式：每行一个引用，格式为 `<hash> <ref-name>`
 * 其中 ref-name 可能是：
 * - "HEAD"（HEAD 引用）
 * - "refs/heads/<branch>"（本地分支）
 * - "refs/tags/<tag>"（lightweight 标签）
 * - "refs/tags/<tag>^{}"（annotated 标签解引用后的实际 commit）
 * - "refs/remotes/<remote>/<branch>"（远程分支）
 * - "refs/remotes/<remote>/HEAD"（远程 HEAD 引用）
 *
 * 解析规则：
 * 1. 按行分割输出
 * 2. 对每行，按空格分割为 hash 和 ref-name（注意 ref-name 可能包含空格，但实际不会）
 * 3. 根据 ref-name 的前缀分类：
 *    - "HEAD" -> 设置 head 字段
 *    - "refs/heads/" -> 添加到 heads 列表
 *    - "refs/tags/" -> 添加到 tags 列表（区分 annotated 和 lightweight）
 *    - "refs/remotes/" -> 添加到 remotes 列表（过滤隐藏的 remote）
 *
 * 参数：
 * - output: `git show-ref -d --head` 的原始输出
 * - hide_remotes: 要隐藏的 remote 名称列表
 *
 * 返回值：
 * - RefMap: 解析后的引用集合
 */
fn parse_refs_output(output: &str, hide_remotes: &[&str]) -> RefMap {
    let mut ref_map = RefMap {
        heads: Vec::new(),
        tags: Vec::new(),
        remotes: Vec::new(),
        head: None,
    };

    // 构建要隐藏的 remote 前缀列表
    // 例如 ["upstream", "internal"] -> ["refs/remotes/upstream/", "refs/remotes/internal/"]
    let hide_patterns: Vec<String> = hide_remotes
        .iter()
        .map(|r| format!("refs/remotes/{}/", r))
        .collect();

    // 逐行解析
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 按空格分割为 hash 和 ref-name
        // 格式：<40位hash> <ref-name>
        // 使用 splitn(2, ' ') 确保只分割第一个空格（ref-name 部分不分割）
        let parts: Vec<&str> = line.splitn(2, ' ').collect();
        if parts.len() < 2 {
            continue;
        }

        let hash = parts[0].trim();
        let ref_name = parts[1].trim();

        // 根据 ref-name 的前缀分类处理
        if ref_name == "HEAD" {
            // HEAD 引用：记录所指向的 commit hash
            ref_map.head = Some(hash.to_string());
        } else if let Some(branch_name) = ref_name.strip_prefix("refs/heads/") {
            // 本地分支：去除 "refs/heads/" 前缀得到分支名
            ref_map.heads.push(RefHead {
                name: branch_name.to_string(),
                hash: hash.to_string(),
            });
        } else if let Some(tag_part) = ref_name.strip_prefix("refs/tags/") {
            // 标签：去除 "refs/tags/" 前缀
            // 注意：annotated 标签会有额外的 `^{}` 后缀行
            if let Some(tag_name) = tag_part.strip_suffix("^{}") {
                // 这是一行 annotated 标签解引用后的记录
                // tag_name 是去除 `^{}` 后缀的标签名
                // 此时 hash 是该 annotated 标签指向的实际 commit hash
                // 我们需要更新或添加一个 annotated=true 的 RefTag
                update_or_add_annotated_tag(&mut ref_map.tags, tag_name, hash);
            } else {
                // 这是一行 lightweight 或 annotated 标签自身的记录
                // tag_part 是标签名
                // 对于 lightweight 标签，hash 直接指向 commit
                // 对于 annotated 标签，hash 指向 tag 对象本身（不是 commit）
                // 但后续会有 `^{}` 行提供实际 commit hash
                add_tag_if_not_exists(&mut ref_map.tags, tag_part, hash);
            }
        } else if let Some(remote_name) = ref_name.strip_prefix("refs/remotes/") {
            // 远程分支：去除 "refs/remotes/" 前缀
            // remote_name 形如 "origin/main" 或 "origin/HEAD"

            // 检查是否在隐藏列表中
            let is_hidden = hide_patterns
                .iter()
                .any(|p| ref_name.starts_with(p.as_str()));

            if !is_hidden {
                ref_map.remotes.push(RefRemote {
                    name: remote_name.to_string(),
                    hash: hash.to_string(),
                });
            }
        }
        // 其他类型的引用（如 refs/stash、refs/notes/* 等）暂不处理
    }

    ref_map
}

/**
 * 添加一个标签到 tags 列表（如果不存在）
 *
 * 此函数用于处理 `refs/tags/<name>` 的初始记录。
 * 此时还无法确定是 lightweight 还是 annotated 标签：
 * - lightweight 标签：只有这一行记录，hash 直接指向 commit
 * - annotated 标签：除了这一行，还会有 `refs/tags/<name>^{}` 行
 *   前者的 hash 指向 tag 对象，后者的 hash 指向实际 commit
 *
 * 因此初始添加时，默认 is_annotated=false。
 * 如果后续遇到 `^{}` 行，会通过 `update_or_add_annotated_tag` 更新。
 *
 * 参数：
 * - tags: 标签列表
 * - name: 标签名（已去除 `refs/tags/` 前缀）
 * - hash: 标签的 hash（对于 annotated 标签是 tag 对象的 hash）
 */
fn add_tag_if_not_exists(tags: &mut Vec<RefTag>, name: &str, hash: &str) {
    // 检查是否已存在同名标签
    let exists = tags.iter().any(|t| t.name == name);
    if !exists {
        tags.push(RefTag {
            name: name.to_string(),
            hash: hash.to_string(),
            // 默认 lightweight，后续遇到 ^{} 行会更新为 annotated
            is_annotated: false,
        });
    }
}

/**
 * 更新或添加一个 annotated 标签
 *
 * 当遇到 `refs/tags/<name>^{}` 行时调用此函数。
 * 此时 hash 是该 annotated 标签解引用后的实际 commit hash。
 *
 * 处理逻辑：
 * 1. 如果 tags 列表中已存在同名标签，更新其 hash 和 is_annotated
 *    （因为之前的 `refs/tags/<name>` 行只是 tag 对象本身的 hash，
 *     现在要用实际 commit hash 替换）
 * 2. 如果不存在，直接添加一个新的 annotated 标签
 *
 * 参数：
 * - tags: 标签列表
 * - name: 标签名（已去除 `refs/tags/` 前缀和 `^{}` 后缀）
 * - hash: 实际 commit hash（解引用后）
 */
fn update_or_add_annotated_tag(tags: &mut Vec<RefTag>, name: &str, hash: &str) {
    // 查找是否已存在同名标签
    if let Some(tag) = tags.iter_mut().find(|t| t.name == name) {
        // 已存在：更新 hash 为实际 commit hash，标记为 annotated
        tag.hash = hash.to_string();
        tag.is_annotated = true;
    } else {
        // 不存在：直接添加为 annotated 标签
        // 这种情况理论上不应该发生（git show-ref -d 会先输出 tag 自身，再输出 ^{} 行）
        // 但为了健壮性，仍然处理这种情况
        tags.push(RefTag {
            name: name.to_string(),
            hash: hash.to_string(),
            is_annotated: true,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_refs_output_basic() {
        // 模拟 git show-ref -d --head 的输出
        let output = "a1b2c3d4e5f6789012345678901234567890abcd HEAD\n\
                      a1b2c3d4e5f6789012345678901234567890abcd refs/heads/main\n\
                      e5f6a1b2c3d4567890123456789012345678abcd refs/tags/v1.0\n\
                      e5f6a1b2c3d4567890123456789012345678abcd refs/tags/v1.0^{}\n\
                      f6a1b2c3d4e567890123456789012345678abcd1 refs/remotes/origin/main\n";

        let ref_map = parse_refs_output(output, &[]);

        // 验证 HEAD
        assert_eq!(ref_map.head, Some("a1b2c3d4e5f6789012345678901234567890abcd".to_string()));

        // 验证 heads
        assert_eq!(ref_map.heads.len(), 1);
        assert_eq!(ref_map.heads[0].name, "main");
        assert_eq!(ref_map.heads[0].hash, "a1b2c3d4e5f6789012345678901234567890abcd");

        // 验证 tags（annotated）
        assert_eq!(ref_map.tags.len(), 1);
        assert_eq!(ref_map.tags[0].name, "v1.0");
        assert_eq!(ref_map.tags[0].hash, "e5f6a1b2c3d4567890123456789012345678abcd");
        assert!(ref_map.tags[0].is_annotated);

        // 验证 remotes
        assert_eq!(ref_map.remotes.len(), 1);
        assert_eq!(ref_map.remotes[0].name, "origin/main");
    }

    #[test]
    fn test_parse_refs_output_hide_remotes() {
        let output = "a1b2c3d4e5f6789012345678901234567890abcd HEAD\n\
                      a1b2c3d4e5f6789012345678901234567890abcd refs/heads/main\n\
                      f6a1b2c3d4e567890123456789012345678abcd1 refs/remotes/origin/main\n\
                      f6a1b2c3d4e567890123456789012345678abcd2 refs/remotes/upstream/main\n";

        // 隐藏 upstream remote
        let ref_map = parse_refs_output(output, &["upstream"]);

        // upstream/main 应该被过滤掉
        assert_eq!(ref_map.remotes.len(), 1);
        assert_eq!(ref_map.remotes[0].name, "origin/main");
    }

    #[test]
    fn test_parse_refs_output_lightweight_tag() {
        // lightweight 标签：没有 `^{}` 行
        let output = "a1b2c3d4e5f6789012345678901234567890abcd HEAD\n\
                      e5f6a1b2c3d4567890123456789012345678abcd refs/tags/v1.0\n";

        let ref_map = parse_refs_output(output, &[]);

        assert_eq!(ref_map.tags.len(), 1);
        assert_eq!(ref_map.tags[0].name, "v1.0");
        assert_eq!(ref_map.tags[0].hash, "e5f6a1b2c3d4567890123456789012345678abcd");
        assert!(!ref_map.tags[0].is_annotated);
    }
}
