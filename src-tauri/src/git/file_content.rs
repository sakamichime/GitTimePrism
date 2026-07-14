/*
 * Git 文件内容获取模块
 * 
 * 此模块负责获取文件在不同版本中的完整内容：
 * 1. 工作树版本 - 当前工作目录中的文件内容
 * 2. 暂存区版本 - 已暂存但未提交的文件内容
 * 3. HEAD 版本 - 最后一次提交中的文件内容
 * 4. 指定提交版本 - 任意提交中的文件内容
 * 
 * 用于左右分栏对比视图，显示文件在不同阶段的完整内容。
 */

use super::commands::{run_git, run_git_raw, GitError};
use std::fs;
use std::path::Path;

/**
 * 将原始字节数组按指定编码解码为字符串
 *
 * 支持的编码包括：
 * - utf8（默认）：UTF-8 编码
 * - gbk：简体中文 GBK 编码
 * - big5：繁体中文 Big5 编码
 * - shift_jis：日文 Shift-JIS 编码
 * - iso_8859_1：西欧语言 ISO-8859-1 编码（Latin-1）
 * - windows_1252：Windows 西欧编码
 *
 * 解码策略：
 * - 对于 UTF-8 编码，使用无损解码（invalid bytes 替换为 U+FFFD）
 * - 对于其他编码，使用 encoding_rs 的 decode 函数（自动处理 BOM 和无效字节）
 * - 未知编码名默认回退到 UTF-8
 *
 * 参数：
 * - bytes: 原始字节数组
 * - encoding: 编码名称（如 "utf8"、"gbk"）
 *
 * 返回值：
 * - String: 解码后的字符串
 */
pub fn decode_bytes(bytes: &[u8], encoding: &str) -> String {
    // 根据编码名称选择对应的 encoding_rs 解码器
    // encoding_rs 提供的 decode 函数返回 (String, &Encoding)，
    // 其中 String 是解码结果，第二个返回值是实际使用的编码（可能与请求的不同，如检测到 BOM 时）
    let (decoded, _used_encoding, _had_errors) = match encoding.to_lowercase().as_str() {
        // UTF-8 编码（默认）
        "utf8" | "utf-8" | "utf_8" => encoding_rs::UTF_8.decode(bytes),
        // 简体中文 GBK 编码（含 GB2312）
        "gbk" | "gb2312" | "gb_2312" => encoding_rs::GBK.decode(bytes),
        // 繁体中文 Big5 编码
        "big5" => encoding_rs::BIG5.decode(bytes),
        // 日文 Shift-JIS 编码
        "shift_jis" | "shiftjis" | "shift-jis" | "sjis" => encoding_rs::SHIFT_JIS.decode(bytes),
        // 西欧语言 ISO-8859-1 编码（Latin-1）
        // 注意：encoding_rs 中 ISO-8859-1 不作为独立编码存在，
        // Encoding Standard 将其视为与 windows-1252 相同，
        // 因此使用 WINDOWS_1252 作为替代（windows-1252 是 ISO-8859-1 的超集）
        "iso_8859_1" | "iso-8859-1" | "iso8859_1" | "latin1" | "latin-1" => {
            encoding_rs::WINDOWS_1252.decode(bytes)
        }
        // Windows 西欧编码（Windows-1252）
        "windows_1252" | "windows-1252" | "cp1252" => encoding_rs::WINDOWS_1252.decode(bytes),
        // 韩文 EUC-KR 编码
        "euc_kr" | "euc-kr" | "korean" => encoding_rs::EUC_KR.decode(bytes),
        // 未知编码默认回退到 UTF-8（避免 panic）
        _ => encoding_rs::UTF_8.decode(bytes),
    };
    decoded.into_owned()
}

/**
 * 获取支持的文件编码列表
 *
 * 返回前端可选择的编码名称列表，用于设置面板的文件编码下拉选择。
 * 列表顺序按常见程度排列（UTF-8 在最前）。
 *
 * 返回值：
 * - Vec<String>: 支持的编码名称列表
 */
pub fn get_supported_encodings() -> Vec<String> {
    vec![
        "utf8".to_string(),
        "gbk".to_string(),
        "big5".to_string(),
        "shift_jis".to_string(),
        "iso_8859_1".to_string(),
        "windows_1252".to_string(),
        "euc_kr".to_string(),
    ]
}

/**
 * 获取工作树中文件的完整内容
 *
 * 直接读取工作目录中的文件，按 UTF-8 编码解码。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 *
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_worktree_file_content(repo_path: &str, file_path: &str) -> Result<String, GitError> {
    let full_path = Path::new(repo_path).join(file_path);

    if !full_path.exists() {
        return Err(GitError::Io(format!(
            "文件不存在: {}",
            full_path.display()
        )));
    }

    // 读取文件为字节数组，然后用 UTF-8 解码
    // 使用 read 而非 read_to_string，以便后续支持自定义编码
    let bytes = fs::read(&full_path).map_err(|e| {
        GitError::Io(format!(
            "读取文件失败 {}: {}",
            full_path.display(),
            e
        ))
    })?;

    Ok(decode_bytes(&bytes, "utf8"))
}

/**
 * 获取工作树中文件的完整内容（按指定编码解码）
 *
 * 直接读取工作目录中的文件，按指定的编码解码。
 * 用于读取非 UTF-8 编码的文件（如 GBK 编码的中文源代码）。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * - encoding: 编码名称（如 "utf8"、"gbk"、"big5"）
 *
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_worktree_file_content_with_encoding(
    repo_path: &str,
    file_path: &str,
    encoding: &str,
) -> Result<String, GitError> {
    let full_path = Path::new(repo_path).join(file_path);

    if !full_path.exists() {
        return Err(GitError::Io(format!(
            "文件不存在: {}",
            full_path.display()
        )));
    }

    // 读取文件为字节数组
    let bytes = fs::read(&full_path).map_err(|e| {
        GitError::Io(format!(
            "读取文件失败 {}: {}",
            full_path.display(),
            e
        ))
    })?;

    // 按指定编码解码
    Ok(decode_bytes(&bytes, encoding))
}

/**
 * 获取暂存区中文件的完整内容
 * 
 * 使用 `git show :file_path` 获取暂存区中的文件内容。
 * `:` 表示暂存区（index）。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_staged_file_content(repo_path: &str, file_path: &str) -> Result<String, GitError> {
    let ref_spec = format!(":{}", file_path);
    let output = run_git(repo_path, &["show", &ref_spec])?;
    Ok(output.stdout)
}

/**
 * 获取暂存区中文件的完整内容（按指定编码解码）
 *
 * 使用 `git show :file_path` 获取暂存区中的文件原始字节，
 * 然后按指定编码解码为字符串。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * - encoding: 编码名称（如 "utf8"、"gbk"）
 *
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_staged_file_content_with_encoding(
    repo_path: &str,
    file_path: &str,
    encoding: &str,
) -> Result<String, GitError> {
    let ref_spec = format!(":{}", file_path);
    // 使用 run_git_raw 获取原始字节，避免 UTF-8 解码丢失非 UTF-8 文件内容
    let bytes = run_git_raw(repo_path, &["show", &ref_spec])?;
    Ok(decode_bytes(&bytes, encoding))
}

/**
 * 获取 HEAD 提交中文件的完整内容
 * 
 * 使用 `git show HEAD:file_path` 获取 HEAD 提交中的文件内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_head_file_content(repo_path: &str, file_path: &str) -> Result<String, GitError> {
    let ref_spec = format!("HEAD:{}", file_path);
    let output = run_git(repo_path, &["show", &ref_spec])?;
    Ok(output.stdout)
}

/**
 * 获取 HEAD 提交中文件的完整内容（按指定编码解码）
 *
 * 使用 `git show HEAD:file_path` 获取 HEAD 提交中的文件原始字节，
 * 然后按指定编码解码为字符串。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * - encoding: 编码名称（如 "utf8"、"gbk"）
 *
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_head_file_content_with_encoding(
    repo_path: &str,
    file_path: &str,
    encoding: &str,
) -> Result<String, GitError> {
    let ref_spec = format!("HEAD:{}", file_path);
    // 使用 run_git_raw 获取原始字节，避免 UTF-8 解码丢失非 UTF-8 文件内容
    let bytes = run_git_raw(repo_path, &["show", &ref_spec])?;
    Ok(decode_bytes(&bytes, encoding))
}

/**
 * 获取指定提交中文件的完整内容
 *
 * 使用 `git show <commit_hash>:file_path` 获取指定提交中的文件内容。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 提交哈希值
 * - file_path: 文件路径（相对于仓库根目录）
 *
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_file_content_at_commit(repo_path: &str, commit_hash: &str, file_path: &str) -> Result<String, GitError> {
    let ref_spec = format!("{}:{}", commit_hash, file_path);
    let output = run_git(repo_path, &["show", &ref_spec])?;
    Ok(output.stdout)
}

/**
 * 获取指定提交中文件的完整内容（按指定编码解码）
 *
 * 使用 `git show <commit_hash>:file_path` 获取指定提交中的文件原始字节，
 * 然后按指定编码解码为字符串。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 提交哈希值
 * - file_path: 文件路径（相对于仓库根目录）
 * - encoding: 编码名称（如 "utf8"、"gbk"）
 *
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_file_content_at_commit_with_encoding(
    repo_path: &str,
    commit_hash: &str,
    file_path: &str,
    encoding: &str,
) -> Result<String, GitError> {
    let ref_spec = format!("{}:{}", commit_hash, file_path);
    // 使用 run_git_raw 获取原始字节，避免 UTF-8 解码丢失非 UTF-8 文件内容
    let bytes = run_git_raw(repo_path, &["show", &ref_spec])?;
    Ok(decode_bytes(&bytes, encoding))
}

/**
 * 将内容写入工作树中的文件
 *
 * 直接写入工作目录中的文件，覆盖原有内容。
 * 用于合并编辑器（Task 8.2）在用户解决冲突后将合并结果写回文件。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * - content: 要写入的文件内容
 *
 * 返回值：
 * - Ok(()) - 写入成功
 * - Err(GitError) - 写入失败（文件不存在、权限不足等）
 */
pub fn write_file_content(repo_path: &str, file_path: &str, content: &str) -> Result<(), GitError> {
    // 验证文件路径不为空
    if file_path.trim().is_empty() {
        return Err(GitError::InvalidPath("文件路径不能为空".to_string()));
    }

    // 拼接完整路径
    let full_path = Path::new(repo_path).join(file_path);

    // 检查父目录是否存在（不存在则创建，确保写文件不会失败）
    if let Some(parent) = full_path.parent() {
        if !parent.exists() {
            // 创建所有缺失的父目录
            fs::create_dir_all(parent).map_err(|e| {
                GitError::Io(format!(
                    "创建父目录失败 {}: {}",
                    parent.display(),
                    e
                ))
            })?;
        }
    }

    // 写入文件内容（覆盖原有内容）
    fs::write(&full_path, content).map_err(|e| {
        GitError::Io(format!(
            "写入文件失败 {}: {}",
            full_path.display(),
            e
        ))
    })
}
