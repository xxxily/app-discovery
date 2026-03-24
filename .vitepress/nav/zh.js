import fs from 'fs';
import path from 'path';

// Instead of hardcoding categories, read them from data/categories.json
const dataPath = path.resolve(__dirname, '../../data/categories.json');
let appCategories = [];

try {
  const categories = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  appCategories = categories.map(c => ({
    text: `${c.name}`.trim(),
    link: `/home/${c.id}.md`
  }));
} catch (err) {
  console.error('Failed to load categories.json for nav:', err);
}

export default [
  { text: '快速开始', link: '/home/' },
  {
    text: '相关连接',
    ariaLabel: '相关连接',
    items: [
      {
        text: 'ANZZ',
        items: [
          { text: '图灵跳动官网', link: 'https://anzz.site', target: '_blank' },
          { text: '全网热榜聚合', link: 'https://dailyhot.anzz.site', target: '_blank' },
          { text: 'ANZZ.READ', link: 'https://pages.anzz.site', target: '_blank' },
          { text: 'h5player', link: 'https://h5player.anzz.site', target: '_blank' },
        ]
      },
      {
        text: '相关项目',
        items: [
          { text: 'App-Discovery', link: 'https://github.com/xxxily/app-discovery', target: '_blank' },
          { text: 'h5player', link: 'https://github.com/xxxily/h5player', target: '_blank' },
          { text: 'Fiddler-plus', link: 'https://github.com/xxxily/Fiddler-plus', target: '_blank' },
          { text: 'code-flux', link: 'https://github.com/xxxily/code-flux', target: '_blank' },
          { text: 'ffmpeg-script', link: 'https://github.com/xxxily/ffmpeg-script', target: '_blank' },
        ]
      },
    ]
  },
  {
    text: '项目分类',
    ariaLabel: '项目分类',
    items: [
      {
        text: '应用分类',
        items: appCategories
      }
    ]
  },
]
