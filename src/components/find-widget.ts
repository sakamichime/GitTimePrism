/**
 * ============================================================
 * Find Widget 组件（find-widget.ts）
 * ============================================================
 *
 * 这个组件是 GitTimePrism 提交历史的搜索框，移植自 gitgraph 项目的
 * web/findWidget.ts。它浮动在提交节点图上方，支持按多种字段搜索提交：
 * 作者、提交哈希、提交消息、分支名、标签名、日期、stash selector。
 *
 * 功能特性：
 *   - 实时搜索（输入后 200ms 防抖触发）
 *   - 大小写敏感切换（Aa 按钮）
 *   - 正则表达式模式切换（.* 按钮）
 *   - 上一个/下一个匹配项循环导航（↑/↓ 按钮，或 Shift+Enter/Enter）
 *   - 自动滚动到当前匹配项
 *   - 匹配文本高亮（<span class="findMatch"> 包裹）
 *   - 当前匹配项所在行高亮（.findCurrentCommit 类）
 *   - 正则非法时显示错误提示
 *   - 拒绝零长度匹配（防止正则如 `.*` 导致无限循环）
 *   - 状态持久化（搜索文本、当前匹配、可见性、大小写、正则模式）
 *
 * DOM 结构：
 *   <div class="find-widget">
 *     <input type="text" class="find-input" placeholder="搜索提交..." />
 *     <button class="find-case-sensitive" title="区分大小写">Aa</button>
 *     <button class="find-regex" title="正则表达式">.*</button>
 *     <span class="find-results">0/0</span>
 *     <button class="find-prev">↑</button>
 *     <button class="find-next">↓</button>
 *     <button class="find-close">✕</button>
 *   </div>
 *
 * 搜索字段（与 gitgraph 对齐）：
 *   - Author（作者名）
 *   - Commit Hash（提交哈希，含完整哈希和短哈希）
 *   - Message（提交消息）
 *   - Branch（本地分支名 + 远程分支名）
 *   - Tag（标签名）
 *   - Date（日期）
 *   - Stash selector（stash 选择器，如 stash@{0}）
 *
 * 使用示例：
 *   const findWidget = new FindWidget(
 *     document.getElementById('center-body')!,
 *     repoPath,
 *     () => commitGraph.getCommits(),
 *     (hash) => commitGraph.scrollToCommit(hash),
 *     (hash) => showCommitDetailByHash(hash)
 *   );
 *   findWidget.show();
 * ============================================================
 */

// 导入状态持久化服务（用于保存/恢复 Find Widget 的状态）
import { stateService, type FindWidgetState } from '../services/state-service.js';
// 导入 GitCommit 类型（带 heads/tags/remotes/stash 注解的提交数据）
import type { GitCommit } from '../utils/git-types.js';
// 导入 UNCOMMITTED 常量（未提交变更节点的占位哈希 '*'）
import { UNCOMMITTED } from '../utils/git-utils.js';

/**
 * CSS 类名常量
 *
 * 集中管理所有 CSS 类名，避免拼写错误，便于重构。
 */
const CLASS_FIND_MATCH = 'findMatch';          // 匹配文本高亮的 span 类名
const CLASS_FIND_CURRENT_COMMIT = 'findCurrentCommit';  // 当前匹配项所在行的类名
const CLASS_ACTIVE = 'active';                  // 按钮激活状态（大小写敏感、正则模式开启时）
const CLASS_DISABLED = 'disabled';              // 按钮禁用状态（无匹配项时上一个/下一个按钮）
const CLASS_ERROR = 'error';                    // 错误状态（正则非法时）

/**
 * 输入防抖延迟（毫秒）
 *
 * 用户输入后等待 200ms 才触发搜索，避免快速输入时频繁搜索导致卡顿。
 * 与 gitgraph 项目保持一致。
 */
const INPUT_DEBOUNCE_MS = 200;

/**
 * 短哈希长度
 *
 * 提交哈希在节点图中显示为前 7 位短哈希。
 * 搜索时如果用户输入的 pattern 匹配完整哈希但不匹配短哈希，
 * 仍应视为匹配（与 gitgraph 逻辑一致）。
 */
const SHORT_HASH_LENGTH = 7;

/**
 * Find Widget 搜索框组件
 *
 * 浮动在提交节点图上方的搜索框，支持按多种字段搜索提交。
 */
export class FindWidget {
  /** 节点图容器 DOM 元素（搜索框浮动在此容器上方） */
  private readonly container: HTMLElement;
  /** 当前仓库路径（用于状态持久化的键） */
  private readonly repoPath: string;
  /** 获取当前已加载提交列表的回调函数 */
  private readonly getCommits: () => ReadonlyArray<GitCommit>;
  /** 滚动到指定提交的回调函数（用于导航时自动滚动到匹配项） */
  private readonly scrollToCommit: (hash: string) => void;
  /** 查看提交详情的回调函数（可选，用于"导航时自动加载提交详情"功能） */
  private readonly onViewCommit: ((hash: string) => void) | null;

  /** Find Widget 的根 DOM 元素 */
  private readonly widgetElem: HTMLElement;
  /** 搜索输入框 */
  private readonly inputElem: HTMLInputElement;
  /** 大小写敏感切换按钮 */
  private readonly caseSensitiveBtn: HTMLButtonElement;
  /** 正则模式切换按钮 */
  private readonly regexBtn: HTMLButtonElement;
  /** 匹配结果计数显示（如 "1/5" 或 "0/0"） */
  private readonly resultsElem: HTMLSpanElement;
  /** 上一个匹配按钮 */
  private readonly prevBtn: HTMLButtonElement;
  /** 下一个匹配按钮 */
  private readonly nextBtn: HTMLButtonElement;
  /** 关闭按钮 */
  private readonly closeBtn: HTMLButtonElement;

  /** 当前搜索文本 */
  private text: string = '';
  /** 当前所有匹配项列表（每项包含提交哈希和对应的 DOM 行元素） */
  private matches: { hash: string; elem: HTMLElement }[] = [];
  /** 当前选中的匹配项在 matches 数组中的索引；-1 表示无选中 */
  private position: number = -1;
  /** Find Widget 是否可见 */
  private visible: boolean = false;
  /** 是否区分大小写 */
  private isCaseSensitive: boolean = false;
  /** 是否使用正则表达式模式 */
  private isRegex: boolean = false;
  /** 输入防抖定时器 ID */
  private debounceTimer: number | null = null;

  /**
   * 创建 Find Widget 实例
   *
   * @param container - 节点图容器 DOM 元素（搜索框会浮动在此容器内顶部）
   * @param repoPath - 当前仓库路径（用于状态持久化）
   * @param getCommits - 获取当前已加载提交列表的回调
   * @param scrollToCommit - 滚动到指定提交的回调（用于导航时自动滚动）
   * @param onViewCommit - 可选，查看提交详情的回调（用于"导航时自动加载提交详情"）
   */
  constructor(
    container: HTMLElement,
    repoPath: string,
    getCommits: () => ReadonlyArray<GitCommit>,
    scrollToCommit: (hash: string) => void,
    onViewCommit?: (hash: string) => void,
  ) {
    this.container = container;
    this.repoPath = repoPath;
    this.getCommits = getCommits;
    this.scrollToCommit = scrollToCommit;
    this.onViewCommit = onViewCommit ?? null;

    // 创建 Find Widget 的 DOM 结构
    this.widgetElem = document.createElement('div');
    this.widgetElem.className = 'find-widget';
    this.widgetElem.innerHTML = `
      <input type="text" class="find-input" placeholder="搜索提交..." />
      <button class="find-case-sensitive" title="区分大小写" type="button">Aa</button>
      <button class="find-regex" title="正则表达式" type="button">.*</button>
      <span class="find-results">0/0</span>
      <button class="find-prev" title="上一个匹配 (Shift+Enter)" type="button">↑</button>
      <button class="find-next" title="下一个匹配 (Enter)" type="button">↓</button>
      <button class="find-close" title="关闭 (Esc)" type="button">✕</button>
    `;

    // 将 Find Widget 添加到节点图容器内（浮动在上方）
    this.container.appendChild(this.widgetElem);

    // 获取各个子元素的引用
    this.inputElem = this.widgetElem.querySelector('.find-input') as HTMLInputElement;
    this.caseSensitiveBtn = this.widgetElem.querySelector('.find-case-sensitive') as HTMLButtonElement;
    this.regexBtn = this.widgetElem.querySelector('.find-regex') as HTMLButtonElement;
    this.resultsElem = this.widgetElem.querySelector('.find-results') as HTMLSpanElement;
    this.prevBtn = this.widgetElem.querySelector('.find-prev') as HTMLButtonElement;
    this.nextBtn = this.widgetElem.querySelector('.find-next') as HTMLButtonElement;
    this.closeBtn = this.widgetElem.querySelector('.find-close') as HTMLButtonElement;

    // 初始状态下没有匹配项，上一个/下一个按钮禁用
    this.prevBtn.classList.add(CLASS_DISABLED);
    this.nextBtn.classList.add(CLASS_DISABLED);

    // 绑定事件
    this.bindEvents();
  }

  /**
   * 绑定所有事件监听器
   *
   * 包括：
   * - 输入框 keyup（防抖搜索 + Enter/Shift+Enter 导航）
   * - 大小写敏感按钮 click
   * - 正则模式按钮 click
   * - 上一个/下一个按钮 click
   * - 关闭按钮 click
   */
  private bindEvents(): void {
    // 输入框 keyup 事件
    // - Enter：跳到下一个匹配项
    // - Shift+Enter：跳到上一个匹配项
    // - 其他按键：防抖 200ms 后触发搜索
    this.inputElem.addEventListener('keyup', (e) => {
      if (e.key === 'Enter' && this.text !== '') {
        // Enter / Shift+Enter：导航匹配项
        if (e.shiftKey) {
          this.prev();
        } else {
          this.next();
        }
        e.preventDefault();
      } else {
        // 其他按键：防抖搜索
        if (this.debounceTimer !== null) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = window.setTimeout(() => {
          this.debounceTimer = null;
          // 检查文本是否真的变化了（避免无用搜索）
          if (this.text !== this.inputElem.value) {
            this.text = this.inputElem.value;
            this.clearMatches();
            this.findMatches(this.getCurrentHash(), true);
          }
        }, INPUT_DEBOUNCE_MS);
      }
    });

    // 大小写敏感按钮：切换大小写敏感模式
    this.caseSensitiveBtn.addEventListener('click', () => {
      this.isCaseSensitive = !this.isCaseSensitive;
      this.caseSensitiveBtn.classList.toggle(CLASS_ACTIVE, this.isCaseSensitive);
      // 重新搜索（应用新的大小写设置）
      this.clearMatches();
      this.findMatches(this.getCurrentHash(), true);
      this.saveState();
    });

    // 正则模式按钮：切换正则表达式模式
    this.regexBtn.addEventListener('click', () => {
      this.isRegex = !this.isRegex;
      this.regexBtn.classList.toggle(CLASS_ACTIVE, this.isRegex);
      // 重新搜索（应用新的正则设置）
      this.clearMatches();
      this.findMatches(this.getCurrentHash(), true);
      this.saveState();
    });

    // 上一个匹配按钮
    this.prevBtn.addEventListener('click', () => this.prev());

    // 下一个匹配按钮
    this.nextBtn.addEventListener('click', () => this.next());

    // 关闭按钮
    this.closeBtn.addEventListener('click', () => this.hide());

    // 输入框 keydown：Esc 关闭搜索框
    this.inputElem.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.hide();
      }
    });
  }

  /**
   * 显示 Find Widget
   *
   * 将搜索框从隐藏状态切换为可见状态，并聚焦输入框。
   * 如果之前有保存的搜索文本，会恢复到输入框中。
   */
  public show(): void {
    if (!this.visible) {
      this.visible = true;
      this.inputElem.value = this.text;
      this.widgetElem.classList.add(CLASS_ACTIVE);
      // 如果有搜索文本，立即执行搜索
      if (this.text !== '') {
        this.clearMatches();
        this.findMatches(this.getCurrentHash(), false);
      } else {
        this.updatePosition(-1, false);
      }
    }
    // 聚焦输入框，方便用户立即输入
    this.inputElem.focus();
    this.saveState();
  }

  /**
   * 隐藏 Find Widget
   *
   * 将搜索框从可见状态切换为隐藏状态，并清除所有匹配高亮。
   * 保留搜索文本（下次显示时恢复），但清除匹配项。
   */
  public hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.widgetElem.classList.remove(CLASS_ACTIVE);
    this.clearMatches();
    this.matches = [];
    this.position = -1;
    this.updateResultsDisplay();
    this.prevBtn.classList.add(CLASS_DISABLED);
    this.nextBtn.classList.add(CLASS_DISABLED);
    this.widgetElem.classList.remove(CLASS_ERROR);
    this.saveState();
  }

  /**
   * 切换 Find Widget 的显示/隐藏状态
   */
  public toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Find Widget 是否可见
   *
   * @returns true=可见，false=隐藏
   */
  public isVisible(): boolean {
    return this.visible;
  }

  /**
   * 刷新 Find Widget 的匹配项
   *
   * 在提交列表变化后（如刷新节点图、加载更多提交）调用此方法，
   * 重新执行搜索以更新匹配项。
   */
  public refresh(): void {
    if (this.visible) {
      this.clearMatches();
      this.findMatches(this.getCurrentHash(), false);
    }
  }

  /**
   * 获取当前匹配项的提交哈希
   *
   * @returns 当前匹配项的提交哈希；如果没有匹配项则返回 null
   */
  public getCurrentHash(): string | null {
    return this.position > -1 ? this.matches[this.position].hash : null;
  }

  /**
   * 查找所有匹配项
   *
   * 此方法是 Find Widget 的核心，负责：
   * 1. 根据当前搜索文本和模式（大小写/正则）构造正则表达式
   * 2. 遍历所有提交，检查是否匹配（搜索字段：作者、哈希、消息、分支、标签、日期、stash）
   * 3. 对匹配的提交，在 DOM 中高亮匹配的文本（用 <span class="findMatch"> 包裹）
   * 4. 更新匹配项列表和当前位置
   *
   * 正则处理：
   * - 非正则模式：转义用户输入中的特殊字符（如 . * + ? 等）
   * - 正则模式：直接使用用户输入作为正则表达式
   * - 非法正则：在搜索框上显示错误状态，不执行搜索
   * - 零长度匹配：拒绝并显示错误（防止如 `.*` 导致无限循环）
   *
   * @param goToCommitHash - 如果此哈希的提交匹配，直接定位到此提交（而非第一个匹配项）
   * @param scrollToCommit - 是否滚动到当前匹配项使其可见
   */
  private findMatches(goToCommitHash: string | null, scrollToCommit: boolean): void {
    this.matches = [];
    this.position = -1;

    if (this.text !== '') {
      // 构造正则表达式
      // - 正则模式：直接使用用户输入
      // - 非正则模式：转义所有正则特殊字符，作为字面量匹配
      const regexText = this.isRegex
        ? this.text
        : this.text.replace(/[\\\[\](){}|.*+?^$]/g, '\\$&');
      // 标志：u=UTF-16 模式，i=不区分大小写（除非启用大小写敏感）
      const flags = 'u' + (this.isCaseSensitive ? '' : 'i');

      let findPattern: RegExp | null;
      let findGlobalPattern: RegExp | null;
      try {
        // 单次匹配模式（用于 test 检查是否匹配）
        findPattern = new RegExp(regexText, flags);
        // 全局匹配模式（用于 exec 提取所有匹配位置以高亮）
        findGlobalPattern = new RegExp(regexText, 'g' + flags);
        this.widgetElem.classList.remove(CLASS_ERROR);
      } catch (e) {
        // 正则非法：显示错误，不执行搜索
        findPattern = null;
        findGlobalPattern = null;
        this.widgetElem.classList.add(CLASS_ERROR);
        this.inputElem.setAttribute('title', `正则表达式错误: ${e instanceof Error ? e.message : String(e)}`);
      }

      if (findPattern !== null && findGlobalPattern !== null) {
        // 获取所有提交行 DOM 元素（按 data-row 顺序排列）
        const commitElems = this.getCommitElems();
        let domIndex = 0;
        let zeroLengthMatch = false;

        // 遍历所有提交，检查是否匹配
        const commits = this.getCommits();
        for (let i = 0; i < commits.length; i++) {
          const commit = commits[i];

          // 跳过未提交变更虚拟节点（不参与搜索）
          if (commit.hash === UNCOMMITTED) continue;

          // 检查此提交是否匹配搜索条件
          // 搜索字段：作者、提交哈希（完整+短）、消息、分支（本地+远程）、标签、日期、stash
          if (this.commitMatches(commit, findPattern)) {
            // 找到对应的 DOM 行元素（通过 data-id 匹配，与 gitgraph 逻辑一致）
            const idStr = i.toString();
            while (domIndex < commitElems.length && commitElems[domIndex].dataset.row !== idStr) {
              domIndex++;
            }
            if (domIndex === commitElems.length) continue;

            const commitElem = commitElems[domIndex];
            this.matches.push({ hash: commit.hash, elem: commitElem });

            // 在 DOM 中高亮匹配的文本
            this.highlightMatchesInElement(commitElem, findGlobalPattern);

            if (zeroLengthMatch) break;
          }
        }

        // 检测到零长度匹配：清除所有匹配并显示错误
        if (zeroLengthMatch) {
          this.widgetElem.classList.add(CLASS_ERROR);
          this.inputElem.setAttribute('title', '正则表达式不能产生零长度匹配');
          this.clearMatches();
          this.matches = [];
        }
      }
    } else {
      // 无搜索文本：清除错误状态
      this.widgetElem.classList.remove(CLASS_ERROR);
      this.inputElem.removeAttribute('title');
    }

    // 根据匹配项数量更新按钮状态
    this.prevBtn.classList.toggle(CLASS_DISABLED, this.matches.length === 0);
    this.nextBtn.classList.toggle(CLASS_DISABLED, this.matches.length === 0);

    // 确定初始位置
    let newPos = -1;
    if (this.matches.length > 0) {
      newPos = 0;
      // 如果指定了 goToCommitHash 且该提交在匹配项中，直接定位到它
      if (goToCommitHash !== null) {
        const pos = this.matches.findIndex((m) => m.hash === goToCommitHash);
        if (pos > -1) newPos = pos;
      }
    }
    this.updatePosition(newPos, scrollToCommit);
  }

  /**
   * 检查单个提交是否匹配搜索条件
   *
   * 搜索字段（与 gitgraph 对齐）：
   * - 作者名（author）
   * - 提交哈希（完整 hash 或短 hash）
   * - 提交消息（message）
   * - 本地分支名（heads 中的每个分支名）
   * - 远程分支名（remotes 中的每个，含 remote 前缀）
   * - 标签名（tags 中的每个标签名）
   * - 日期（格式化为本地日期字符串）
   * - stash 选择器（如果该提交是 stash）
   *
   * @param commit - 提交数据
   * @param pattern - 已构造的正则表达式
   * @returns true=匹配，false=不匹配
   */
  private commitMatches(commit: GitCommit, pattern: RegExp): boolean {
    // 作者名匹配
    if (pattern.test(commit.author)) return true;

    // 提交哈希匹配：完整哈希以 pattern 开头，或短哈希匹配
    const shortHash = commit.hash.substring(0, SHORT_HASH_LENGTH);
    if (commit.hash.search(pattern) === 0 || pattern.test(shortHash)) return true;

    // 提交消息匹配
    if (pattern.test(commit.message)) return true;

    // 本地分支名匹配（检查每个 head）
    for (const head of commit.heads) {
      if (pattern.test(head)) return true;
    }

    // 远程分支名匹配（检查每个 remote，含 remote 前缀如 origin/main）
    for (const remote of commit.remotes) {
      const remoteName = remote.remote ? `${remote.remote}/${remote.name}` : remote.name;
      if (pattern.test(remoteName)) return true;
      // 也检查不含 remote 前缀的分支名
      if (pattern.test(remote.name)) return true;
    }

    // 标签名匹配（检查每个 tag）
    for (const tag of commit.tags) {
      if (pattern.test(tag.name)) return true;
    }

    // 日期匹配（格式化为本地日期字符串，如 "2024/1/15"）
    const dateStr = new Date(commit.date * 1000).toLocaleDateString('zh-CN');
    if (pattern.test(dateStr)) return true;

    // stash 选择器匹配（如果该提交是 stash）
    if (commit.stash !== null && pattern.test(commit.stash.selector)) return true;

    return false;
  }

  /**
   * 在提交行 DOM 元素中高亮所有匹配的文本
   *
   * 遍历提交行内所有包含文本的节点，用 <span class="findMatch"> 包裹匹配的部分。
   * 此方法直接操作 DOM 文本节点，将匹配的文本片段替换为高亮 span。
   *
   * 注意：此方法会修改 DOM 结构（拆分文本节点），但不影响节点图的 Canvas 渲染。
   *
   * @param commitElem - 提交行 DOM 元素（<tr class="commit-row">）
   * @param globalPattern - 全局匹配正则表达式（带 g 标志）
   */
  private highlightMatchesInElement(commitElem: HTMLElement, globalPattern: RegExp): void {
    // 获取提交行内所有包含文本的节点（作者、提交哈希、提交消息、ref 标签等）
    const textNodes = this.getTextNodes(commitElem);
    let zeroLengthMatch = false;

    for (const textNode of textNodes) {
      const text = textNode.textContent || '';
      if (!text) continue;

      let matchStart = 0;
      let matchEnd = 0;
      let match: RegExpExecArray | null;

      globalPattern.lastIndex = 0;
      while ((match = globalPattern.exec(text)) !== null) {
        // 检测零长度匹配（防止无限循环）
        if (match[0].length === 0) {
          zeroLengthMatch = true;
          break;
        }
        // 如果当前匹配不紧接上一个匹配，先插入中间的普通文本
        if (matchEnd !== match.index) {
          if (matchStart !== matchEnd) {
            // 插入上一个匹配的高亮 span
            textNode.parentNode!.insertBefore(
              this.createMatchElem(text.substring(matchStart, matchEnd)),
              textNode,
            );
          }
          // 插入两个匹配之间的普通文本
          textNode.parentNode!.insertBefore(
            document.createTextNode(text.substring(matchEnd, match.index)),
            textNode,
          );
          matchStart = match.index;
        }
        matchEnd = globalPattern.lastIndex;
      }

      // 处理尾部：如果有匹配，插入最后一个高亮 span 和剩余文本
      if (matchEnd > 0) {
        if (matchStart !== matchEnd) {
          textNode.parentNode!.insertBefore(
            this.createMatchElem(text.substring(matchStart, matchEnd)),
            textNode,
          );
        }
        if (matchEnd !== text.length) {
          // 最后一个匹配后面还有普通文本
          textNode.textContent = text.substring(matchEnd);
        } else {
          // 最后一个匹配在文本末尾，删除原文本节点
          textNode.parentNode!.removeChild(textNode);
        }
      }

      if (zeroLengthMatch) break;
    }
  }

  /**
   * 获取元素内所有文本节点
   *
   * 使用 TreeWalker 遍历元素内的所有文本节点（nodeType === Node.TEXT_NODE）。
   * 排除空文本节点（仅包含空白字符的节点不参与搜索）。
   *
   * @param elem - 要搜索的元素
   * @returns 文本节点数组
   */
  private getTextNodes(elem: HTMLElement): Text[] {
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(elem, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        // 跳过空文本节点
        if (!node.textContent || node.textContent.trim() === '') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }
    return textNodes;
  }

  /**
   * 创建匹配高亮的 span 元素
   *
   * @param text - 要高亮的文本内容
   * @returns 高亮 span 元素（<span class="findMatch">text</span>）
   */
  private createMatchElem(text: string): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = CLASS_FIND_MATCH;
    span.textContent = text;
    return span;
  }

  /**
   * 清除所有匹配高亮
   *
   * 遍历所有匹配项，将 <span class="findMatch"> 元素恢复为普通文本节点。
   * 同时移除当前匹配项所在行的 findCurrentCommit 类。
   */
  private clearMatches(): void {
    for (let i = 0; i < this.matches.length; i++) {
      // 移除当前匹配项所在行的样式
      if (i === this.position) {
        this.matches[i].elem.classList.remove(CLASS_FIND_CURRENT_COMMIT);
      }

      // 查找并恢复所有高亮 span
      const matchElems = this.matches[i].elem.querySelectorAll('.' + CLASS_FIND_MATCH);
      matchElems.forEach((matchElem) => {
        const text = matchElem.textContent || '';
        // 合并前后相邻的文本节点（避免拆分过细）
        let combinedText = text;
        let prevNode = matchElem.previousSibling;
        let prevElem = matchElem.previousElementSibling;
        while (prevNode && prevNode !== prevElem && prevNode.textContent) {
          combinedText = prevNode.textContent + combinedText;
          prevNode.parentNode!.removeChild(prevNode);
          prevNode = matchElem.previousSibling;
        }
        let nextNode = matchElem.nextSibling;
        let nextElem = matchElem.nextElementSibling;
        while (nextNode && nextNode !== nextElem && nextNode.textContent) {
          combinedText = combinedText + nextNode.textContent;
          nextNode.parentNode!.removeChild(nextNode);
          nextNode = matchElem.nextSibling;
        }
        // 用合并后的文本节点替换高亮 span
        matchElem.parentNode!.replaceChild(document.createTextNode(combinedText), matchElem);
      });
    }
  }

  /**
   * 更新当前匹配位置
   *
   * @param position - 新的匹配位置索引（-1 表示无选中）
   * @param scrollToCommit - 是否滚动到当前匹配项使其可见
   */
  private updatePosition(position: number, scrollToCommit: boolean): void {
    // 移除上一个当前位置的样式
    if (this.position > -1 && this.matches[this.position]) {
      this.matches[this.position].elem.classList.remove(CLASS_FIND_CURRENT_COMMIT);
    }

    this.position = position;

    // 为新当前位置添加样式
    if (this.position > -1 && this.matches[this.position]) {
      this.matches[this.position].elem.classList.add(CLASS_FIND_CURRENT_COMMIT);
      // 滚动到当前匹配项
      if (scrollToCommit) {
        this.scrollToCommit(this.matches[position].hash);
      }
    }

    this.updateResultsDisplay();
    this.saveState();
  }

  /**
   * 更新匹配结果计数显示
   *
   * 显示格式：
   * - 有匹配项："当前位置/总数"（如 "1/5"）
   * - 无匹配项："0/0"
   */
  private updateResultsDisplay(): void {
    if (this.matches.length > 0) {
      this.resultsElem.textContent = `${this.position + 1}/${this.matches.length}`;
    } else {
      this.resultsElem.textContent = '0/0';
    }
  }

  /**
   * 跳转到上一个匹配项
   *
   * 循环导航：如果在第一个匹配项，跳转到最后一个。
   */
  public prev(): void {
    if (this.matches.length === 0) return;
    const newPos = this.position > 0 ? this.position - 1 : this.matches.length - 1;
    this.updatePosition(newPos, true);
    this.openCommitDetailsIfEnabled();
  }

  /**
   * 跳转到下一个匹配项
   *
   * 循环导航：如果在最后一个匹配项，跳转到第一个。
   */
  public next(): void {
    if (this.matches.length === 0) return;
    const newPos = this.position < this.matches.length - 1 ? this.position + 1 : 0;
    this.updatePosition(newPos, true);
    this.openCommitDetailsIfEnabled();
  }

  /**
   * 如果启用了"自动加载提交详情"功能，加载当前匹配项的提交详情
   *
   * 此功能对应 gitgraph 的 findOpenCommitDetailsView 选项。
   * 当前实现中，如果构造时传入了 onViewCommit 回调，则在导航时自动调用它。
   */
  private openCommitDetailsIfEnabled(): void {
    if (this.onViewCommit) {
      const hash = this.getCurrentHash();
      if (hash !== null) {
        this.onViewCommit(hash);
      }
    }
  }

  /**
   * 获取所有提交行 DOM 元素
   *
   * 从节点图容器中查找所有 .commit-row 元素，按 data-row 属性（数字）排序。
   *
   * @returns 提交行 DOM 元素数组（按 row 顺序排列）
   */
  private getCommitElems(): HTMLElement[] {
    const elems = Array.from(this.container.querySelectorAll('.commit-row')) as HTMLElement[];
    // 按 data-row 属性排序（数字升序）
    elems.sort((a, b) => {
      const rowA = parseInt(a.dataset.row || '0', 10);
      const rowB = parseInt(b.dataset.row || '0', 10);
      return rowA - rowB;
    });
    return elems;
  }

  /**
   * 保存 Find Widget 状态到 state-service
   *
   * 持久化的状态包括：
   * - 搜索文本（text）
   * - 当前匹配项哈希（currentHash）
   * - 是否可见（visible）
   * - 是否区分大小写（isCaseSensitive）
   * - 是否正则模式（isRegex）
   *
   * 这些状态会按仓库路径分别保存，下次打开同一仓库时恢复。
   */
  public saveState(): void {
    const state: FindWidgetState = {
      text: this.text,
      currentHash: this.getCurrentHash(),
      visible: this.visible,
      isCaseSensitive: this.isCaseSensitive,
      isRegex: this.isRegex,
    };

    // 读取当前仓库的完整 WebViewState，更新 findWidget 字段后保存
    const viewState = stateService.loadState(this.repoPath);
    viewState.findWidget = state;
    stateService.saveState(this.repoPath, viewState);
  }

  /**
   * 从 state-service 恢复 Find Widget 状态
   *
   * 在打开仓库后调用，恢复上次关闭时的状态：
   * - 恢复大小写敏感和正则模式设置
   * - 如果上次是可见状态，显示搜索框并恢复搜索文本
   * - 尝试定位到上次选中的匹配项
   */
  public restoreState(): void {
    const viewState = stateService.loadState(this.repoPath);
    const state = viewState.findWidget;

    // 恢复大小写敏感和正则模式设置（按钮状态同步）
    this.isCaseSensitive = state.isCaseSensitive;
    this.isRegex = state.isRegex;
    this.caseSensitiveBtn.classList.toggle(CLASS_ACTIVE, this.isCaseSensitive);
    this.regexBtn.classList.toggle(CLASS_ACTIVE, this.isRegex);

    // 如果上次是可见状态，恢复搜索框
    if (state.visible) {
      this.text = state.text;
      this.show();
      // 如果有搜索文本，尝试定位到上次的匹配项
      if (this.text !== '') {
        this.findMatches(state.currentHash, false);
      }
    }
  }

  /**
   * 销毁 Find Widget
   *
   * 移除 DOM 元素和事件监听器，释放资源。
   * 在关闭仓库或切换仓库时调用。
   */
  public destroy(): void {
    // 清除防抖定时器
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // 清除匹配高亮
    this.clearMatches();
    // 移除 DOM 元素
    if (this.widgetElem.parentNode) {
      this.widgetElem.parentNode.removeChild(this.widgetElem);
    }
  }
}
