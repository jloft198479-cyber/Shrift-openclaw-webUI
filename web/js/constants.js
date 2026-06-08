/**
 * constants.js — 项目常量定义
 *
 * 职责：集中管理所有魔法数字，便于维护和修改
 *
 * 使用方式：
 *   Constants.TIMEOUT.TOAST_DEFAULT
 *   Constants.SIZE.MAX_FILE
 *   Constants.LIMIT.MAX_CHARS
 */

const Constants = {

  // ═══ 超时时间（毫秒）═══

  TIMEOUT: {
    /** Toast 默认显示时长 */
    TOAST_DEFAULT: 2500,
    /** Toast 错误提示显示时长 */
    TOAST_ERROR: 3000,
    /** Toast 信息提示显示时长 */
    TOAST_INFO: 3000,
    /** Toast 警告提示显示时长 */
    TOAST_WARNING: 4000,
    /** Toast 严重错误显示时长 */
    TOAST_CRITICAL: 5000,
    /** Toast 消失动画持续时间 */
    TOAST_FADE: 300,
    /** 复制成功提示持续时长 */
    COPY_FEEDBACK: 1500,
    /** API 请求超时 */
    API_TIMEOUT: 15000,
    /** SSE 重连基础延迟 */
    SSE_RECONNECT_BASE: 3000,
    /** SSE 重连最大延迟 */
    SSE_RECONNECT_MAX: 30000,
    /** 服务器重启后延迟刷新 */
    RESTART_REFRESH_DELAY: 2500,
    /** 重试连接后延迟显示等待界面 */
    RETRY_DELAY: 1000,
    /** 提示标签点击动画持续时间 */
    TAG_ANIMATION: 300,
  },

  // ═══ 尺寸限制（像素）═══

  SIZE: {
    /** 输入框自动调整高度的最大值 */
    INPUT_MAX_HEIGHT: 160,
    /** Agent 区域最小高度 */
    AGENT_MIN_HEIGHT: 80,
    /** Agent 区域默认高度 fallback */
    AGENT_DEFAULT_HEIGHT: 200,
    /** Agent 区域最大高度（视口百分比） */
    AGENT_MAX_HEIGHT_RATIO: 0.7,
    /** 侧边栏最小宽度 */
    SIDEBAR_MIN_WIDTH: 180,
    /** 侧边栏最大宽度 */
    SIDEBAR_MAX_WIDTH: 400,
    /** Agent 列表默认最大高度 */
    AGENT_LIST_MAX_HEIGHT: 240,
    /** Agent 列表高度计算偏移 */
    AGENT_LIST_HEIGHT_OFFSET: 320,
    /** 滚动区域 overflow 阈值 */
    SCROLL_OVERFLOW_THRESHOLD: 60,
    /** "用户已上滚"检测阈值（距底部） */
    SCROLL_UP_THRESHOLD: 200,
    /** @提及弹出框宽度估算值 */
    MENTION_POPUP_WIDTH_ESTIMATE: 200,
    /** @提及字符宽度估算值 */
    MENTION_CHAR_WIDTH: 8,
    /** 下拉菜单距按钮底部间距 */
    MENU_OFFSET_BOTTOM: 4,
    /** 下拉菜单距离视口底部的安全间距 */
    MENU_VIEWPORT_SAFE: 10,
    /** 下拉菜单向上翻转时距按钮顶部间距 */
    MENU_OFFSET_TOP: 4,
  },

  // ═══ 文件大小（字节）═══

  FILE: {
    /** 1KB */
    KB: 1024,
    /** 1MB */
    MB: 1048576,
  },

  // ═══ 限制值 ═══

  LIMIT: {
    /** 输入框最大字符数 */
    MAX_CHARS: 8000,
    /** 字符计数开始显示的阈值（百分比） */
    CHAR_COUNT_SHOW_RATIO: 0.6,
    /** 字符计数变红色警告的阈值（百分比） */
    CHAR_COUNT_WARN_RATIO: 0.85,
    /** 长会话最多渲染的消息条数 */
    MAX_VISIBLE_MESSAGES: 200,
    /** 错误消息截断长度 */
    ERROR_MESSAGE_TRUNCATE: 200,
    /** Markdown LRU 缓存最大条目数 */
    MD_CACHE_MAX: 64,
    /** Agent 名称输入框最大长度 */
    AGENT_NAME_MAXLENGTH: 20,
    /** Agent 简介输入框最大长度 */
    AGENT_DESC_MAXLENGTH: 40,
    /** Agent prompt textarea 行数 */
    AGENT_PROMPT_ROWS: 15,
    /** 新建会话时从用户输入截取名称的长度 */
    SESSION_NAME_TRUNCATE: 40,
    /** 附件卡片中文件名显示截断长度 */
    ATTACHMENT_NAME_TRUNCATE: 20,
    /** 附件卡片中文件名截取长度（加省略号） */
    ATTACHMENT_NAME_SLICE: 18,
    /** 附件栏中文件名显示截断长度 */
    ATTACHMENT_BAR_NAME_TRUNCATE: 14,
    /** 附件栏中文件名截取长度（加省略号） */
    ATTACHMENT_BAR_NAME_SLICE: 12,
  },

  // ═══ 时间阈值（毫秒）═══

  TIME: {
    /** 1 分钟 */
    MINUTE: 60000,
    /** 1 小时 */
    HOUR: 3600000,
    /** 1 天 */
    DAY: 86400000,
  },

  // ═══ 正则表达式 ═══

  REGEX: {
    /** 附件行匹配：emoji 前缀 + 空格 + 文件名（用于提取附件信息） */
    ATTACHMENT_LINE: /^[\u{1F5BC}\u{1F4C4}\u{1F4E6}\u{1F4DD}\u{1F4CA}\u{1F4C3}\u{1F4CE}]\s+(.+)$/u,
    /** 附件行检测：仅判断是否为附件行（不捕获） */
    ATTACHMENT_LINE_TEST: /^[\u{1F5BC}\u{1F4C4}\u{1F4E6}\u{1F4DD}\u{1F4CA}\u{1F4C3}\u{1F4CE}]\s/u,
  },

  // ═══ 分页/步长 ═══

  PAGINATION: {
    /** uid 生成时随机字符串截取起始位置 */
    UID_SLICE_START: 2,
    /** uid 生成时随机字符串截取结束位置 */
    UID_SLICE_END: 6,
  },
};

// ═══ 向后兼容：保留原有常量 ═══

