/*
 * Git 标签管理操作模块
 * 
 * 此模块提供 Git 仓库的标签管理功能：
 * 1. 获取标签列表（list_tags）- 列出所有标签及其详细信息
 * 2. 创建标签（create_tag）- 创建轻量标签或附注标签
 * 3. 删除标签（delete_tag）- 删除指定标签
 * 4. 切换标签（checkout_tag）- 切换到标签对应的提交（detached HEAD 模式）
 * 
 * 标签类型说明：
 * - 轻量标签（lightweight）：只是一个指向特定提交的引用，不包含额外信息
 * - 附注标签（annotated）：包含标签者信息、日期、消息等元数据，是完整的 Git 对象
 * 
 * 所有函数都通过 crate::git::commands::run_git 执行底层 git 命令。
 */

use super::commands::{run_git, GitError};

/// 标签信息结构体
/// 
/// 存储一个 Git 标签的所有基本信息，包含标签名称、对应的提交哈希、
/// 标签类型（轻量/附注）以及标签消息（仅附注标签有值）。
/// 此结构体可序列化为 JSON，方便传递给前端展示。
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct TagInfo {
    /// 标签名称（例如 "v1.0.0"）
    pub name: String,
    /// 标签对应的提交哈希值（完整的 40 位 SHA-1 哈希）
    pub commit: String,
    /// 是否是附注标签（true = 附注标签，false = 轻量标签）
    pub is_annotated: bool,
    /// 标签消息（仅附注标签有值，轻量标签为 None）
    pub message: Option<String>,
}

/**
 * 获取仓库的所有标签列表
 * 
 * 此函数会执行以下操作：
 * 1. 执行 `git tag -l` 获取所有标签名称
 * 2. 对每个标签执行 `git log -1 --format=%H <tag>` 获取对应的提交哈希
 * 3. 对每个标签执行 `git cat-file -t <tag>` 判断标签类型
 *    - 返回 "tag" 表示附注标签（annotated tag）
 *    - 返回 "commit" 表示轻量标签（lightweight tag）
 * 4. 对附注标签执行 `git tag -l --format=%(contents) <tag>` 获取标签消息
 * 
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * 
 * 返回值：
 * - Ok(Vec<TagInfo>) - 成功返回标签信息列表（可能为空）
 * - Err(GitError) - 执行失败时返回错误信息
 */
pub fn list_tags(repo_path: &str) -> Result<Vec<TagInfo>, GitError> {
    // 第一步：执行 git tag -l 获取所有标签名称
    // git tag -l 会列出仓库中的所有标签，每行一个标签名
    let output = run_git(repo_path, &["tag", "-l"])?;

    // 如果输出为空，说明仓库中没有任何标签，直接返回空列表
    if output.stdout.trim().is_empty() {
        return Ok(Vec::new());
    }

    // 将输出按行分割，得到标签名称列表
    // .lines() 会自动处理不同操作系统的换行符（\n 或 \r\n）
    let tag_names: Vec<&str> = output.stdout.lines().collect();

    // 用于存储最终的标签信息列表
    let mut tags: Vec<TagInfo> = Vec::new();

    // 第二步：遍历每个标签，获取其详细信息
    for tag_name in &tag_names {
        // 跳过空行（防止输出末尾的多余换行产生空标签名）
        let name = tag_name.trim();
        if name.is_empty() {
            continue;
        }

        // 获取标签对应的提交哈希
        // git log -1 --format=%H <tag> 输出标签指向的提交的完整哈希值
        let log_output = run_git(repo_path, &["log", "-1", "--format=%H", name])?;
        let commit_hash = log_output.stdout.trim().to_string();

        // 判断标签类型
        // git cat-file -t <tag> 会输出对象的类型：
        // - "tag" 表示这是一个附注标签（annotated tag），它是一个独立的 Git 对象
        // - "commit" 表示这是一个轻量标签（lightweight tag），它直接指向提交对象
        let type_output = run_git(repo_path, &["cat-file", "-t", name])?;
        let object_type = type_output.stdout.trim();
        let is_annotated = object_type == "tag";

        // 如果是附注标签，获取标签消息内容
        // git tag -l --format=%(contents) <tag> 输出标签的消息部分
        // 轻量标签没有消息，所以 message 设为 None
        let message = if is_annotated {
            let msg_output = run_git(repo_path, &["tag", "-l", "--format=%(contents)", name])?;
            let msg = msg_output.stdout.trim().to_string();
            if msg.is_empty() {
                None
            } else {
                Some(msg)
            }
        } else {
            None
        };

        // 将当前标签的信息添加到列表中
        tags.push(TagInfo {
            name: name.to_string(),
            commit: commit_hash,
            is_annotated,
            message,
        });
    }

    // 返回所有标签的信息列表
    Ok(tags)
}

/**
 * 创建新的 Git 标签
 * 
 * 支持创建两种类型的标签：
 * - 轻量标签（lightweight）：执行 `git tag <tag_name> <commit>`
 *   轻量标签只是一个简单的引用指针，不包含额外信息
 * - 附注标签（annotated）：执行 `git tag -a <tag_name> <commit> -m "<message>"`
 *   附注标签是完整的 Git 对象，包含标签者、日期、消息等元数据
 * 
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - tag_name: 要创建的标签名称（例如 "v1.0.0"）
 * - commit: 标签要指向的提交哈希值
 * - mode: 标签模式，"lightweight" 表示轻量标签，"annotated" 表示附注标签
 * - message: 附注标签的消息内容（轻量标签时可为 None）
 * 
 * 返回值：
 * - Ok(()) - 创建成功
 * - Err(GitError) - 创建失败（例如标签名已存在、提交哈希无效等）
 */
pub fn create_tag(
    repo_path: &str,
    tag_name: &str,
    commit: &str,
    mode: &str,
    message: Option<&str>,
) -> Result<(), GitError> {
    // 验证标签名称不为空
    if tag_name.trim().is_empty() {
        return Err(GitError::InvalidPath("标签名称不能为空".to_string()));
    }

    // 验证提交哈希不为空
    if commit.trim().is_empty() {
        return Err(GitError::InvalidPath("提交哈希不能为空".to_string()));
    }

    // 根据模式选择不同的创建方式
    if mode == "annotated" {
        // 创建附注标签
        // 附注标签必须有消息内容，如果没有提供则返回错误
        let tag_message = message.unwrap_or("");
        if tag_message.is_empty() {
            return Err(GitError::InvalidPath(
                "附注标签必须提供标签消息".to_string(),
            ));
        }

        // 执行 git tag -a <tag_name> <commit> -m "<message>"
        // -a 表示创建附注标签（annotated）
        // -m 指定标签消息内容
        run_git(
            repo_path,
            &["tag", "-a", tag_name, commit, "-m", tag_message],
        )?;
    } else {
        // 创建轻量标签（默认模式）
        // 轻量标签不需要 -a 和 -m 参数
        // 执行 git tag <tag_name> <commit>
        run_git(repo_path, &["tag", tag_name, commit])?;
    }

    Ok(())
}

/**
 * 删除指定的 Git 标签
 * 
 * 执行 `git tag -d <tag_name>` 命令来删除本地标签。
 * 注意：此操作只删除本地标签，不会影响远程仓库中的标签。
 * 如果需要删除远程标签，需要额外执行 `git push origin :refs/tags/<tag_name>`。
 * 
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - tag_name: 要删除的标签名称
 * 
 * 返回值：
 * - Ok(()) - 删除成功
 * - Err(GitError) - 删除失败（例如标签不存在等）
 */
pub fn delete_tag(repo_path: &str, tag_name: &str) -> Result<(), GitError> {
    // 验证标签名称不为空
    if tag_name.trim().is_empty() {
        return Err(GitError::InvalidPath("标签名称不能为空".to_string()));
    }

    // 执行 git tag -d <tag_name> 删除标签
    // -d 参数表示删除（delete）指定的标签
    run_git(repo_path, &["tag", "-d", tag_name])?;

    Ok(())
}

/**
 * 切换到指定标签（detached HEAD 模式）
 * 
 * 执行 `git checkout <tag_name>` 命令，将工作区切换到标签对应的提交。
 * 切换后 HEAD 会进入 detached（分离）状态，因为标签不是分支，
 * 在此状态下的提交不会被任何分支引用。
 * 
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - tag_name: 要切换到的标签名称
 * 
 * 返回值：
 * - Ok(()) - 切换成功
 * - Err(GitError) - 切换失败（例如标签不存在、工作区有未提交的变更等）
 * 
 * 注意：
 * - 切换前请确保工作区没有未提交的变更，否则可能导致切换失败
 * - 在 detached HEAD 状态下做的提交需要手动创建分支来保存
 */
pub fn checkout_tag(repo_path: &str, tag_name: &str) -> Result<(), GitError> {
    // 验证标签名称不为空
    if tag_name.trim().is_empty() {
        return Err(GitError::InvalidPath("标签名称不能为空".to_string()));
    }

    // 执行 git checkout <tag_name>
    // 这会将工作区切换到标签指向的提交，进入 detached HEAD 状态
    run_git(repo_path, &["checkout", tag_name])?;

    Ok(())
}
