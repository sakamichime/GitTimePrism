/*
 * 文件图标服务模块（File Icon Service）
 *
 * 此模块的作用：
 * 根据一个文件路径（例如 "src/main.ts" 或 "package.json"），
 * 找到对应的 vscode-icons 风格 SVG 图标，并返回这个图标的 URL，
 * 这样前端就可以用 <img src="返回的URL"> 把图标显示出来。
 *
 * 工作原理概述（让不会编程的人也能看懂）：
 * 1. 启动时，用 Vite 提供的 import.meta.glob 工具，把
 *    src/assets/icons/file-types/ 文件夹下的所有 SVG 图片一次性"打包"进来，
 *    得到每个 SVG 在运行时对应的 URL。
 *    这些 SVG 文件名有固定规律，例如：
 *      - file_type_typescript.svg  表示"TypeScript 文件"的图标
 *      - folder_type_src.svg       表示名为 src 的文件夹的"关闭状态"图标
 *      - folder_type_src_opened.svg 表示名为 src 的文件夹的"打开状态"图标
 *      - default_file.svg          表示找不到匹配时的默认文件图标
 *      - default_folder.svg        表示找不到匹配时的默认文件夹图标
 *    我们把文件名中的关键部分（如 "typescript"、"src"）提取出来作为"图标名"，
 *    建立"图标名 -> URL"的对照表，方便后面快速查找。
 *
 * 2. 同时读取 src/data/vscode-icons-manifest.json 这个清单文件，
 *    它列出了"哪种扩展名/文件名应该用哪个图标"。
 *    例如它告诉我们扩展名 "ts" 用 "typescript" 图标，
 *    文件名 "package.json" 用 "npm" 图标。
 *    我们把这个清单整理成几张查找表，方便后面按扩展名或文件名快速找到图标名。
 *
 * 3. 当外部代码调用 getFileIconUrl("src/main.ts") 时：
 *    - 先取出文件名 "main.ts"
 *    - 先尝试用完整文件名查找（看是不是像 package.json 这种特殊文件）
 *    - 再尝试用 glob 模式查找（处理类似 package-xxx.json 的情况）
 *    - 再用扩展名 "ts" 查找，命中 typescript 图标
 *    - 最后如果都找不到，返回默认文件图标
 *
 * 4. 当外部代码调用 getFolderIconUrl("src", true) 时：
 *    - 在清单的 folders 部分查找名为 "src" 的文件夹配置
 *    - 找到后，根据 isOpen 决定用关闭版还是打开版的图标
 *
 * 使用方式：
 * ```typescript
 * import { fileIconService } from './services/file-icon-service';
 * const url = fileIconService.getFileIconUrl('src/main.ts');
 * // 把 url 放到 <img src={url}> 中即可显示图标
 * ```
 */

// 引入 Vite 的类型定义，让 TypeScript 认识 import.meta.glob 这个语法
/// <reference types="vite/client" />

// 引入 vscode-icons 的清单数据（一个 JSON 文件，列出了扩展名/文件名到图标的对应关系）
// 因为 tsconfig.json 已经开启了 "resolveJsonModule": true，所以可以直接 import JSON
import manifestData from '../data/vscode-icons-manifest.json';

/* ========================================================================== *
 * 第一部分：类型定义
 * 描述清单 JSON 文件的数据结构，让 TypeScript 知道每个字段是什么意思
 * ========================================================================== */

/**
 * 清单中单个"文件类型条目"的结构
 * 例如：
 * {
 *   "icon": "typescript",        // 用哪个图标（对应 file_type_typescript.svg）
 *   "extensions": ["ts"],        // 哪些扩展名用这个图标（当 filename 为 false 时）
 *   "filename": false,           // true 表示 extensions 里写的是完整文件名，false 表示是扩展名
 *   "filenamesGlob": [],         // 文件名主干通配（如 ["package"] 表示匹配 package.json/package-lock.json 等）
 *   "extensionsGlob": ["json"],  // 与 filenamesGlob 配合使用，限定扩展名
 *   "languages": ["typescript"]  // 关联的编程语言 ID（会去 languages 对象里查已知扩展名）
 * }
 */
interface ManifestFileEntry {
  /** 图标名（对应 file_type_<icon>.svg 文件） */
  icon: string;
  /** 扩展名或文件名列表（具体含义看 filename 字段） */
  extensions: string[];
  /** true 表示 extensions 里是完整文件名；false 表示是扩展名 */
  filename: boolean;
  /** 文件名主干通配模式列表 */
  filenamesGlob: string[];
  /** 与 filenamesGlob 配合使用的扩展名限定列表 */
  extensionsGlob: string[];
  /** 关联的编程语言 ID 列表 */
  languages: string[];
}

/**
 * 清单中单个"文件夹类型条目"的结构
 * 例如：{ "icon": "src", "extensions": ["src", "source"] }
 * 表示名为 src 或 source 的文件夹，都用 folder_type_src.svg 图标
 */
interface ManifestFolderEntry {
  /** 文件夹图标名（对应 folder_type_<icon>.svg） */
  icon: string;
  /** 哪些文件夹名用这个图标 */
  extensions: string[];
}

/**
 * 清单中"语言信息"的结构
 * 描述某种编程语言已知的扩展名和文件名
 */
interface ManifestLanguage {
  /** 语言 ID 列表 */
  ids: string[];
  /** 该语言已知的扩展名（如 ["ts"]，可能带点也可能不带） */
  knownExtensions: string[];
  /** 该语言已知的完整文件名 */
  knownFilenames: string[];
}

/**
 * 整个清单 JSON 文件的顶层结构
 */
interface IconManifest {
  /** 默认图标名（找不到匹配时使用） */
  defaults: { file: string; folder: string };
  /** 文件类型条目列表 */
  files: ManifestFileEntry[];
  /** 文件夹类型条目列表 */
  folders: ManifestFolderEntry[];
  /** 各语言信息（键是语言 ID） */
  languages: Record<string, ManifestLanguage>;
}

/* ========================================================================== *
 * 第二部分：加载 SVG 资源，构建"图标名 -> URL"对照表
 * ========================================================================== */

/**
 * 用 Vite 的 import.meta.glob 一次性导入所有 SVG 文件，并取得它们的运行时 URL。
 * - eager: true      表示在模块加载时就立即导入（而不是懒加载）
 * - query: '?url'    表示把文件当作 URL 来导入（返回字符串 URL，而非文件内容）
 * - import: 'default' 表示取模块的默认导出（即 URL 字符串）
 *
 * 返回值形如：
 * {
 *   '/src/assets/icons/file-types/file_type_typescript.svg': '/assets/file_type_typescript-abc123.svg',
 *   '/src/assets/icons/file-types/folder_type_src.svg':       '/assets/folder_type_src-def456.svg',
 *   ...
 * }
 * 其中 key 是文件路径，value 是打包后的 URL（前端 <img src> 能直接用）。
 */
const svgModules = import.meta.glob(
  '/src/assets/icons/file-types/*.svg',
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

/**
 * 文件图标对照表：图标名 -> URL
 * 例如 fileIconUrlMap['typescript'] = '/assets/file_type_typescript-abc123.svg'
 */
const fileIconUrlMap: Record<string, string> = {};

/**
 * 文件夹图标对照表：图标名 -> { closed: 关闭态URL, opened?: 打开态URL }
 * 例如 folderIconUrlMap['src'] = { closed: '...', opened: '...' }
 * opened 是可选的，因为有些文件夹图标可能没有打开态版本
 */
const folderIconUrlMap: Record<string, { closed: string; opened?: string }> = {};

/**
 * 默认文件图标 URL（找不到任何匹配时使用）
 */
let defaultFileUrl: string = '';

/**
 * 默认文件夹图标 URL（找不到任何匹配时使用）
 */
let defaultFolderUrl: string = '';

/**
 * 遍历所有导入的 SVG 文件路径，按文件名规律分类填入上面的对照表
 * 这是一个一次性执行的初始化过程
 */
function buildIconUrlMaps(): void {
  // 取出所有 SVG 文件路径
  const allPaths = Object.keys(svgModules);

  for (const fullPath of allPaths) {
    // 从完整路径中取出文件名部分，例如 "file_type_typescript.svg"
    const fileName = fullPath.split('/').pop() ?? '';
    // 取出对应的 URL
    const url = svgModules[fullPath];

    // 处理默认文件图标：default_file.svg
    if (fileName === 'default_file.svg') {
      defaultFileUrl = url;
      continue;
    }

    // 处理默认文件夹图标：default_folder.svg
    if (fileName === 'default_folder.svg') {
      defaultFolderUrl = url;
      continue;
    }

    // 注意：default_folder_opened.svg、default_root_folder.svg、
    // default_root_folder_opened.svg 等根/默认文件夹的打开态图标
    // 不在本次任务范围内（getFolderIconUrl 仅回退到 defaultFolderUrl），
    // 因此这里忽略它们，不做处理。

    // 处理文件类型图标：file_type_<icon>.svg
    if (fileName.startsWith('file_type_') && fileName.endsWith('.svg')) {
      // 去掉 "file_type_" 前缀（10 个字符）和 ".svg" 后缀（4 个字符）
      const iconName = fileName.slice('file_type_'.length, -'.svg'.length);
      fileIconUrlMap[iconName] = url;
      continue;
    }

    // 处理文件夹类型图标：folder_type_<icon>.svg 或 folder_type_<icon>_opened.svg
    if (fileName.startsWith('folder_type_') && fileName.endsWith('.svg')) {
      // 先去掉 "folder_type_" 前缀和 ".svg" 后缀，得到中间部分
      // 例如 "folder_type_src_opened.svg" -> "src_opened"
      // 例如 "folder_type_src.svg" -> "src"
      const middle = fileName.slice('folder_type_'.length, -'.svg'.length);

      // 判断是否是"打开态"图标（以 "_opened" 结尾）
      if (middle.endsWith('_opened')) {
        // 去掉 "_opened" 后缀（7 个字符），得到真正的图标名
        const iconName = middle.slice(0, -'_opened'.length);
        // 在对照表中确保该图标名已有条目，再填入 opened 字段
        if (!folderIconUrlMap[iconName]) {
          folderIconUrlMap[iconName] = { closed: '', opened: url };
        } else {
          folderIconUrlMap[iconName].opened = url;
        }
      } else {
        // 普通关闭态图标
        const iconName = middle;
        if (!folderIconUrlMap[iconName]) {
          folderIconUrlMap[iconName] = { closed: url };
        } else {
          folderIconUrlMap[iconName].closed = url;
        }
      }
    }
  }
}

// 模块加载时立即执行一次，把对照表填好
buildIconUrlMaps();

/* ========================================================================== *
 * 第三部分：解析清单 JSON，构建"扩展名/文件名 -> 图标名"查找表
 * ========================================================================== */

// 把导入的 JSON 数据断言为结构化类型，方便后续访问字段
const manifest = manifestData as unknown as IconManifest;

/**
 * 扩展名 -> 图标名 的映射表（仅当 filename === false 的条目）
 * 例如 extensionMap.get('ts') === 'typescript'
 */
const extensionMap = new Map<string, string>();

/**
 * 完整文件名 -> 图标名 的映射表（仅当 filename === true 的条目）
 * 例如 filenameMap.get('package.json') === 'npm'
 */
const filenameMap = new Map<string, string>();

/**
 * 文件名通配条目列表
 * 每一项形如：{ icon: 'npm', filenamesGlob: ['package'], extensionsGlob: ['json'] }
 * 用于处理像 package.json、package-lock.json 这种"主干 + 扩展名"的匹配
 */
const filenamesGlobList: Array<{
  /** 命中后使用的图标名 */
  icon: string;
  /** 文件名主干通配模式列表（文件名以其中某个字符串开头视为命中主干） */
  filenamesGlob: string[];
  /** 限定的扩展名列表（为空表示不限扩展名） */
  extensionsGlob: string[];
}> = [];

/**
 * 语言扩展名 -> 图标名 的映射表
 * 例如某些条目只声明了 languages: ['typescript']，没有直接写 extensions，
 * 这时要去 manifest.languages['typescript'].knownExtensions 里查实际的扩展名
 */
const languageExtensionsMap = new Map<string, string>();

/**
 * 遍历清单的 files 数组，把每一条信息拆分填入上面的几张查找表
 * 这也是一次性执行的初始化过程
 */
function buildManifestMaps(): void {
  for (const entry of manifest.files) {
    // 情况 1：filename === true，说明 extensions 里写的是完整文件名
    if (entry.filename) {
      for (const name of entry.extensions) {
        filenameMap.set(name.toLowerCase(), entry.icon);
      }
    } else {
      // 情况 2：filename === false，说明 extensions 里写的是扩展名
      for (const ext of entry.extensions) {
        extensionMap.set(ext.toLowerCase(), entry.icon);
      }
    }

    // 如果该条目有 filenamesGlob，加入通配列表
    if (entry.filenamesGlob.length > 0) {
      filenamesGlobList.push({
        icon: entry.icon,
        filenamesGlob: entry.filenamesGlob,
        extensionsGlob: entry.extensionsGlob,
      });
    }

    // 如果该条目声明了 languages，去 languages 对象里查每种语言的已知扩展名，
    // 把这些扩展名映射到当前条目的图标
    for (const langId of entry.languages) {
      const langInfo = manifest.languages[langId];
      if (!langInfo) {
        continue; // 找不到该语言的信息就跳过
      }
      for (const ext of langInfo.knownExtensions) {
        // knownExtensions 可能写成 ".ts"（带点）或 "ts"（不带点）
        // 统一去掉前导点，并转小写
        const normalized = ext.replace(/^\./, '').toLowerCase();
        languageExtensionsMap.set(normalized, entry.icon);
      }
    }
  }
}

// 模块加载时立即执行一次，把查找表填好
buildManifestMaps();

/* ========================================================================== *
 * 第四部分：FileIconService 服务类实现
 * ========================================================================== */

/**
 * 文件图标服务
 *
 * 对外提供两个方法：
 * - getFileIconUrl(filePath)  根据文件路径返回文件图标的 URL
 * - getFolderIconUrl(name)    根据文件夹名返回文件夹图标的 URL
 *
 * 内部依赖前面构建好的几张查找表，按优先级顺序逐级匹配。
 */
export class FileIconService {
  /**
   * 根据文件路径返回 SVG 图标的 URL（可用于 <img src>）
   *
   * 匹配优先级（从高到低）：
   * 1. 完整文件名匹配（如 package.json -> npm 图标）
   * 2. glob 模式匹配（如 filenamesGlob=['package'] 匹配 package-xxx.json）
   * 3. 扩展名匹配（如 ts -> typescript 图标）
   * 4. 语言扩展名匹配（从 languages 已知扩展名里查）
   * 5. 都没命中，返回默认文件图标
   *
   * @param filePath 文件路径，可以是 "src/main.ts"、"package.json" 等形式
   * @returns 图标的 URL 字符串
   */
  getFileIconUrl(filePath: string): string {
    // 第 0 步：从路径中提取纯文件名（取最后一段）
    // 例如 "src/main.ts" -> "main.ts"，"package.json" -> "package.json"
    // 用 split 把路径按 / 或 \ 切开，取最后一段；这样能兼容 Windows 和 Unix 路径
    const normalizedPath = filePath.replace(/\\/g, '/');
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    const fileName = lastSlashIndex >= 0
      ? normalizedPath.slice(lastSlashIndex + 1)
      : normalizedPath;

    // 如果连文件名都没有（比如传入空字符串），直接返回默认图标
    if (!fileName) {
      return defaultFileUrl;
    }

    const fileNameLower = fileName.toLowerCase();

    // 第 1 步：尝试完整文件名匹配
    // 例如文件名 "package.json" 在 filenameMap 中能查到 "npm"
    const matchedByFilename = filenameMap.get(fileNameLower);
    if (matchedByFilename) {
      const url = fileIconUrlMap[matchedByFilename];
      if (url) {
        return url;
      }
      // 即使清单里写了用某图标，但如果对应 SVG 不存在，就继续往下找
    }

    // 第 2 步：尝试 glob 模式匹配
    // 遍历所有通配条目，看文件名是否命中某个 filenamesGlob 主干
    for (const globEntry of filenamesGlobList) {
      // 检查文件名是否以某个主干开头（例如 "package" 能匹配 "package.json"、"package-lock.json"）
      const stemMatched = globEntry.filenamesGlob.some((stem) =>
        fileNameLower.startsWith(stem.toLowerCase()),
      );
      if (!stemMatched) {
        continue; // 主干没命中，跳过这条
      }

      // 如果该通配条目还限定了扩展名，需要进一步检查文件扩展名是否在限定范围内
      if (globEntry.extensionsGlob.length > 0) {
        const ext = getFileExtension(fileNameLower);
        const extMatched = globEntry.extensionsGlob.some((allowedExt) =>
          ext === allowedExt.toLowerCase(),
        );
        if (!extMatched) {
          continue; // 扩展名不在限定范围，跳过这条
        }
      }

      // 主干和扩展名都满足，命中此条
      const url = fileIconUrlMap[globEntry.icon];
      if (url) {
        return url;
      }
    }

    // 第 3 步：尝试扩展名匹配
    const ext = getFileExtension(fileNameLower);
    if (ext) {
      const matchedByExt = extensionMap.get(ext);
      if (matchedByExt) {
        const url = fileIconUrlMap[matchedByExt];
        if (url) {
          return url;
        }
      }

      // 第 4 步：尝试语言扩展名匹配
      const matchedByLang = languageExtensionsMap.get(ext);
      if (matchedByLang) {
        const url = fileIconUrlMap[matchedByLang];
        if (url) {
          return url;
        }
      }
    }

    // 第 5 步：都没命中，返回默认文件图标
    return defaultFileUrl;
  }

  /**
   * 根据文件夹名返回文件夹 SVG 图标 URL
   *
   * @param folderName 文件夹名（如 "src"、"components"）
   * @param isOpen 是否为打开状态（true 用打开态图标，false 用关闭态图标），默认 false
   * @returns 图标的 URL 字符串
   */
  getFolderIconUrl(folderName: string, isOpen: boolean = false): string {
    // 把文件夹名转小写，方便比较
    const folderLower = folderName.toLowerCase();

    // 在清单的 folders 数组中查找 extensions 包含该文件夹名的条目
    const entry = manifest.folders.find((f) =>
      f.extensions.some((ext) => ext.toLowerCase() === folderLower),
    );

    // 如果没找到匹配条目，icon 名默认用 'folder'（对应 default_folder.svg）
    // 注意：default_folder.svg 不在 folderIconUrlMap 里（它是默认图标），所以下面会回退到 defaultFolderUrl
    const iconName = entry?.icon ?? 'folder';

    // 如果是打开状态，且该图标有打开态版本，就用打开态
    if (isOpen && folderIconUrlMap[iconName]?.opened) {
      return folderIconUrlMap[iconName].opened as string;
    }

    // 否则用关闭态；如果关闭态也没有（例如默认 'folder' 没在表里），回退到默认文件夹图标
    return folderIconUrlMap[iconName]?.closed ?? defaultFolderUrl;
  }
}

/**
 * 从文件名中提取扩展名（最后一个点之后的部分，转小写）
 * 例如：
 *   "main.ts"    -> "ts"
 *   "index.html" -> "html"
 *   "README"     -> ""（没有点，返回空字符串）
 *   ".gitignore" -> "gitignore"（以点开头的隐藏文件，点之后视为扩展名）
 *
 * @param fileName 文件名（建议已转小写）
 * @returns 扩展名（不含点）；如果没有扩展名返回空字符串
 */
function getFileExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.');
  // 没有点，或者点在最后一个字符（如 "name."），都视为没有扩展名
  if (lastDotIndex <= 0 || lastDotIndex === fileName.length - 1) {
    return '';
  }
  return fileName.slice(lastDotIndex + 1);
}

/**
 * 文件图标服务的单例
 *
 * 全局共享一个实例即可，因为所有数据都是只读的查找表，没有可变状态。
 * 使用方式：
 * ```typescript
 * import { fileIconService } from './services/file-icon-service';
 * const url = fileIconService.getFileIconUrl('src/main.ts');
 * ```
 */
export const fileIconService: FileIconService = new FileIconService();
