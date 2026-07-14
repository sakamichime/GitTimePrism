/*
 * Git 标签详情查询模块
 *
 * 此模块负责获取单个 Git 标签的完整详情，包括：
 * - 标签类型（annotated 附注标签 / lightweight 轻量标签）
 * - 标签指向的对象哈希
 * - 附注标签的标签者信息（名字、邮箱、日期）
 * - 标签消息
 * - GPG 签名信息（签名状态、签名者、密钥 ID）
 *
 * 实现方式：
 * 1. 执行 `git for-each-ref refs/tags/{tag}` 获取标签的基础信息
 *    （objectname、taggername、taggeremail、taggerdate、contents:signature、contents）
 * 2. 执行 `git verify-tag --raw {tag}` 解析 [GNUPG:] 行获取签名详情
 * 3. 映射 TRUST_ 级别到 SignatureStatus 枚举
 *
 * 复用 commit_details.rs 中的 CommitSignature 和 SignatureStatus 结构体，
 * 保持与提交签名信息的一致性。
 */

use super::commands::{run_git, GitError, GIT_LOG_SEPARATOR};
// 复用 commit_details 模块中的 CommitSignature 和 SignatureStatus 结构体
// 这样标签和提交的签名信息使用相同的类型，便于前端统一处理
use super::commit_details::{CommitSignature, SignatureStatus};

/**
 * 单个 Git 标签的完整详情
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitTagDetails` 接口。
 * 包含标签的基础信息和 GPG 签名信息。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagDetails {
    /// 标签名称（如 "v1.0.0"）
    pub name: String,
    /// 标签类型："annotated" = 附注标签（含标签者信息），"lightweight" = 轻量标签（仅指针）
    pub r#type: String,
    /// 标签指向的对象哈希（完整 40 位）
    /// - annotated 标签：指向 tag 对象本身，tag 对象再指向 commit
    /// - lightweight 标签：直接指向 commit
    pub object: String,
    /// 附注标签的标签者名字（lightweight 标签为空字符串）
    pub tagger_name: String,
    /// 附注标签的标签者邮箱（lightweight 标签为空字符串）
    pub tagger_email: String,
    /// 附注标签的标签日期（Unix 时间戳，单位：秒；lightweight 标签为 0）
    pub tagger_date: i64,
    /// 标签消息（annotated 标签的消息内容；lightweight 标签为空字符串）
    pub message: String,
    /// GPG 签名信息
    /// None = 此标签没有签名
    /// Some(signature) = 此标签有签名，包含签名详情
    pub signature: Option<CommitSignature>,
}

/**
 * 获取单个标签的完整详情
 *
 * 算法步骤：
 * 1. 执行 `git for-each-ref refs/tags/{tag}` 获取标签的基础信息
 * 2. 解析输出，判断标签类型（annotated 还是 lightweight）
 * 3. 如果是 annotated 标签且有签名（contents:signature 非空），
 *    执行 `git verify-tag --raw {tag}` 获取签名详情
 * 4. 解析 [GNUPG:] 行，映射 TRUST_ 级别到 SignatureStatus
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - tag_name: 标签名称（如 "v1.0.0"）
 *
 * 返回值：
 * - Ok(TagDetails) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_tag_details(repo_path: &str, tag_name: &str) -> Result<TagDetails, GitError> {
    // 步骤 1：构建 for-each-ref 命令的 format 字符串
    // 字段说明：
    //   %(objectname) - 标签对象的哈希（annotated 标签是 tag 对象哈希，lightweight 标签是 commit 哈希）
    //   %(objecttype) - 对象类型（"tag" 表示 annotated 标签，"commit" 表示 lightweight 标签）
    //   %(taggername) - 标签者名字（仅 annotated 标签有值）
    //   %(taggeremail) - 标签者邮箱（仅 annotated 标签有值）
    //   %(taggerdate:unix) - 标签日期（Unix 时间戳）
    //   %(contents:signature) - 标签的 GPG 签名内容（无签名时为空）
    //   %(contents) - 标签的完整内容（含消息）
    let format_str = [
        "%(objectname)",
        "%(objecttype)",
        "%(taggername)",
        "%(taggeremail)",
        "%(taggerdate:unix)",
        "%(contents:signature)",
        "%(contents)",
    ]
    .join(GIT_LOG_SEPARATOR);

    // 构建 for-each-ref 命令参数
    let ref_name = format!("refs/tags/{}", tag_name);
    let format_arg = format!("--format={}", format_str);
    // 使用 Vec<&str> 构建参数列表（ref_name 和 format_arg 是 String，需取引用转为 &str）
    let args: Vec<&str> = vec!["for-each-ref", &ref_name, &format_arg];

    let output = run_git(repo_path, &args)?;

    // 步骤 2：解析 for-each-ref 输出
    let mut details = parse_for_each_ref_output(&output.stdout, tag_name)?;

    // 步骤 3：如果有签名内容，执行 verify-tag --raw 获取签名详情
    // details.signature 为 Some 时表示有签名内容（contents:signature 非空），
    // 但实际的签名状态需要通过 verify-tag 命令解析 [GNUPG:] 行获取
    if details.signature.is_some() {
        let signature = get_tag_signature(repo_path, &ref_name);
        details.signature = Some(signature);
    }

    Ok(details)
}

/**
 * 解析 `git for-each-ref` 的输出
 *
 * 输出格式（单行，7 个字段用 GIT_LOG_SEPARATOR 分隔）：
 *   {objectname} § {objecttype} § {taggername} § {taggeremail} § {taggerdate} § {signature} § {contents}
 *
 * 注意：contents 可能包含多行，使用 splitn(7, ...) 确保最后一个字段不被进一步分割。
 *
 * 参数：
 * - output: git for-each-ref 命令的输出
 * - tag_name: 标签名称（用于填充 TagDetails.name 字段）
 *
 * 返回值：
 * - Ok(TagDetails) - 解析成功
 * - Err(GitError) - 解析失败（输出格式不正确）
 */
fn parse_for_each_ref_output(output: &str, tag_name: &str) -> Result<TagDetails, GitError> {
    // 去除首尾空白
    let output = output.trim();

    // 如果输出为空，说明标签不存在
    if output.is_empty() {
        return Err(GitError::CommandFailed {
            exit_code: 0,
            message: format!("标签 '{}' 不存在", tag_name),
        });
    }

    // 使用 GIT_LOG_SEPARATOR 分割为 7 个字段
    // splitn(7, ...) 确保 contents 字段（可能包含分隔符）不被进一步分割
    let parts: Vec<&str> = output.splitn(7, GIT_LOG_SEPARATOR).collect();
    if parts.len() != 7 {
        return Err(GitError::CommandFailed {
            exit_code: 0,
            message: format!(
                "无法解析标签详情输出: 期望 7 个字段，实际 {} 个字段",
                parts.len()
            ),
        });
    }

    // 解析各字段
    let object = parts[0].trim().to_string();
    let object_type = parts[1].trim().to_string();
    let tagger_name = parts[2].trim().to_string();
    // 去除 taggeremail 两端的尖括号（如 "<alice@example.com>" → "alice@example.com"）
    let tagger_email = parts[3]
        .trim()
        .trim_start_matches('<')
        .trim_end_matches('>')
        .to_string();
    // 解析日期（Unix 时间戳），解析失败时默认为 0
    let tagger_date: i64 = parts[4].trim().parse().unwrap_or(0);
    let signature_content = parts[5].trim().to_string();
    let contents = parts[6];

    // 判断标签类型：objecttype 为 "tag" 表示 annotated 标签，否则为 lightweight 标签
    let tag_type = if object_type == "tag" {
        "annotated".to_string()
    } else {
        "lightweight".to_string()
    };

    // 解析标签消息：对于 annotated 标签，contents 包含标签消息
    // 对于 lightweight 标签，contents 通常是 commit 消息，我们留空
    let message = if tag_type == "annotated" {
        remove_trailing_blank_lines(contents)
    } else {
        String::new()
    };

    // 判断是否有签名：signature_content 非空表示有签名内容
    // 实际的签名状态稍后通过 verify-tag --raw 获取
    let signature = if signature_content.is_empty() {
        None
    } else {
        // 临时占位，稍后由 get_tag_signature 填充实际值
        Some(CommitSignature {
            key: String::new(),
            signer: String::new(),
            status: SignatureStatus::CannotBeChecked,
        })
    };

    Ok(TagDetails {
        name: tag_name.to_string(),
        r#type: tag_type,
        object,
        tagger_name,
        tagger_email,
        tagger_date,
        message,
        signature,
    })
}

/**
 * 获取标签的 GPG 签名详情
 *
 * 执行 `git verify-tag --raw {ref}` 命令，解析 [GNUPG:] 行获取签名状态。
 *
 * verify-tag --raw 的输出格式（在 stderr 中）：
 * ```
 * [GNUPG:] GOODSIG <key_id> <signer>
 * [GNUPG:] TRUST_ULTIMATE
 * [GNUPG:] VALIDSIG <fingerprint> ...
 * ```
 *
 * 解析逻辑：
 * 1. 按行分割输出，过滤出以 "[GNUPG:] " 开头的行
 * 2. 每行按空格分割为多个 token
 * 3. 查找状态码（GOODSIG/BADSIG/ERRSIG/EXPSIG/EXPKEYSIG/REVKEYSIG）确定签名状态
 * 4. 查找 TRUST_ 级别（TRUST_UNDEFINED/TRUST_NEVER/TRUST_MARGINAL/TRUST_FULLY/TRUST_ULTIMATE）
 * 5. 如果状态是 GoodAndValid 但 trust 级别是 UNDEFINED 或 NEVER，
 *    则将状态降级为 GoodWithUnknownValidity（与 gitgraph 项目一致）
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - ref_name: 标签的引用名（如 "refs/tags/v1.0.0"）
 *
 * 返回值：
 * - CommitSignature: 签名详情（解析失败时返回 CannotBeChecked 状态）
 */
fn get_tag_signature(repo_path: &str, ref_name: &str) -> CommitSignature {
    // 执行 verify-tag --raw 命令
    // 注意：--raw 选项将 GPG 状态输出到 stderr（而非 stdout）
    // run_git 会捕获 stderr 并存储在 GitOutput.stderr 中
    let verify_result = run_git(repo_path, &["verify-tag", "--raw", ref_name]);

    // 解析失败时返回默认的 CannotBeChecked 状态
    let default_signature = CommitSignature {
        key: String::new(),
        signer: String::new(),
        status: SignatureStatus::CannotBeChecked,
    };

    let output = match verify_result {
        Ok(o) => {
            // verify-tag --raw 的输出在 stderr 中；如果 stderr 为空则尝试 stdout
            if !o.stderr.is_empty() {
                o.stderr
            } else {
                o.stdout
            }
        }
        Err(e) => {
            // verify-tag 对签名错误的标签会返回非零退出码
            // 但 stderr 中仍包含 [GNUPG:] 行，需要解析
            // 此处通过 e.to_string() 获取错误信息中包含的 stderr
            // 注意：GitError::CommandFailed 的 message 字段包含 stderr 内容
            e.to_string()
        }
    };

    parse_gnupg_output(&output).unwrap_or(default_signature)
}

/**
 * 解析 GPG verify-tag --raw 的输出
 *
 * 输出包含若干 [GNUPG:] 行，每行格式为：
 *   [GNUPG:] <status_code> <arg1> <arg2> ...
 *
 * 状态码与签名状态的映射（参考 gitgraph GPG_STATUS_CODE_PARSING_DETAILS）：
 * - GOODSIG → GoodAndValid（签名良好有效，signer 为剩余参数）
 * - BADSIG → Bad（签名错误，signer 为剩余参数）
 * - ERRSIG → CannotBeChecked（无法检查签名，signer 为空）
 * - EXPSIG → GoodButExpired（签名良好但已过期，signer 为剩余参数）
 * - EXPKEYSIG → GoodButMadeByExpiredKey（签名良好但密钥已过期）
 * - REVKEYSIG → GoodButMadeByRevokedKey（签名良好但密钥已吊销）
 *
 * TRUST_ 级别（单独的 [GNUPG:] TRUST_xxx 行）：
 * - TRUST_UNDEFINED：信任级别未定义
 * - TRUST_NEVER：从不信任
 * - TRUST_MARGINAL：边际信任
 * - TRUST_FULLY：完全信任
 * - TRUST_ULTIMATE：终极信任
 *
 * 特殊处理：如果状态是 GoodAndValid 但 trust 级别是 UNDEFINED 或 NEVER，
 * 则将状态降级为 GoodWithUnknownValidity（与 gitgraph 项目一致）。
 *
 * 参数：
 * - output: verify-tag --raw 的原始输出
 *
 * 返回值：
 * - Some(CommitSignature) - 解析出签名信息
 * - None - 无法解析出签名信息
 */
fn parse_gnupg_output(output: &str) -> Option<CommitSignature> {
    let mut signature: Option<CommitSignature> = None;
    let mut trust_level: Option<String> = None;

    // 按行处理输出
    for line in output.lines() {
        let line = line.trim();

        // 只处理以 "[GNUPG:] " 开头的行
        if !line.starts_with("[GNUPG:] ") {
            continue;
        }

        // 去除 "[GNUPG:] " 前缀，按空格分割为 tokens
        let content = &line["[GNUPG:] ".len()..];
        let tokens: Vec<&str> = content.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }

        let status_code = tokens[0];

        // 检查是否是签名状态码，根据不同的状态码填充 signature 信息
        match status_code {
            // GOODSIG <key> <signer...>：签名良好有效，signer 为剩余参数拼接
            "GOODSIG" => {
                let key = tokens.get(1).map(|s| s.to_string()).unwrap_or_default();
                let signer = tokens.get(2..).map(|parts| parts.join(" ")).unwrap_or_default();
                signature = Some(CommitSignature {
                    key,
                    signer,
                    status: SignatureStatus::GoodAndValid,
                });
                continue;
            }
            // BADSIG <key> <signer...>：签名错误
            "BADSIG" => {
                let key = tokens.get(1).map(|s| s.to_string()).unwrap_or_default();
                let signer = tokens.get(2..).map(|parts| parts.join(" ")).unwrap_or_default();
                signature = Some(CommitSignature {
                    key,
                    signer,
                    status: SignatureStatus::Bad,
                });
                continue;
            }
            // ERRSIG <key>：无法检查签名（如缺少公钥）
            "ERRSIG" => {
                let key = tokens.get(1).map(|s| s.to_string()).unwrap_or_default();
                signature = Some(CommitSignature {
                    key,
                    signer: String::new(),
                    status: SignatureStatus::CannotBeChecked,
                });
                continue;
            }
            // EXPSIG <key> <signer...>：签名良好但已过期
            "EXPSIG" => {
                let key = tokens.get(1).map(|s| s.to_string()).unwrap_or_default();
                let signer = tokens.get(2..).map(|parts| parts.join(" ")).unwrap_or_default();
                signature = Some(CommitSignature {
                    key,
                    signer,
                    status: SignatureStatus::GoodButExpired,
                });
                continue;
            }
            // EXPKEYSIG <key> <signer...>：签名良好但密钥已过期
            "EXPKEYSIG" => {
                let key = tokens.get(1).map(|s| s.to_string()).unwrap_or_default();
                let signer = tokens.get(2..).map(|parts| parts.join(" ")).unwrap_or_default();
                signature = Some(CommitSignature {
                    key,
                    signer,
                    status: SignatureStatus::GoodButMadeByExpiredKey,
                });
                continue;
            }
            // REVKEYSIG <key> <signer...>：签名良好但密钥已吊销
            "REVKEYSIG" => {
                let key = tokens.get(1).map(|s| s.to_string()).unwrap_or_default();
                let signer = tokens.get(2..).map(|parts| parts.join(" ")).unwrap_or_default();
                signature = Some(CommitSignature {
                    key,
                    signer,
                    status: SignatureStatus::GoodButMadeByRevokedKey,
                });
                continue;
            }
            // TRUST_xxx 行：记录信任级别，不直接创建签名
            "TRUST_UNDEFINED" | "TRUST_NEVER" | "TRUST_MARGINAL" | "TRUST_FULLY" | "TRUST_ULTIMATE" => {
                trust_level = Some(status_code.to_string());
                continue;
            }
            // 其他状态码（如 VALIDSIG、SIG_ID 等）忽略
            _ => continue,
        }
    }

    // 特殊处理：如果状态是 GoodAndValid 但 trust 级别是 UNDEFINED 或 NEVER，
    // 则将状态降级为 GoodWithUnknownValidity（与 gitgraph 项目一致）
    if let Some(ref mut sig) = signature {
        if sig.status == SignatureStatus::GoodAndValid {
            if let Some(ref trust) = trust_level {
                if trust == "TRUST_UNDEFINED" || trust == "TRUST_NEVER" {
                    sig.status = SignatureStatus::GoodWithUnknownValidity;
                }
            }
        }
    }

    signature
}

/**
 * 去除字符串尾部的空行
 *
 * 与 commit_details.rs 中的 remove_trailing_blank_lines 函数逻辑相同，
 * 此处重新实现以避免跨模块的私有函数依赖。
 *
 * 参数：
 * - s: 原始字符串
 *
 * 返回值：
 * - String: 去除尾部空行后的字符串
 */
fn remove_trailing_blank_lines(s: &str) -> String {
    // 按行分割（支持 \r\n、\r、\n 三种换行符）
    let mut lines: Vec<&str> = s.split('\n').collect();

    // 从后往前移除空行（trim 后为空的行）
    while let Some(last) = lines.last() {
        if last.trim().is_empty() {
            lines.pop();
        } else {
            break;
        }
    }

    lines.join("\n")
}
