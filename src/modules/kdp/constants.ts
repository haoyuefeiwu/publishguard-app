/**
 * PublishGuard KDP 核心业务常量、积分消耗账本与官方 31 顶级分类。
 */

export const KDP_CREDIT_COSTS = {
  GUARD_FREE_DAILY_ANON_LIMIT: 3, // 未付费游客每日免费快检上限
  GENERATE_OUTLINE: 10, // 生成全书防撞车书名 + 12 节深度大纲
  PREVIEW_CHAPTER_FIRST_FREE: 0, // 第一章免费试读（转化钩子）
  REGENERATE_CHAPTER: 10, // 单章重新生成或封面/内页重新编译（零 LLM 成本快速重打包）
  RECOMPILE_BUNDLE: 10, // 更改书名/封面/规格后重新编译交付包
  COMPILE_IMPORTED_MANUSCRIPT: 60, // 导入自带书稿编译为全套 5 件套资产（$19 Format & Guard Pass）
  GENERATE_FULL_BOOK_BUNDLE: 100, // 18k-22k 词双轨全套资产（EPUB 3 + 印刷级 PDF + 全出血封面）
  AUTO_SANITIZE: 15, // AI 一键洗稿合规脱敏
} as const;

export const KDP_SAFE_CADENCE_DAYS = 7; // 亚马逊防连坐推荐单账号每周最多发布 1 本

export const KDP_PRIMARY_CATEGORIES = [
  'Arts & Photography',
  'Biographies & Memoirs',
  'Business & Money',
  'Calendars',
  "Children's Books",
  'Christian Books & Bibles',
  'Comics & Graphic Novels',
  'Computers & Technology',
  'Cookbooks, Food & Wine',
  'Crafts, Hobbies & Home',
  'Education & Teaching',
  'Engineering & Transportation',
  'Health, Fitness & Dieting',
  'History',
  'Humor & Entertainment',
  'Law',
  'LGBTQ+',
  'Literature & Fiction',
  'Medical Books',
  'Mystery, Thriller & Suspense',
  'Parenting & Relationships',
  'Politics & Social Sciences',
  'Reference',
  'Religion & Spirituality',
  'Romance',
  'Science & Math',
  'Science Fiction & Fantasy',
  'Self-Help',
  'Sports & Outdoors',
  'Teen & Young Adult',
  'Travel',
] as const;

export const KDP_COVER_THEMES = [
  {
    id: 'editorial_split',
    name: 'Penguin Editorial Split',
    nameZh: '企鹅双段学术编辑风',
    description: 'Deep navy upper block + warm ivory typographic band',
    descriptionZh: '深海蓝上分栏搭配暖象牙白衬线底栏',
    previewBg: '#1E2D3B',
    previewAccent: '#C97A40',
  },
  {
    id: 'asymmetric_hbr',
    name: 'Harvard Left Accent',
    nameZh: '哈佛非对称左专栏风',
    description:
      'Crimson left structural pillar with crisp slate & gold hierarchy',
    descriptionZh: '深红左侧结构柱与暗夜石板金线排版',
    previewBg: '#141A24',
    previewAccent: '#8C2D2D',
  },
  {
    id: 'ivory_monograph',
    name: 'Classic Ivory Monograph',
    nameZh: '经典象牙白衬线专著风',
    description: 'Centered academic treatise layout on museum cream stock',
    descriptionZh: '博物馆米白纸感居中经典衬线专著',
    previewBg: '#F4EFE6',
    previewAccent: '#7A4E2D',
  },
  {
    id: 'minimal_architectural',
    name: 'Minimal Architectural Grid',
    nameZh: '现代建筑极简细线风',
    description: 'Midnight slate canvas with electric cyan hairline accents',
    descriptionZh: '极简深灰底色配几何细线建筑网格',
    previewBg: '#0F172A',
    previewAccent: '#38BDF8',
  },
] as const;
