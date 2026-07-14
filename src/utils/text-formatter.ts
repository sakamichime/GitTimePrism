/**
 * 文本格式化工具（Text Formatter）— 完整 AST 解析版（Task 11.1）
 *
 * 此模块提供提交消息（commit message）的完整文本格式化功能，参考 gitgraph 项目的
 * TextFormatter 类实现。它将纯文本解析为 AST（抽象语法树），再渲染为带样式的 HTML。
 *
 * 支持的格式化类型（按解析顺序）：
 *   1. Code：反引号代码块 `code` → <code>code</code>
 *   2. URL：自动识别 http/https URL → <a class="externalUrl">URL</a>
 *   3. Issue Link：根据 issueLinking 配置将 #123 转为超链接
 *   4. Commit Hash：6 位以上十六进制哈希 → <span class="internalUrl" data-type="commit">
 *   5. Backslash Escape：反斜杠转义标点符号 \* → *
 *   6. Emoji：shortcode :sparkles: → ✨
 *   7. Emphasis：CommonMark 规范的 *italic* / **bold** / _italic_ / __bold__
 *
 * AST 节点类型（NodeType enum）：
 *   - Root：根节点（虚拟节点，包含所有顶级节点）
 *   - Plain：纯文本节点（包括反斜杠转义后的字符）
 *   - Code：代码块节点
 *   - Url：URL 超链接节点（外部 URL 和 Issue Link 共用）
 *   - CommitHash：提交哈希内部链接节点
 *   - Emoji：emoji shortcode 节点
 *   - Asterisk / DoubleAsterisk：斜体 / 粗体（* 和 **）
 *   - Underscore / DoubleUnderscore：斜体 / 粗体（_ 和 __）
 *
 * 设计说明：
 *   - 使用普通 enum（非 const enum），因为 tsconfig 启用了 isolatedModules: true，
 *     const enum 在跨模块使用时会被擦除，导致运行时无值。
 *   - HTML 转义使用 git-utils.ts 的 escapeHtml 函数，确保 XSS 防护一致性。
 *   - 重叠检测：URL/Issue/Commit/Emoji/Emphasis 节点插入时用 insertIntoTreeIfNoOverlap
 *     拒绝与已有节点重叠的新节点；Code 和 Emphasis 使用 insertIntoTree 允许嵌套。
 *
 * 参考实现：docs/git/web/textFormatter.ts（gitgraph 的完整 TextFormatter 类）
 *
 * 使用方式：
 * ```typescript
 * import { formatLine, TextFormatter, formatCommitMessage } from '../utils/text-formatter';
 *
 * // 简单用法（单行格式化）
 * const html = formatLine('Fix bug *important* #123', {
 *   markdown: true,
 *   emoji: true,
 *   issueLinking: { regex: '#([0-9]+)', urlTemplate: 'https://github.com/owner/repo/issues/$1' }
 * });
 *
 * // 高级用法（含 commit hash 内部链接）
 * const formatter = new TextFormatter(commits, { markdown: true, commits: true });
 * const html = formatter.format('See commit abc1234 for details');
 * ```
 */

import { escapeHtml } from './git-utils.js';
import { configService } from '../services/config-service.js';

/* ========================================================================== *
 * 第一部分：AST 节点类型定义
 * ========================================================================== */

/**
 * AST 节点类型枚举
 *
 * 标识 AST 中每个节点的类型。使用普通 enum（非 const enum），
 * 因为 tsconfig 启用了 isolatedModules: true，const enum 跨模块使用会有问题。
 *
 * 各类型说明：
 *   - Asterisk：单星号 *italic* 斜体节点
 *   - DoubleAsterisk：双星号 **bold** 粗体节点
 *   - Underscore：单下划线 _italic_ 斜体节点
 *   - DoubleUnderscore：双下划线 __bold__ 粗体节点
 *   - Code：反引号 `code` 代码块节点
 *   - CommitHash：提交哈希内部链接节点
 *   - Emoji：emoji shortcode 节点
 *   - Plain：纯文本节点（包括反斜杠转义后的字符）
 *   - Root：根节点（虚拟节点，包含所有顶级节点）
 *   - Url：URL 超链接节点（外部 URL 和 Issue Link 共用）
 */
export enum NodeType {
  /** 单星号 *italic* 斜体 */
  Asterisk,
  /** 反引号 `code` 代码块 */
  Code,
  /** 提交哈希内部链接 */
  CommitHash,
  /** 双星号 **bold** 粗体 */
  DoubleAsterisk,
  /** 双下划线 __bold__ 粗体 */
  DoubleUnderscore,
  /** emoji shortcode */
  Emoji,
  /** 纯文本（包括反斜杠转义后的字符） */
  Plain,
  /** 根节点（虚拟节点） */
  Root,
  /** 单下划线 _italic_ 斜体 */
  Underscore,
  /** URL 超链接（外部 URL 和 Issue Link 共用） */
  Url,
}

/**
 * AST 节点基础接口
 *
 * 所有节点类型都继承此接口。start 和 end 表示节点在原始文本中的字符位置（闭区间）。
 * contains 是节点的子节点列表（用于嵌套结构，如 emphasis 内部可以包含其他节点）。
 */
interface BaseNode {
  /** 节点类型 */
  type: NodeType;
  /** 节点在原始文本中的起始位置（包含，0-based） */
  start: number;
  /** 节点在原始文本中的结束位置（包含，0-based） */
  end: number;
  /** 子节点列表（用于嵌套结构） */
  contains: Node[];
}

/**
 * 带值的节点基础接口
 *
 * 某些节点（Code、Plain）需要存储原始文本值，而不是从原始文本中截取。
 * 例如反斜杠转义后的字符，原始文本是 `\*`，但节点的 value 是 `*`。
 */
interface BaseValueNode extends BaseNode {
  /** 节点的文本值（可能与原始文本不同，如反斜杠转义后） */
  value: string;
}

/**
 * 单/双星号节点（斜体/粗体）
 *
 * type 为 Asterisk 时表示 *italic*，type 为 DoubleAsterisk 时表示 **bold**。
 * 节点的 start/end 包含了星号本身，子节点 contains 是星号之间的内容。
 */
interface AsteriskNode extends BaseNode {
  type: NodeType.Asterisk | NodeType.DoubleAsterisk;
}

/**
 * 代码块节点
 *
 * 例如 `code` 会被解析为一个 CodeNode，value 为 "code"（去掉反引号和首尾空格）。
 */
interface CodeNode extends BaseValueNode {
  type: NodeType.Code;
}

/**
 * 提交哈希节点
 *
 * 存储完整的提交哈希值（用于点击时跳转到对应提交）。
 * 例如文本中的 "abc1234" 如果匹配到某个 commit，则生成 CommitHashNode。
 */
interface CommitHashNode extends BaseNode {
  type: NodeType.CommitHash;
  /** 完整的提交哈希值（40 位），用于点击跳转 */
  commit: string;
}

/**
 * Emoji 节点
 *
 * 存储解析后的 emoji 字符（如 ✨）。原始文本 ":sparkles:" 被替换为 emoji 字符。
 */
interface EmojiNode extends BaseNode {
  type: NodeType.Emoji;
  /** 解析后的 emoji 字符（如 ✨） */
  emoji: string;
}

/**
 * 纯文本节点
 *
 * 用于反斜杠转义后的字符（如 `\*` 的 value 为 `*`）。
 */
interface PlainNode extends BaseValueNode {
  type: NodeType.Plain;
}

/**
 * 单/双下划线节点（斜体/粗体）
 *
 * type 为 Underscore 时表示 _italic_，type 为 DoubleUnderscore 时表示 __bold__。
 */
interface UnderscoreNode extends BaseNode {
  type: NodeType.Underscore | NodeType.DoubleUnderscore;
}

/**
 * URL 超链接节点
 *
 * 用于外部 URL 和 Issue Link。url 是跳转地址，displayText 是显示文本。
 * 例如文本 "https://example.com" 的 url 和 displayText 都是 "https://example.com"。
 * Issue Link "#123" 的 url 是 "https://github.com/owner/repo/issues/123"，displayText 是 "#123"。
 */
interface UrlNode extends BaseNode {
  type: NodeType.Url;
  /** 跳转地址（完整的 URL） */
  url: string;
  /** 显示文本（用户看到的文本，可能与 url 不同） */
  displayText: string;
}

/**
 * 根节点接口
 *
 * AST 的顶层节点，start 为 -1（虚拟），end 为文本长度。contains 是所有顶级节点。
 */
export interface RootNode extends BaseNode {
  type: NodeType.Root;
}

/**
 * AST 节点的联合类型
 *
 * 所有可能的节点类型的联合类型，用于递归遍历 AST。
 */
export type Node = AsteriskNode | CodeNode | CommitHashNode | EmojiNode | PlainNode | RootNode | UnderscoreNode | UrlNode;

/* ========================================================================== *
 * 第二部分：Emphasis 解析相关类型（CommonMark 规范）
 * ========================================================================== */

/**
 * Emphasis 分隔符类型枚举
 *
 * CommonMark 规范中，emphasis 可以用星号 (*) 或下划线 (_) 作为分隔符。
 * 使用普通 enum（非 const enum），因为 isolatedModules 限制。
 */
export enum EmphasisDelimiterType {
  /** 星号分隔符 * */
  Asterisk = '*',
  /** 下划线分隔符 _ */
  Underscore = '_',
}

/**
 * Emphasis 分隔符位置信息
 *
 * 记录单个 emphasis 字符（* 或 _）在文本中的位置和所属的 run。
 * 例如文本 "**bold**" 会被解析为 6 个 EmphasisDelimiter，前两个属于 run 0，后两个属于 run 1。
 */
export interface EmphasisDelimiter {
  /** 字符在文本中的位置（0-based） */
  index: number;
  /** 所属的 EmphasisRun 在 runs 数组中的索引 */
  run: number;
}

/**
 * Emphasis 连续运行信息
 *
 * 记录一组连续的相同 emphasis 字符（如 "**" 是 size=2 的 run）的左/右标记属性。
 * 用于 CommonMark 的 left-flanking / right-flanking 算法判断 emphasis 的开/闭。
 */
export interface EmphasisRun {
  /** 分隔符类型（* 或 _） */
  type: EmphasisDelimiterType;
  /** 连续字符数量（如 "**" 的 size 为 2） */
  size: number;
  /** 是否是左标记（left-flanking） */
  open: boolean;
  /** 是否是右标记（right-flanking） */
  close: boolean;
  /** 是否同时是左标记和右标记 */
  both: boolean;
}

/**
 * 反引号分隔符位置信息
 *
 * 记录一组连续的反引号在文本中的位置和具体字符。用于代码块解析。
 * 例如文本 "``code``" 会有两个 BacktickDelimiter，run 都是 "``"。
 */
export interface BacktickDelimiter {
  /** 反引号组的起始位置（0-based） */
  index: number;
  /** 连续的反引号字符串（如 "`" 或 "``"） */
  run: string;
}

/* ========================================================================== *
 * 第三部分：配置接口
 * ========================================================================== */

/**
 * TextFormatter 配置接口
 *
 * 控制哪些格式化类型应该被启用。所有字段都是可选的，默认为 false。
 */
export interface TextFormatterConfig {
  /** 是否启用 commit hash 内部链接（需要提供 commits 数组） */
  commits?: boolean;
  /** 是否启用 emoji shortcode 解析（:sparkles: → ✨） */
  emoji?: boolean;
  /** 是否启用 Issue Linking（需要同时提供 issueLinkingConfig 配置） */
  issueLinking?: boolean;
  /** Issue Linking 的具体配置（正则和 URL 模板），仅在 issueLinking 为 true 时生效 */
  issueLinkingConfig?: IssueLinkingConfig | null;
  /** 是否启用 Markdown 语法（代码块、emphasis、反斜杠转义） */
  markdown?: boolean;
  /** 是否启用多行模式（将换行符转为 <br>，并处理行首缩进） */
  multiline?: boolean;
  /** 是否启用 URL 自动识别（http/https） */
  urls?: boolean;
}

/**
 * Issue Linking 配置接口
 *
 * 提供给 formatLine 函数的 issue linking 配置，包含正则表达式和 URL 模板。
 */
export interface IssueLinkingConfig {
  /** 用于匹配 issue 编号的正则表达式字符串（如 '#([0-9]+)'） */
  regex: string;
  /** Issue URL 模板（用 $1、$2 引用正则捕获组，如 'https://github.com/owner/repo/issues/$1'） */
  urlTemplate: string;
}

/**
 * formatLine 函数的配置接口
 *
 * 这是 formatLine 主入口的配置参数，包含 issueLinking 配置和各类格式化开关。
 */
export interface FormatLineConfig {
  /** Issue Linking 配置（如果启用 issue linking） */
  issueLinking?: IssueLinkingConfig;
  /** 是否启用 emoji shortcode 解析 */
  emoji?: boolean;
  /** 是否启用 Markdown 语法 */
  markdown?: boolean;
  /** 是否启用 URL 自动识别 */
  urls?: boolean;
  /** 是否启用 commit hash 内部链接 */
  commits?: boolean;
  /** 提交列表（用于 commit hash 解析，每项至少包含 hash 字段） */
  commitsList?: ReadonlyArray<{ hash: string }>;
}

/* ========================================================================== *
 * 第四部分：常量定义
 * ========================================================================== */

/**
 * HTML 转义后的 issue 链接的 CSS 类名
 * 外部 URL 使用 externalUrl 类（与 gitgraph 一致）
 */
const ISSUE_LINK_CLASS = 'externalUrl';

/**
 * 外部 URL 的 CSS 类名（与 ISSUE_LINK_CLASS 相同，用于一致性）
 */
const CLASS_EXTERNAL_URL = 'externalUrl';

/**
 * 内部 URL 的 CSS 类名（commit hash 等内部链接）
 */
const CLASS_INTERNAL_URL = 'internalUrl';

/**
 * 匹配 URL 模板中 $1、$2 等占位符的正则表达式
 * $1 到 $9 表示正则的捕获组编号
 */
const ISSUE_LINKING_ARGUMENT_REGEXP = /\$([1-9][0-9]*)/g;

/**
 * 内置 emoji shortcode 到 emoji 字符的映射表
 *
 * 包含约 60 个 Git 提交消息中常用的 emoji（参考 gitmoji 规范）。
 * 用户可以通过 registerCustomEmojiMappings 添加自定义映射。
 */
const EMOJI_MAPPINGS: { [shortcode: string]: string } = {
  'adhesive_bandage': '🩹',
  'alembic': '⚗',
  'alien': '👽',
  'ambulance': '🚑',
  'apple': '🍎',
  'arrow_down': '⬇️',
  'arrow_up': '⬆️',
  'art': '🎨',
  'beers': '🍻',
  'bento': '🍱',
  'bookmark': '🔖',
  'books': '📚',
  'boom': '💥',
  'bug': '🐛',
  'building_construction': '🏗',
  'bulb': '💡',
  'busts_in_silhouette': '👥',
  'camera_flash': '📸',
  'card_file_box': '🗃',
  'card_index': '📇',
  'chart_with_upwards_trend': '📈',
  'checkered_flag': '🏁',
  'children_crossing': '🚸',
  'clown_face': '🤡',
  'construction': '🚧',
  'construction_worker': '👷',
  'dizzy': '💫',
  'egg': '🥚',
  'exclamation': '❗',
  'fire': '🔥',
  'globe_with_meridians': '🌐',
  'goal_net': '🥅',
  'green_apple': '🍏',
  'green_heart': '💚',
  'hammer': '🔨',
  'heavy_check_mark': '✔️',
  'heavy_minus_sign': '➖',
  'heavy_plus_sign': '➕',
  'iphone': '📱',
  'label': '🏷️',
  'lipstick': '💄',
  'lock': '🔒',
  'loud_sound': '🔊',
  'mag': '🔍',
  'memo': '📝',
  'mute': '🔇',
  'new': '🆕',
  'ok_hand': '👌',
  'package': '📦',
  'page_facing_up': '📄',
  'passport_control': '🛂',
  'pencil': '📝',
  'pencil2': '✏️',
  'penguin': '🐧',
  'poop': '💩',
  'pushpin': '📌',
  'racehorse': '🐎',
  'recycle': '♻️',
  'rewind': '⏪',
  'robot': '🤖',
  'rocket': '🚀',
  'rotating_light': '🚨',
  'see_no_evil': '🙈',
  'seedling': '🌱',
  'shirt': '👕',
  'sparkles': '✨',
  'speech_balloon': '💬',
  'tada': '🎉',
  'triangular_flag_on_post': '🚩',
  'triangular_ruler': '📐',
  'truck': '🚚',
  'twisted_rightwards_arrows': '🔀',
  'video_game': '🎮',
  'wastebasket': '🗑',
  'whale': '🐳',
  'wheel_of_dharma': '☸️',
  'wheelchair': '♿️',
  'white_check_mark': '✅',
  'wrench': '🔧',
  'zap': '⚡️',
};

/**
 * 包围字符的对应关系（用于 URL 末尾字符的处理）
 *
 * 当 URL 末尾是 ) ] } > 之一时，如果 URL 前一个字符是对应的 ( [ { <，
 * 则认为末尾字符是包围字符，不属于 URL，需要移除。
 * * 和 _ 也在此表中，用于处理 emphasis 与 URL 边界的特殊情况。
 */
const ENCLOSING_GROUPS: { [close: string]: string } = {
  ')': '(',
  ']': '[',
  '}': '{',
  '>': '<',
  '*': '*',
  '_': '_',
};

/* ========================================================================== *
 * 第五部分：Issue Linking 内部辅助函数
 * ========================================================================== */

/**
 * Issue Linking 内部配置（包含编译好的正则表达式）
 */
interface IssueLinking {
  /** 用于匹配 issue 编号的正则表达式（带 g 和 u 标志） */
  regexp: RegExp;
  /** Issue URL 模板（用 $1、$2 等引用正则捕获组） */
  url: string;
}

/**
 * 解析 Issue Linking 配置
 *
 * 将 IssueLinkingConfig（正则字符串 + URL 模板）编译为内部的 IssueLinking 结构。
 *
 * @param config - Issue Linking 配置（正则字符串和 URL 模板）
 * @returns 编译后的 IssueLinking，如果配置无效返回 null
 */
function parseIssueLinkingConfig(config: IssueLinkingConfig | null | undefined): IssueLinking | null {
  // 配置为空则不启用
  if (!config) return null;
  // 正则表达式或 URL 为空则不启用
  if (!config.regex || !config.urlTemplate) return null;

  try {
    // 编译正则表达式，使用 g（全局）和 u（Unicode）标志
    return {
      regexp: new RegExp(config.regex, 'gu'),
      url: config.urlTemplate,
    };
  } catch (e) {
    // 正则表达式编译失败（如语法错误），打印警告并返回 null
    console.warn('[TextFormatter] Issue Linking 正则表达式无效:', config.regex, e);
    return null;
  }
}

/**
 * 根据 Issue Linking 匹配结果生成 issue URL
 *
 * 将 URL 模板中的 $1、$2 等占位符替换为正则匹配的捕获组内容。
 *
 * @param match - 正则匹配结果（match[0] 为完整匹配，match[1]、match[2] 为捕获组）
 * @param issueLinking - Issue Linking 配置
 * @returns 替换后的完整 URL
 */
function generateIssueLinkFromMatch(match: RegExpExecArray, issueLinking: IssueLinking): string {
  // 如果有捕获组（match.length > 1），执行占位符替换
  if (match.length > 1) {
    return issueLinking.url.replace(ISSUE_LINKING_ARGUMENT_REGEXP, (placeholder, index) => {
      // index 是占位符中的数字（如 $1 中的 1）
      const i = parseInt(index, 10);
      // 如果捕获组存在，用捕获组内容替换；否则保留原占位符
      return i < match.length ? match[i] : placeholder;
    });
  }
  // 没有捕获组，直接返回 URL 模板
  return issueLinking.url;
}

/* ========================================================================== *
 * 第六部分：TextFormatter 类（完整 AST 解析）
 * ========================================================================== */

/**
 * 文本格式化器类（完整 AST 解析版）
 *
 * 此类是 gitgraph 项目 TextFormatter 的移植版本，提供完整的文本格式化功能。
 *
 * 使用方式：
 * ```typescript
 * const formatter = new TextFormatter(commits, {
 *   markdown: true,
 *   emoji: true,
 *   urls: true,
 *   commits: true,
 *   issueLinking: { regex: '#([0-9]+)', urlTemplate: 'https://github.com/owner/repo/issues/$1' }
 * });
 * const html = formatter.format('Fix *important* bug #123');
 * ```
 */
export class TextFormatter {
  /**
   * 反引号正则表达式（用于代码块解析）
   *
   * 捕获组 1：反引号前的反斜杠序列（偶数个反斜杠不转义，奇数个转义）
   * 捕获组 2：连续的反引号序列
   */
  private static readonly BACKTICK_REGEXP: RegExp = /(\\*)(`+)/gu;

  /**
   * 反斜杠转义正则表达式
   *
   * 匹配反斜杠后跟一个 ASCII 标点符号的情况（如 \* → *）。
   * Unicode 范围 \u0021-\u002F、\u003A-\u0040、\u005B-\u0060、\u007B-\u007E
   * 覆盖了所有 ASCII 标点符号。
   */
  private static readonly BACKSLASH_ESCAPE_REGEXP: RegExp = /\\[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E]/gu;

  /**
   * 提交哈希正则表达式
   *
   * 匹配 6 位以上的十六进制字符串（[0-9a-fA-F]）。
   * 使用 \b 单词边界确保不会匹配到更长字符串的中间部分。
   */
  private static readonly COMMIT_REGEXP: RegExp = /\b([0-9a-fA-F]{6,})\b/gu;

  /**
   * Emoji shortcode 正则表达式
   *
   * 匹配 :shortcode: 格式的 emoji 短代码（如 :sparkles:）。
   * shortcode 只能包含字母、数字、连字符和下划线。
   */
  private static readonly EMOJI_REGEXP: RegExp = /:([A-Za-z0-9-_]+):/gu;

  /**
   * Emphasis 分隔符正则表达式
   *
   * 此正则用于识别 * 和 _ 分隔符，并捕获其前后的字符以判断 left/right-flanking。
   * 捕获组 1：分隔符前的字符（可能是反斜杠序列、空格、标点或其他字符）
   * 捕获组 2：连续的 * 或 _ 字符
   * 捕获组 3：分隔符后的字符（单个字符）
   */
  private static readonly EMPHASIS_REGEXP: RegExp = /(\\+|[^*_]?)([*_]+)(.?)/gu;

  /**
   * 行首缩进正则表达式
   *
   * 匹配行首的空格或制表符（用于多行模式下的缩进处理）。
   */
  private static readonly INDENT_REGEXP: RegExp = /^[ \t]+/u;

  /**
   * 标点符号正则表达式
   *
   * CommonMark 规范定义的标点符号集合，用于 emphasis 的 left/right-flanking 判断。
   * 包含 ASCII 标点和部分 Unicode 标点符号。
   */
  private static readonly PUNCTUATION_REGEXP: RegExp = /[\u0021-\u002F\u003A-\u0040\u005B-\u0060\u007B-\u007E\u00A1\u00A7\u00AB\u00B6\u00B7\u00BB\u00BF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C77\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4F\u2E52\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]/u;

  /**
   * URL 正则表达式
   *
   * 匹配 http:// 或 https:// 开头的 URL。
   * \S+ 匹配非空白字符，[^,.?!'":;\s] 确保末尾不是标点或空白。
   */
  private static readonly URL_REGEXP: RegExp = /https?:\/\/\S+[^,.?!'":;\s]/gu;

  /**
   * 空白字符正则表达式
   *
   * 判断单个字符是否是空白字符（用于 emphasis 的 left/right-flanking 判断）。
   * 包含空格、制表符、换行符和各种 Unicode 空白字符。
   */
  private static readonly WHITESPACE_REGEXP: RegExp = /^([\u0009\u000A\u000C\u000D\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]|)$/u;

  /**
   * 格式化配置（只读，构造时确定）
   *
   * 包含所有格式化类型的开关和 issueLinking 配置。
   */
  private readonly config: Readonly<{
    commits: boolean;
    emoji: boolean;
    issueLinking: boolean;
    markdown: boolean;
    multiline: boolean;
    urls: boolean;
  }>;

  /**
   * 提交列表（只读，用于 commit hash 解析）
   *
   * 当 config.commits 为 true 时，文本中的 6 位以上十六进制字符串如果匹配到
   * 某个 commit 的 hash 前缀，则生成 commit hash 内部链接。
   */
  private readonly commits: ReadonlyArray<{ hash: string }>;

  /**
   * Issue Linking 配置（只读，编译后的正则和 URL 模板）
   *
   * 当 config.issueLinking 为 true 且配置有效时，文本中匹配正则的内容会转为超链接。
   * 如果配置无效或为 null，则不进行 issue linking。
   */
  private readonly issueLinking: IssueLinking | null = null;

  /**
   * 构造 TextFormatter 实例
   *
   * @param commits - 提交列表（用于 commit hash 解析，每项至少包含 hash 字段）
   * @param config - 格式化配置（控制哪些类型应该被处理）
   */
  constructor(
    commits: ReadonlyArray<{ hash: string }>,
    config: TextFormatterConfig,
  ) {
    // 合并默认配置（所有字段默认为 false）
    this.config = {
      commits: config.commits ?? false,
      emoji: config.emoji ?? false,
      issueLinking: config.issueLinking ?? false,
      markdown: config.markdown ?? false,
      multiline: config.multiline ?? false,
      urls: config.urls ?? false,
    };
    this.commits = commits;

    // 如果启用 issue linking，解析配置
    if (this.config.issueLinking) {
      this.issueLinking = parseIssueLinkingConfig(config.issueLinkingConfig ?? null);
    }
  }

  /**
   * 将输入文本格式化为 HTML
   *
   * 主入口方法。如果启用 multiline 模式，会按换行符分割文本，逐行处理并插入 <br>。
   * 否则直接调用 formatLine 处理单行。
   *
   * @param input - 输入的纯文本
   * @returns 格式化后的 HTML 字符串
   */
  public format(input: string): string {
    // 如果启用多行模式，逐行处理
    if (this.config.multiline) {
      const html: string[] = [];
      const lines: string[] = input.split('\n');

      for (let i = 0; i < lines.length; i++) {
        // 行与行之间插入 <br>
        if (i > 0) {
          html.push('<br/>');
        }

        // 处理行首缩进：将制表符转为 4 个 &nbsp;，空格转为 &nbsp;
        let indentLength = 0;
        const match = lines[i].match(TextFormatter.INDENT_REGEXP);
        if (match) {
          for (let j = 0; j < match[0].length; j++) {
            // 制表符转为 4 个不换行空格，普通空格转为 1 个不换行空格
            html.push(match[0][j] === '\t' ? '&nbsp;&nbsp;&nbsp;&nbsp;' : '&nbsp;');
          }
          indentLength = match[0].length;
        }

        // 处理剩余部分（去掉缩进后的内容）
        const lineContent = indentLength > 0 ? lines[i].substring(indentLength) : lines[i];
        html.push(this.formatLine(lineContent));
      }
      return html.join('');
    } else {
      // 单行模式：直接处理整段文本
      return this.formatLine(input);
    }
  }

  /**
   * 将单行文本格式化为 HTML（核心解析方法）
   *
   * 此方法是 TextFormatter 的核心，按以下顺序解析文本：
   *   1. Code：反引号代码块（如果 config.markdown）
   *   2. URL：自动识别 URL（如果 config.urls）
   *   3. Issue Link：根据 issueLinking 配置（如果 config.issueLinking）
   *   4. Commit Hash：提交哈希内部链接（如果 config.commits）
   *   5. Backslash Escape：反斜杠转义（如果 config.markdown）
   *   6. Emoji：shortcode 解析（如果 config.emoji）
   *   7. Emphasis：* 和 _ 的 emphasis 解析（如果 config.markdown）
   *
   * 解析完成后，递归遍历 AST 生成 HTML 字符串。
   *
   * @param input - 输入的单行纯文本
   * @returns 格式化后的 HTML 字符串
   */
  private formatLine(input: string): string {
    // 创建 AST 根节点
    const tree: RootNode = {
      type: NodeType.Root,
      start: -1, // 根节点 start 为 -1（虚拟标记）
      end: input.length,
      contains: [],
    };

    let match: RegExpExecArray | null;

    /* ---------- 1. Code：反引号代码块解析 ---------- */
    if (this.config.markdown) {
      // 使用栈结构匹配成对的反引号
      const backTickStack: BacktickDelimiter[] = [];
      TextFormatter.BACKTICK_REGEXP.lastIndex = 0;

      while ((match = TextFormatter.BACKTICK_REGEXP.exec(input)) !== null) {
        // match[1] 是反引号前的反斜杠序列，match[2] 是反引号序列
        const backtick: BacktickDelimiter = {
          index: match.index + match[1].length,
          run: match[2],
        };

        // 如果栈为空，检查反斜杠转义
        if (backTickStack.length === 0) {
          // 奇数个反斜杠表示转义反引号，跳过
          if (match[1].length % 2 === 1) {
            if (backtick.run.length > 1) {
              // 多个反引号且被转义：去掉第一个反引号，继续处理剩余
              backtick.index++;
              backtick.run = backtick.run.substring(1);
            } else {
              // 单个反引号被转义：跳过此匹配
              continue;
            }
          }
        }

        // 从栈顶向下查找匹配的反引号对
        let i: number;
        for (i = backTickStack.length - 1; i >= 0; i--) {
          if (backTickStack[i].run === backtick.run) {
            // 找到匹配的反引号对，提取中间内容作为代码值
            let value = input.substring(
              backTickStack[i].index + backtick.run.length,
              backtick.index,
            );
            // 如果内容首尾都是空格且中间有非空格字符，去掉首尾空格
            if (value.startsWith(' ') && value.endsWith(' ') && /[^ ]/.test(value)) {
              value = value.substring(1, value.length - 1);
            }
            // 插入 Code 节点到 AST（使用 insertIntoTree 允许嵌套）
            TextFormatter.insertIntoTree(tree, {
              type: NodeType.Code,
              start: backTickStack[i].index,
              end: backtick.index + backtick.run.length - 1,
              value: value,
              contains: [],
            });
            // 从栈中移除已匹配的反引号
            backTickStack.splice(i);
            break;
          }
        }
        // 如果没有找到匹配的开反引号，将当前反引号压入栈
        if (i === -1) {
          backTickStack.push(backtick);
        }
      }
    }

    /* ---------- 2. URL：自动识别 URL ---------- */
    if (this.config.urls) {
      TextFormatter.URL_REGEXP.lastIndex = 0;
      while ((match = TextFormatter.URL_REGEXP.exec(input)) !== null) {
        let url = match[0];
        // 检查 URL 末尾字符是否是包围字符（如 ()、[]、{}、<>）
        const suffix = url.substring(url.length - 1);
        if (
          match.index > 0 &&
          typeof ENCLOSING_GROUPS[suffix] === 'string' &&
          input.substring(match.index - 1, match.index) === ENCLOSING_GROUPS[suffix]
        ) {
          // 末尾是包围字符且前一个字符是对应的开字符，移除末尾字符
          url = url.substring(0, url.length - 1);
          TextFormatter.URL_REGEXP.lastIndex--;
        }
        // 插入 URL 节点（使用 insertIntoTreeIfNoOverlap 避免与 Code 重叠）
        TextFormatter.insertIntoTreeIfNoOverlap(tree, {
          type: NodeType.Url,
          start: match.index,
          end: TextFormatter.URL_REGEXP.lastIndex - 1,
          url: url,
          displayText: url,
          contains: [],
        });
      }
    }

    /* ---------- 3. Issue Link：Issue 链接解析 ---------- */
    if (this.issueLinking !== null) {
      this.issueLinking.regexp.lastIndex = 0;
      while ((match = this.issueLinking.regexp.exec(input)) !== null) {
        // 避免零长度匹配导致死循环
        if (match[0].length === 0) break;
        // 插入 URL 节点（displayText 是匹配的文本，url 是生成的 issue URL）
        TextFormatter.insertIntoTreeIfNoOverlap(tree, {
          type: NodeType.Url,
          start: match.index,
          end: this.issueLinking.regexp.lastIndex - 1,
          url: generateIssueLinkFromMatch(match, this.issueLinking),
          displayText: match[0],
          contains: [],
        });
      }
    }

    /* ---------- 4. Commit Hash：提交哈希内部链接解析 ---------- */
    if (this.config.commits) {
      TextFormatter.COMMIT_REGEXP.lastIndex = 0;
      while ((match = TextFormatter.COMMIT_REGEXP.exec(input)) !== null) {
        const hash = match[0].toLowerCase();
        // 在 commits 列表中查找哈希前缀匹配的提交
        const commit = this.commits.find((c) => c.hash.toLowerCase().startsWith(hash));
        if (commit) {
          // 插入 CommitHash 节点（使用 insertIntoTreeIfNoOverlap 避免重叠）
          TextFormatter.insertIntoTreeIfNoOverlap(tree, {
            type: NodeType.CommitHash,
            commit: commit.hash,
            start: match.index,
            end: TextFormatter.COMMIT_REGEXP.lastIndex - 1,
            contains: [],
          });
        }
      }
    }

    /* ---------- 5. Backslash Escape：反斜杠转义解析 ---------- */
    if (this.config.markdown) {
      TextFormatter.BACKSLASH_ESCAPE_REGEXP.lastIndex = 0;
      while ((match = TextFormatter.BACKSLASH_ESCAPE_REGEXP.exec(input)) !== null) {
        // 反斜杠转义的标点符号：插入 Plain 节点，value 是去掉反斜杠后的字符
        TextFormatter.insertIntoTreeIfNoOverlap(tree, {
          type: NodeType.Plain,
          start: match.index,
          end: TextFormatter.BACKSLASH_ESCAPE_REGEXP.lastIndex - 1,
          value: match[0].substring(1),
          contains: [],
        });
      }
    }

    /* ---------- 6. Emoji：shortcode 解析 ---------- */
    if (this.config.emoji) {
      TextFormatter.EMOJI_REGEXP.lastIndex = 0;
      while ((match = TextFormatter.EMOJI_REGEXP.exec(input)) !== null) {
        // 检查 shortcode 是否在映射表中
        if (typeof EMOJI_MAPPINGS[match[1]] === 'string') {
          TextFormatter.insertIntoTreeIfNoOverlap(tree, {
            type: NodeType.Emoji,
            start: match.index,
            end: TextFormatter.EMOJI_REGEXP.lastIndex - 1,
            emoji: EMOJI_MAPPINGS[match[1]],
            contains: [],
          });
        }
      }
    }

    /* ---------- 7. Emphasis：* 和 _ 的 emphasis 解析 ---------- */
    if (this.config.markdown) {
      // emphasisTokens：所有 emphasis 字符的位置和所属 run
      const emphasisTokens: EmphasisDelimiter[] = [];
      // emphasisRuns：所有 emphasis run 的属性（开/闭标记）
      const emphasisRuns: EmphasisRun[] = [];

      // 临时变量（在循环中使用）
      let runLength: number;
      let whitespaceBefore: boolean;
      let whitespaceAfter: boolean;
      let punctuationBefore: boolean;
      let punctuationAfter: boolean;
      let isLeft: boolean;
      let isRight: boolean;
      let isOpen: boolean;
      let isClosed: boolean;

      TextFormatter.EMPHASIS_REGEXP.lastIndex = 0;
      while ((match = TextFormatter.EMPHASIS_REGEXP.exec(input)) !== null) {
        // 解析 EMPHASIS_REGEXP 的三个捕获组
        let prev = 0; // seq 中前一个字符的索引
        let cur = 1; // seq 中当前字符的索引
        let next = 2; // seq 中下一个字符的索引
        let index = match.index;

        // 将三个捕获组合并为一个字符序列
        const seq: string[] = [match[1]];
        seq.push(...match[2].split(''));
        seq.push(match[3]);

        // 处理反斜杠转义
        if (seq[0].startsWith('\\')) {
          if (seq[0].length % 2 === 1) {
            // 奇数个反斜杠：转义后面的字符，移除反斜杠序列
            index += seq[0].length;
            seq.shift();
          } else {
            // 偶数个反斜杠：不转义，保留一个反斜杠
            index += seq[0].length - 1;
            seq[0] = '\\';
          }
        }

        // 跳过前一个字符，处理连续的 * 或 _ 序列
        index += seq[prev].length;
        while (cur < seq.length - 1) {
          // 找到连续相同字符的结束位置
          while (next < seq.length - 1 && seq[cur] === seq[next]) next++;

          runLength = next - cur;
          // 判断前后字符是否是空白或标点（用于 left/right-flanking 判断）
          whitespaceBefore = TextFormatter.WHITESPACE_REGEXP.test(seq[prev]);
          whitespaceAfter = TextFormatter.WHITESPACE_REGEXP.test(seq[next]);
          punctuationBefore = TextFormatter.PUNCTUATION_REGEXP.test(seq[prev]);
          punctuationAfter = TextFormatter.PUNCTUATION_REGEXP.test(seq[next]);

          // CommonMark left-flanking 判断：后面不是空白，且（后面不是标点 或 前面是空白/标点）
          isLeft = !whitespaceAfter && (!punctuationAfter || (punctuationAfter && (whitespaceBefore || punctuationBefore)));
          // CommonMark right-flanking 判断：前面不是空白，且（前面不是标点 或 后面是空白/标点）
          isRight = !whitespaceBefore && (!punctuationBefore || (punctuationBefore && (whitespaceAfter || punctuationAfter)));

          if (seq[cur] === EmphasisDelimiterType.Asterisk) {
            // 星号：left-flanking 即可开，right-flanking 即可闭
            isOpen = isLeft;
            isClosed = isRight;
          } else {
            // 下划线：需要更严格的条件（CommonMark 规范）
            // 开：left-flanking 且（不是 right-flanking 或 前面是标点）
            isOpen = isLeft && (!isRight || punctuationBefore);
            // 闭：right-flanking 且（不是 left-flanking 或 后面是标点）
            isClosed = isRight && (!isLeft || punctuationAfter);
          }

          // 为每个 emphasis 字符创建 token（如果该位置不在已有节点中）
          for (let i = 0; i < runLength; i++) {
            if (!TextFormatter.isInTree(tree, index + i, index + i)) {
              emphasisTokens.push({ index: index + i, run: emphasisRuns.length });
            }
          }

          // 记录 run 的属性
          emphasisRuns.push({
            type: seq[cur] as EmphasisDelimiterType,
            size: runLength,
            open: isOpen,
            close: isClosed,
            both: isOpen && isClosed,
          });

          index += runLength;
          prev = cur;
          cur = next;
          next = cur + 1;
        }

        // 回退 lastIndex，因为捕获组 3 的字符需要被下一次匹配重新考虑
        TextFormatter.EMPHASIS_REGEXP.lastIndex -= seq[seq.length - 1].length;
      }

      // 使用栈结构匹配成对的 emphasis 开/闭标记
      const emphasisStack: EmphasisDelimiter[] = [];
      let stackMatch: number;
      for (let i = 0; i < emphasisTokens.length; i++) {
        const delimiter = emphasisTokens[i];
        const run = emphasisRuns[delimiter.run];

        // 如果是闭标记，尝试在栈中找到匹配的开标记
        if (run.close && (stackMatch = TextFormatter.findOpenEmphasis(delimiter, run, emphasisRuns, emphasisStack)) > -1) {
          // 根据开标记的类型决定节点类型（Asterisk 或 Underscore）
          const openRun = emphasisRuns[emphasisStack[stackMatch].run];
          TextFormatter.insertIntoTree(tree, {
            type: openRun.type === EmphasisDelimiterType.Asterisk ? NodeType.Asterisk : NodeType.Underscore,
            start: emphasisStack[stackMatch].index,
            end: delimiter.index,
            contains: [],
          });
          // 从栈中移除已匹配的开标记
          emphasisStack.splice(stackMatch);
        } else if (run.open) {
          // 如果是开标记，压入栈等待匹配的闭标记
          emphasisStack.push(delimiter);
        }
      }

      // 合并嵌套的 emphasis（将 * 嵌套在 * 中转为 **）
      TextFormatter.combineNestedEmphasis(tree);
    }

    /* ---------- 生成 HTML ---------- */
    const html: string[] = [];
    let nextHtmlIndex = 0;

    // 递归遍历 AST 生成 HTML
    const rec = (node: Node): void => {
      // 输出节点之前的未覆盖文本（HTML 转义后输出）
      if (nextHtmlIndex < node.start) {
        html.push(escapeHtml(input.substring(nextHtmlIndex, node.start)));
      }

      switch (node.type) {
        case NodeType.Asterisk:
        case NodeType.Underscore:
          // 单星号/下划线：斜体 <em>
          nextHtmlIndex = node.start + 1;
          html.push('<em>');
          node.contains.forEach(rec);
          if (nextHtmlIndex < node.end) {
            html.push(escapeHtml(input.substring(nextHtmlIndex, node.end)));
          }
          html.push('</em>');
          break;
        case NodeType.DoubleAsterisk:
        case NodeType.DoubleUnderscore:
          // 双星号/下划线：粗体 <strong>
          nextHtmlIndex = node.start + 2;
          html.push('<strong>');
          node.contains.forEach(rec);
          if (nextHtmlIndex < node.end - 1) {
            html.push(escapeHtml(input.substring(nextHtmlIndex, node.end - 1)));
          }
          html.push('</strong>');
          break;
        case NodeType.Plain:
          // 纯文本（反斜杠转义后的字符）
          html.push(escapeHtml(node.value));
          break;
        case NodeType.Code:
          // 代码块 <code>
          html.push('<code>', escapeHtml(node.value), '</code>');
          break;
        case NodeType.CommitHash:
          // 提交哈希内部链接（<span class="internalUrl" data-type="commit">）
          html.push(
            '<span class="', CLASS_INTERNAL_URL, '" data-type="commit" data-value="',
            escapeHtml(node.commit), '" tabindex="-1">',
            escapeHtml(input.substring(node.start, node.end + 1)),
            '</span>',
          );
          break;
        case NodeType.Url:
          // URL 超链接（<a class="externalUrl">）
          html.push(
            '<a class="', CLASS_EXTERNAL_URL, '" href="',
            escapeHtml(node.url), '" tabindex="-1">',
            escapeHtml(node.displayText),
            '</a>',
          );
          break;
        case NodeType.Emoji:
          // Emoji 字符（直接输出，无需转义）
          html.push(node.emoji);
          break;
        case NodeType.Root:
          // 根节点：不输出任何标签，只递归处理子节点
          node.contains.forEach(rec);
          break;
      }
      nextHtmlIndex = node.end + 1;
    };

    // 从根节点的子节点开始递归
    tree.contains.forEach(rec);

    // 输出最后一个节点之后的剩余文本
    if (nextHtmlIndex < input.length) {
      html.push(escapeHtml(input.substring(nextHtmlIndex)));
    }

    return html.join('');
  }

  /**
   * 注册用户自定义的 emoji 映射
   *
   * 将用户提供的自定义 emoji shortcode 到 emoji 字符的映射合并到内置映射表中。
   * shortcode 格式必须为 :name:（如 :custom_emoji:）。
   *
   * @param mappings - 自定义映射数组，每项包含 shortcode（如 ":sparkles:"）和 emoji（如 "✨"）
   */
  public static registerCustomEmojiMappings(mappings: ReadonlyArray<{ shortcode: string; emoji: string }>): void {
    // 验证 shortcode 格式的正则表达式（必须为 :name: 格式）
    const validShortcodeRegExp = /^:[A-Za-z0-9-_]+:$/;
    for (let i = 0; i < mappings.length; i++) {
      if (validShortcodeRegExp.test(mappings[i].shortcode)) {
        // 去掉首尾的冒号，将 shortcode 作为键存入映射表
        const key = mappings[i].shortcode.substring(1, mappings[i].shortcode.length - 1);
        EMOJI_MAPPINGS[key] = mappings[i].emoji;
      }
    }
  }

  /**
   * 在栈中查找匹配的开 emphasis 标记
   *
   * 从栈顶向下查找，找到第一个满足条件的开标记：
   *   1. 不是同一个 run（避免自匹配）
   *   2. 类型相同（* 配 *，_ 配 _）
   *   3. 满足 CommonMark 规范的 emphasis 嵌套规则
   *
   * @param delimiter - 闭 emphasis 标记
   * @param run - 闭标记所属的 run
   * @param runs - 所有 run 的数组
   * @param stack - 开标记栈
   * @returns 匹配的开标记在栈中的索引，未找到返回 -1
   */
  private static findOpenEmphasis(
    delimiter: EmphasisDelimiter,
    run: EmphasisRun,
    runs: EmphasisRun[],
    stack: EmphasisDelimiter[],
  ): number {
    let i = stack.length - 1;
    while (i >= 0) {
      const stackRun = runs[stack[i].run];
      // 检查类型相同且满足 CommonMark 嵌套规则
      if (
        stack[i].run !== delimiter.run &&
        stackRun.type === run.type &&
        (
          // 如果两者都不是 both，或者两者的 size 之和不是 3 的倍数，则可以匹配
          !(stackRun.both || run.both) ||
          (stackRun.size + run.size) % 3 !== 0 ||
          (stackRun.size % 3 === 0 && run.size % 3 === 0)
        )
      ) {
        return i;
      }
      i--;
    }
    return -1;
  }

  /**
   * 递归合并嵌套的 emphasis
   *
   * 遍历 AST，将直接嵌套的相同类型 emphasis 合并为双 emphasis：
   *   * *text* * → **text**
   *   _ _text_ _ → __text__
   *
   * 合并条件：
   *   1. 节点只有一个子节点
   *   2. 节点和子节点类型相同（都是 Asterisk 或都是 Underscore）
   *   3. 节点的 start+1 等于子节点的 start
   *   4. 子节点的 end 等于节点的 end-1
   *
   * @param tree - 要遍历的 AST 节点
   */
  private static combineNestedEmphasis(tree: Node): void {
    // 递归处理所有子节点
    tree.contains.forEach(TextFormatter.combineNestedEmphasis);

    // 检查是否可以合并：单子节点 + 类型相同 + 位置连续
    if (
      tree.contains.length === 1 &&
      tree.type === tree.contains[0].type &&
      (tree.type === NodeType.Asterisk || tree.type === NodeType.Underscore) &&
      tree.start + 1 === tree.contains[0].start &&
      tree.contains[0].end === tree.end - 1
    ) {
      // 升级节点类型：Asterisk → DoubleAsterisk，Underscore → DoubleUnderscore
      tree.type = tree.type === NodeType.Asterisk
        ? NodeType.DoubleAsterisk
        : NodeType.DoubleUnderscore;
      // 用子节点的 contains 替换当前节点的 contains
      tree.contains = tree.contains[0].contains;
    }
  }

  /**
   * 将节点插入到 AST 中（允许嵌套）
   *
   * 根据节点的 start 和 end 位置，将节点插入到合适的位置：
   *   - 如果节点包含所有现有子节点，将现有子节点作为新节点的子节点
   *   - 如果节点不包含任何子节点，直接添加到末尾或开头
   *   - 否则，将节点包含的子节点提取出来作为新节点的子节点
   *
   * 此方法用于 Code 和 Emphasis 节点，这些节点可以包含其他节点（嵌套结构）。
   *
   * @param tree - 目标 AST 节点
   * @param node - 要插入的节点
   */
  private static insertIntoTree(tree: Node, node: Node): void {
    let firstChildIndexOfNode = -1;
    let lastChildIndexOfNode = -1;
    let curNode: Node;

    // 遍历现有子节点，找到新节点包含的子节点范围
    for (let i = 0; i < tree.contains.length; i++) {
      curNode = tree.contains[i];
      if (node.start < curNode.start && firstChildIndexOfNode === -1) {
        firstChildIndexOfNode = i;
      }
      if (curNode.end < node.end) {
        lastChildIndexOfNode = i;
      } else {
        break;
      }
    }

    if (firstChildIndexOfNode === -1) {
      // 新节点不包含任何现有子节点（在所有子节点之后）：添加到末尾
      tree.contains.push(node);
    } else if (lastChildIndexOfNode === -1) {
      // 新节点不包含任何现有子节点（在所有子节点之前）：添加到开头
      tree.contains.unshift(node);
    } else {
      // 新节点包含一些现有子节点：提取这些子节点作为新节点的子节点
      node.contains = tree.contains.slice(firstChildIndexOfNode, lastChildIndexOfNode + 1);
      // 用新节点替换被提取的子节点
      tree.contains.splice(
        firstChildIndexOfNode,
        lastChildIndexOfNode - firstChildIndexOfNode + 1,
        node,
      );
    }
  }

  /**
   * 将节点插入到 AST 中（仅在无重叠时插入）
   *
   * 与 insertIntoTree 不同，此方法会检查新节点是否与现有子节点重叠：
   *   - 如果重叠，拒绝插入（直接返回）
   *   - 如果不重叠，按 start 位置有序插入
   *
   * 此方法用于 URL、Issue Link、Commit Hash、Emoji 和 Backslash Escape 节点，
   * 这些节点不应该与其他节点重叠（但可以包含在 Code 或 Emphasis 节点内）。
   *
   * 重叠判断条件（满足任一即重叠）：
   *   - 现有节点包含新节点的 start
   *   - 现有节点包含新节点的 end
   *   - 新节点完全包含现有节点
   *
   * @param tree - 目标 AST 根节点
   * @param node - 要插入的节点
   */
  private static insertIntoTreeIfNoOverlap(tree: RootNode, node: Node): void {
    let curNode: Node;
    let insertAtIndex = tree.contains.length;

    for (let i = 0; i < tree.contains.length; i++) {
      curNode = tree.contains[i];
      // 检查重叠
      if (
        (curNode.start <= node.start && node.start <= curNode.end) ||
        (curNode.start <= node.end && node.end <= curNode.end) ||
        (node.start <= curNode.start && curNode.end <= node.end)
      ) {
        // 重叠：拒绝插入
        return;
      } else if (node.end < curNode.start) {
        // 不重叠且新节点在当前节点之前：记录插入位置
        insertAtIndex = i;
        break;
      }
    }

    // 在合适的位置插入新节点（保持按 start 排序）
    tree.contains.splice(insertAtIndex, 0, node);
  }

  /**
   * 检查指定范围是否与 AST 中的节点重叠
   *
   * 用于 emphasis 解析时判断 emphasis 字符位置是否已被其他节点占用
   * （例如在代码块内的 * 不应该被解析为 emphasis）。
   *
   * @param tree - 目标 AST 根节点
   * @param start - 范围起始位置
   * @param end - 范围结束位置
   * @returns true 表示有重叠，false 表示无重叠
   */
  private static isInTree(tree: RootNode, start: number, end: number): boolean {
    return tree.contains.some(
      (node) =>
        (node.start <= start && start <= node.end) ||
        (node.start <= end && end <= node.end) ||
        (start <= node.start && node.end <= end),
    );
  }
}

/* ========================================================================== *
 * 第七部分：便捷函数（向后兼容 + 主入口）
 * ========================================================================== */

/**
 * 格式化单行文本（主入口函数）
 *
 * 这是文本格式化的便捷主入口，内部创建 TextFormatter 实例并调用 format 方法。
 * 适用于不需要复用 TextFormatter 实例的场景。
 *
 * @param text - 输入的纯文本
 * @param config - 格式化配置（可选，默认从 configService 读取）
 * @returns 格式化后的 HTML 字符串
 */
export function formatLine(text: string, config?: FormatLineConfig): string {
  // 如果输入为空，直接返回空字符串
  if (!text) return '';

  // 如果未提供配置，从 configService 读取默认配置
  const cfg = configService.getAppConfig();
  const issueLinkingEnabled = config?.issueLinking !== undefined ? true : cfg.issueLinking;
  const emojiEnabled = config?.emoji ?? false;
  const markdownEnabled = config?.markdown ?? cfg.markdown;
  const urlsEnabled = config?.urls ?? true;
  const commitsEnabled = config?.commits ?? false;

  // 构建 issueLinking 配置
  let issueLinkingConfig: IssueLinkingConfig | null = null;
  if (issueLinkingEnabled) {
    if (config?.issueLinking) {
      // 使用传入的配置
      issueLinkingConfig = config.issueLinking;
    } else {
      // 从 configService 读取
      issueLinkingConfig = {
        regex: cfg.issueLinkingPattern,
        urlTemplate: cfg.issueLinkingUrl,
      };
    }
  }

  // 创建 TextFormatter 实例并格式化
  const formatter = new TextFormatter(config?.commitsList ?? [], {
    commits: commitsEnabled,
    emoji: emojiEnabled,
    issueLinking: issueLinkingEnabled,
    issueLinkingConfig: issueLinkingConfig,
    markdown: markdownEnabled,
    multiline: false,
    urls: urlsEnabled,
  });

  return formatter.format(text);
}

/**
 * 格式化提交消息（向后兼容函数）
 *
 * 此函数保持与 Task 7.5 版本的兼容性，被 commit-graph.ts 和 commit-detail.ts 使用。
 * 默认启用 Issue Linking（从 configService 读取配置），可选启用 Markdown 和 Emoji。
 *
 * @param message - 原始提交消息文本
 * @param options - 可选的格式化选项（如果未提供，从 configService 读取）
 * @returns 格式化后的 HTML 字符串（可安全插入 DOM）
 */
export function formatCommitMessage(
  message: string,
  options?: {
    /** 是否启用 Issue Linking（默认从 configService 读取） */
    issueLinking?: boolean;
    /** Issue 正则表达式（默认从 configService 读取） */
    issueLinkingPattern?: string;
    /** Issue URL 模板（默认从 configService 读取） */
    issueLinkingUrl?: string;
  },
): string {
  // 如果输入为空，直接返回空字符串
  if (!message) return '';

  // 从 configService 读取默认配置
  const cfg = configService.getAppConfig();
  const issueLinkingEnabled = options?.issueLinking ?? cfg.issueLinking;
  const issueLinkingPattern = options?.issueLinkingPattern ?? cfg.issueLinkingPattern;
  const issueLinkingUrl = options?.issueLinkingUrl ?? cfg.issueLinkingUrl;

  // 构建 issueLinking 配置
  let issueLinkingConfig: IssueLinkingConfig | null = null;
  if (issueLinkingEnabled && issueLinkingPattern && issueLinkingUrl) {
    issueLinkingConfig = {
      regex: issueLinkingPattern,
      urlTemplate: issueLinkingUrl,
    };
  }

  // 使用 formatLine 进行格式化
  // 从 configService 读取 markdown 和 emoji 配置（Task 11.2：集成完整格式化）
  // urls 和 commits 在 commit-graph 表格中不启用（避免单行消息中出现可点击的 URL）
  return formatLine(message, {
    issueLinking: issueLinkingConfig ?? undefined,
    emoji: cfg.markdown, // emoji 仅在启用 markdown 时才启用（与 gitgraph 行为一致）
    markdown: cfg.markdown,
    urls: false,
    commits: false,
  });
}

/**
 * 格式化提交消息（仅 Issue Linking，不从 configService 读取配置）
 *
 * 此函数适用于需要显式指定 Issue Linking 配置的场景
 * （如仓库级配置覆盖全局配置时）。
 * 注意：此函数不启用 Markdown 和 Emoji，仅做 HTML 转义 + Issue Linking。
 *
 * @param message - 原始提交消息文本
 * @param issueLinking - Issue Linking 配置（null 表示禁用）
 * @returns 格式化后的 HTML 字符串
 */
export function formatCommitMessageWithIssueLinking(
  message: string,
  issueLinking: { pattern: string; url: string } | null,
): string {
  // 如果输入为空，直接返回空字符串
  if (!message) return '';

  // 如果未提供配置，仅做 HTML 转义
  if (!issueLinking) {
    return formatLine(message, {
      emoji: false,
      markdown: false,
      urls: false,
      commits: false,
    });
  }

  // 使用提供的配置进行格式化（仅 Issue Linking，不启用其他格式化）
  return formatLine(message, {
    issueLinking: {
      regex: issueLinking.pattern,
      urlTemplate: issueLinking.url,
    },
    emoji: false,
    markdown: false,
    urls: false,
    commits: false,
  });
}
