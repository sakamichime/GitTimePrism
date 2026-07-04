/*
 * 壁纸相关命令模块
 *
 * 此模块提供壁纸相关的 Tauri IPC 命令：
 * - read_image_as_data_url：读取本地图片文件并返回 base64 data URL
 *
 * 为什么需要这个模块？
 * 前端通过 @tauri-apps/plugin-fs 的 readFile 读取文件时，
 * 在 Windows 上可能因为 fs scope 权限配置问题而静默失败。
 * 改用 Rust 命令直接读取文件是最可靠的方式，
 * 因为 Rust 代码拥有完整的文件系统访问权限。
 */

use std::fs;
use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

/// 根据文件扩展名推断图片的 MIME 类型
///
/// # 参数
/// - `path`: 文件路径（如 "C:\\Users\\xxx\\pic.jpg"）
///
/// # 返回
/// 对应的 MIME 类型字符串（如 "image/jpeg"），
/// 无法识别时默认返回 "image/png"
fn guess_mime_type(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".bmp") {
        "image/bmp"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        "image/png" // 无法识别时默认 PNG
    }
}

/// 读取本地图片文件并返回 base64 data URL
///
/// 前端通过 `invoke('read_image_as_data_url', { path: 'C:\\xxx.jpg' })` 调用。
/// 返回格式为 "data:image/jpeg;base64,..." 的字符串，
/// 可直接用于 CSS `background-image: url(...)`。
///
/// 读取失败时返回空字符串（前端可根据此判断失败，保持当前状态不变）。
///
/// # 参数
/// - `path`: 本地图片文件的完整路径
///
/// # 返回
/// base64 data URL 字符串，失败时返回空字符串
#[tauri::command]
pub fn read_image_as_data_url(path: String) -> String {
    // 读取文件二进制内容
    let file_bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("[壁纸] 读取图片失败: {} - 错误: {}", path, err);
            return String::new(); // 读取失败返回空字符串
        }
    };

    // 推断 MIME 类型
    let mime_type = guess_mime_type(&path);

    // 将二进制数据编码为 base64
    let base64_str = BASE64.encode(&file_bytes);

    // 拼接完整的 data URL
    let data_url = format!("data:{};base64,{}", mime_type, base64_str);

    eprintln!(
        "[壁纸] 读取图片成功: {} ({}KB, {})",
        path,
        file_bytes.len() / 1024,
        mime_type
    );

    data_url
}
