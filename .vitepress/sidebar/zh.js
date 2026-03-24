import fs from 'fs';
import path from 'path';

const dataPath = path.resolve(__dirname, '../../data/categories.json');
let appCategories = [];

try {
  const categories = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  appCategories = categories.map(c => ({
    text: `${c.name}`.trim(),
    link: `/home/${c.id}.md`
  }));
} catch (err) {
  console.error('Failed to load categories.json for sidebar:', err);
}

export default [
  {
    text: '关于 App-Discovery',
    items: [
      { text: '项目介绍', link: '/home/index.md' },
    ],
  },
  {
    text: '探索优质项目',
    items: appCategories,
  },
]
