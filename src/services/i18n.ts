/**
 * ============================================================
 * 国际化（i18n）服务模块（TypeScript 版本）
 * ============================================================
 *
 * 这个模块负责管理应用的多语言切换功能。
 * "i18n" 是 "internationalization"（国际化）的缩写，
 * 因为这个英文单词首字母 i 和末字母 n 之间有 18 个字母，所以简称 i18n。
 *
 * 工作原理：
 *   1. 语言包是 JSON 格式的文件，存放在 src/i18n/ 目录下
 *   2. 当前支持中文（zh-CN）和英文（en-US）两种语言
 *   3. 首次使用时自动检测系统语言，之后用户的选择会保存到 localStorage
 *   4. 其他模块通过 t('key.path') 函数获取翻译文本
 *   5. 支持模板变量替换，例如 t('hello', { name: '世界' }) => '你好，世界'
 *
 * 使用示例：
 *   import { t, setLocale } from '../services/i18n.js';
 *   t('toolbar.openRepo')  => '打开仓库'（中文环境下）
 *   t('common.ok')         => '确定'
 *   setLocale('en-US')      => 切换到英文
 * ============================================================
 */

/* ----- 当前使用的语言标识 ----- */
/* 默认使用中文，如果检测到系统语言是英文则自动切换 */
/* TypeScript 类型注解：string 表示这是一个字符串变量 */
let currentLocale: string = 'zh-CN';

/* ----- 语言包缓存 ----- */
/* 已经加载过的语言包会缓存在这个对象中，避免重复加载 */
/* 格式：{ 'zh-CN': { app: {...}, toolbar: {...}, ... }, 'en-US': {...} } */
/* TypeScript 类型注解：Record<string, any> 表示键是字符串、值是任意类型的对象 */
const locales: Record<string, any> = {};

/* ----- 语言变化监听器数组 ----- */
/* 当语言切换时，会通知所有注册的监听器函数 */
/* 这样各个 UI 组件可以在语言切换后更新显示的文字 */
/* TypeScript 类型注解：Array<(locale: string) => void> 表示这是一个函数数组，
 *   每个函数接收一个字符串参数（新语言标识），无返回值 */
const listeners: Array<(locale: string) => void> = [];

/* ----- 应用支持的语言列表 ----- */
/* 如果需要添加新语言，只需在这里和 i18n/ 目录下添加对应文件即可 */
const SUPPORTED_LOCALES: string[] = ['zh-CN', 'en-US'];

/* ----- localStorage 中保存语言偏好的键名 ----- */
const STORAGE_KEY: string = 'gittimeprism-locale';

/**
 * 初始化国际化服务
 *
 * 这个函数会在应用启动时调用一次，它的工作流程是：
 *   1. 先尝试从 localStorage 读取用户之前选择的语言
 *   2. 如果没有保存过，则检测操作系统的语言设置
 *   3. 将检测到的语言设置为当前语言
 *   4. 加载对应的语言包
 *
 * @returns {Promise<void>} 异步函数，无返回值
 */
export async function init(): Promise<void> {
  /* 第一步：检测应该使用哪种语言 */
  /* 优先使用用户之前保存的偏好，其次使用系统语言 */
  let locale: string | null = localStorage.getItem(STORAGE_KEY);

  if (!locale) {
    /* 如果 localStorage 中没有保存过语言偏好，则检测系统语言 */
    locale = detectSystemLocale();
  }

  /* 第二步：将检测到的语言标准化为支持的语言 */
  /* 例如系统语言是 zh-CN 就直接用，如果是 zh-TW 也会匹配到 zh-CN */
  locale = getSupportedLocale(locale);

  /* 第三步：设置当前语言并加载语言包 */
  await setLocale(locale);
}

/**
 * 获取翻译文本（核心函数）
 *
 * 通过"点号分隔的路径"从语言包中取出对应的翻译文本。
 * 例如 key 为 'toolbar.openRepo' 时：
 *   先找 toolbar 对象 -> 再找 openRepo 属性 -> 返回 '打开仓库'
 *
 * 还支持模板变量替换，用 {变量名} 的语法：
 *   语言包中: "welcome": "你好，{name}！"
 *   调用方式: t('welcome', { name: '小明' })
 *   返回结果: "你好，小明！"
 *
 * @param {string} key - 点号分隔的翻译键路径，如 'toolbar.openRepo'
 * @param {Record<string, string | number>} [params] - 可选的模板参数对象，用于替换文本中的 {变量}
 * @returns {string} 翻译后的文本。如果找不到翻译，则返回键名本身作为降级显示
 *
 * 使用示例：
 *   t('app.name')                    => 'GitTimePrism'
 *   t('toolbar.openRepo')            => '打开仓库'
 *   t('common.confirm')              => '确认'
 *   t('greeting', { name: '小明' })   => 根据语言包内容替换变量
 */
export function t(key: string, params?: Record<string, string | number>): string {
  /* 获取当前语言包 */
  const locale: Record<string, any> = locales[currentLocale];

  /* 如果语言包还没加载，直接返回键名 */
  if (!locale) {
    return key;
  }

  /* 将点号分隔的路径拆分成数组 */
  /* 例如 'toolbar.openRepo' 拆成 ['toolbar', 'openRepo'] */
  const keys: string[] = key.split('.');

  /* 沿着路径逐层深入查找，最终找到翻译文本 */
  let result: any = locale;
  for (const k of keys) {
    /* 如果某一级找不到（undefined 或 null），说明翻译键不存在 */
    if (result == null) {
      return key; /* 返回键名本身作为降级方案 */
    }
    result = result[k];
  }

  /* 如果最终结果是字符串，则进行模板变量替换 */
  if (typeof result === 'string') {
    /* 如果传入了参数对象，则把文本中的 {变量名} 替换为实际值 */
    if (params) {
      /* 使用正则表达式匹配所有 {变量名} 并替换 */
      /* \w+ 匹配一个或多个字母、数字或下划线 */
      return result.replace(/\{(\w+)\}/g, (match: string, paramName: string): string => {
        /* 如果参数对象中有这个变量，则替换为对应的值 */
        /* 如果没有，则保留原始的 {变量名} 不变 */
        return params[paramName] !== undefined ? String(params[paramName]) : match;
      });
    }
    return result;
  }

  /* 如果最终结果不是字符串（比如是数字或布尔值），转为字符串返回 */
  if (result != null) {
    return String(result);
  }

  /* 都没匹配到，返回键名本身 */
  return key;
}

/**
 * 切换当前语言
 *
 * 这个函数会：
 *   1. 加载新的语言包（如果还没缓存的话）
 *   2. 更新 currentLocale 为新语言
 *   3. 通知所有注册的监听器（让 UI 更新显示文字）
 *   4. 将用户的选择保存到 localStorage（下次打开应用时自动使用）
 *
 * @param {string} locale - 语言标识，如 'zh-CN' 或 'en-US'
 * @returns {Promise<void>} 异步函数，无返回值
 *
 * 使用示例：
 *   await setLocale('en-US')  => 切换到英文
 *   await setLocale('zh-CN')  => 切换到中文
 */
export async function setLocale(locale: string): Promise<void> {
  /* 标准化语言标识，确保是我们支持的语言 */
  locale = getSupportedLocale(locale);

  /* 如果已经加载了该语言包，直接跳过加载步骤 */
  if (!locales[locale]) {
    await loadLocale(locale);
  }

  /* 更新当前语言标识 */
  currentLocale = locale;

  /* 将用户的选择持久化到 localStorage */
  /* 这样下次打开应用时会自动使用上次选择的语言 */
  localStorage.setItem(STORAGE_KEY, locale);

  /* 通知所有监听器：语言已经切换了 */
  /* 监听器会收到新的语言标识作为参数 */
  for (const callback of listeners) {
    try {
      callback(locale);
    } catch (err) {
      /* 如果某个监听器抛出错误，不影响其他监听器的执行 */
      console.error(`[i18n] 语言切换监听器执行出错:`, err);
    }
  }
}

/**
 * 获取当前语言标识
 *
 * @returns {string} 当前语言标识，如 'zh-CN' 或 'en-US'
 *
 * 使用示例：
 *   getLocale()  => 'zh-CN'
 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * 注册语言变化监听器
 *
 * 当语言切换时，所有通过此函数注册的回调函数都会被调用。
 * 这对于需要根据语言更新显示内容的 UI 组件很有用。
 *
 * @param {Function} callback - 语言切换时的回调函数，接收新的语言标识作为参数
 * @returns {Function} 取消监听的函数，调用它即可移除这个监听器
 *
 * 使用示例：
 *   // 注册监听器
 *   const unsubscribe = onLocaleChange((newLocale) => {
 *     console.log('语言已切换为:', newLocale);
 *     updateUIText(); // 更新界面文字
 *   });
 *
 *   // 不再需要监听时，取消它
 *   unsubscribe();
 */
export function onLocaleChange(callback: (locale: string) => void): () => void {
  /* 将回调函数添加到监听器数组 */
  listeners.push(callback);

  /* 返回一个取消函数，调用它可以从监听器数组中移除这个回调 */
  /* TypeScript 类型注解：() => void 表示这是一个无参数、无返回值的函数 */
  return function unsubscribe(): void {
    /* 找到回调函数在数组中的位置 */
    const index: number = listeners.indexOf(callback);
    /* 如果找到了（index 不为 -1），则从数组中移除 */
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
}

/* ============================================================
 * 内部函数（不对外导出，仅供模块内部使用）
 * ============================================================ */

/**
 * 检测操作系统/浏览器的语言设置
 *
 * 读取浏览器的 navigator.language 属性来获取系统语言。
 * navigator.language 的返回值格式如 'zh-CN'、'en-US'、'ja' 等。
 *
 * @returns {string} 检测到的语言标识，如 'zh-CN' 或 'en-US'
 */
function detectSystemLocale(): string {
  /* navigator.language 返回浏览器首选语言 */
  /* 例如：中文系统返回 'zh-CN'，英文系统返回 'en-US' */
  return navigator.language || 'zh-CN';
}

/**
 * 将任意语言标识标准化为应用支持的语言
 *
 * 如果传入的语言是应用支持的，直接返回。
 * 如果不支持，尝试匹配语言的前缀（如 'zh' 匹配到 'zh-CN'）。
 * 如果都匹配不到，返回默认语言 'zh-CN'。
 *
 * @param {string} locale - 输入的语言标识
 * @returns {string} 标准化后的支持的语言标识
 *
 * 处理逻辑：
 *   'zh-CN'  => 'zh-CN'（完全匹配，直接返回）
 *   'en-US'  => 'en-US'（完全匹配，直接返回）
 *   'zh-TW'  => 'zh-CN'（前缀匹配，匹配到第一个 zh 开头的）
 *   'fr-FR'  => 'zh-CN'（不匹配，返回默认值）
 */
function getSupportedLocale(locale: string): string {
  /* 第一步：检查是否完全匹配某个支持的语言 */
  if (SUPPORTED_LOCALES.includes(locale)) {
    return locale;
  }

  /* 第二步：提取语言前缀（取 - 前面的部分） */
  /* 例如 'zh-CN' 的前缀是 'zh'，'en-US' 的前缀是 'en' */
  const prefix: string = locale.split('-')[0];

  /* 第三步：用前缀去匹配支持的语言 */
  for (const supported of SUPPORTED_LOCALES) {
    if (supported.startsWith(prefix)) {
      return supported; /* 找到匹配的就返回 */
    }
  }

  /* 第四步：都没有匹配到，返回默认的中文 */
  return 'zh-CN';
}

/**
 * 加载指定语言的语言包文件
 *
 * 使用动态 import() 从 i18n 目录加载 JSON 格式的语言包。
 * import() 是异步的，返回一个 Promise。
 * 加载成功后，语言包会被缓存在 locales 对象中。
 *
 * @param {string} locale - 要加载的语言标识，如 'zh-CN'
 * @returns {Promise<void>} 异步函数，无返回值
 *
 * 实现细节：
 *   使用 import(`../i18n/${locale}.json`) 动态导入语言包文件。
 *   这种写法叫做"动态导入"，Webpack 和 Vite 都支持。
 *   默认导出的 .default 就是 JSON 对象的内容。
 */
async function loadLocale(locale: string): Promise<void> {
  try {
    /* 动态导入对应语言包文件 */
    /* TypeScript 中使用动态 import 需要注意类型安全，
     * 这里通过 as any 来绕过 TypeScript 对动态模块路径的检查 */
    const module: any = await import(`../i18n/${locale}.json`);

    /* 将语言包内容缓存到 locales 对象中 */
    /* module.default 是 JSON 文件的默认导出内容 */
    locales[locale] = module.default;

    console.log(`[i18n] 已加载语言包: ${locale}`);
  } catch (err) {
    /* 加载失败时的错误处理 */
    console.error(`[i18n] 加载语言包失败: ${locale}`, err);

    /* 如果加载失败，使用空对象作为降级方案 */
    /* 这样 t() 函数调用时会返回键名本身，不会导致程序崩溃 */
    locales[locale] = {};
  }
}
