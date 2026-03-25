import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataFile = path.join(__dirname, '../data/projects.json');
const categoriesFile = path.join(__dirname, '../data/categories.json');
const docsDir = path.join(__dirname, '../home');

function generateMarkdown(category, projects) {
  let md = `# ${category.name}\n\n`;
  md += `> ${category.description}\n\n`;

  const count = projects.length;

  if (count === 0) {
    md += `*目前该分类下暂无收录项目，我们正在努力搜罗中，敬请期待！*\n`;
    return md;
  }

  md += `> 当前分类已收录 **${count}** 个相关项目。\n\n`;

  // Sort by stars
  const sortedProjects = [...projects].sort((a, b) => (b.stars || 0) - (a.stars || 0));

  // Render each project
  sortedProjects.forEach(project => {
    md += `## [${project.name}](${project.url})\n\n`;
    md += `${project.description}\n\n`;

    const tags = Array.isArray(project.tags) ? project.tags.map(t => `\`${t}\``).join(' ') : '';
    const platforms = Array.isArray(project.platforms) ? project.platforms.map(p => `**${p}**`).join(', ') : 'N/A';
    const stars = project.stars ? (project.stars >= 1000 ? (project.stars / 1000).toFixed(1) + 'k' : project.stars) : 'N/A';

    md += `- **Platforms:** ${platforms}\n`;
    md += `- **Stars:** ⭐️ ${stars}\n`;
    md += `- **Tags:** ${tags || '无'}\n`;

    if (project.lastUpdated && project.lastUpdated !== 'unknown') {
      const d = new Date(project.lastUpdated);
      if (!isNaN(d.getTime())) {
        md += `- **最后活动时间:** ${d.toISOString().slice(0, 10)}\n`;
      }
    }
    md += `\n`;
  });

  return md;
}

/**
 * Update README files with stats
 */
function updateReadmes(stats) {
  const lastUpdated = new Date(stats.lastUpdated).toISOString().split('T')[0];

  const catMapping = {
    trending: '🔥 Trending',
    productivity: '🚀 Productivity & Collaboration',
    utilities: '🛠️ System Utilities',
    media: '🎬 Media & Multimedia',
    communication: '💬 Social & Communication',
    graphics: '🎨 Graphics & Design',
    internet: '🌐 Internet Tools & Browsers',
    security: '🛡️ Security & Privacy',
    developer: '👨‍💻 Developer Tools',
    ai_apps: '🤖 AI Assistants',
    learning: '📚 Learning & Education',
    finance: '💹 Finance & Accounting',
    entertainment: '🎮 Entertainment & Gaming',
    customization: '💎 Customization & Enhancements'
  };

  const generateStatsMd = (isChinese) => {
    let md = `<!-- STATS_START -->\n`;
    if (isChinese) {
      md += `## 📊 项目统计\n\n`;
      md += `*此项目已收录应用软件相关的优质开源项目概况如下：*\n\n`;
      md += `- 📁 **收录总量**：${stats.totalProjects}\n`;
      md += `- 🏷️ **分类概览**：\n`;
      for (const key in stats.categories) {
        const cat = stats.categories[key];
        md += `  - ${cat.name}：${cat.count}\n`;
      }
      md += `- 📅 **最后更新**：${lastUpdated}\n`;
    } else {
      md += `## 📊 Project Statistics\n\n`;
      md += `*This project has collected high-quality open-source application projects as follows:*\n\n`;
      md += `- 📁 **Total Projects**: ${stats.totalProjects}\n`;
      md += `- 🏷️ **Categories**:\n`;
      for (const key in stats.categories) {
        const cat = stats.categories[key];
        const engName = catMapping[key] || cat.name;
        md += `  - ${engName}: ${cat.count}\n`;
      }
      md += `- 📅 **Last Updated**: ${lastUpdated}\n`;
    }
    md += `<!-- STATS_END -->`;
    return md;
  };

  const files = [
    { path: path.join(__dirname, '../README.md'), isChinese: false, anchor: '## Overview' },
    { path: path.join(__dirname, '../README-zh.md'), isChinese: true, anchor: '## 概述' },
    { path: path.join(__dirname, '../home/index.md'), isChinese: true, anchor: '## 概述' }
  ];

  files.forEach(file => {
    if (!fs.existsSync(file.path)) return;

    let content = fs.readFileSync(file.path, 'utf-8');
    const statsMd = generateStatsMd(file.isChinese);

    const startMarker = '<!-- STATS_START -->';
    const endMarker = '<!-- STATS_END -->';

    if (content.includes(startMarker) && content.includes(endMarker)) {
      // Replace existing
      const regex = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'g');
      content = content.replace(regex, statsMd);
    } else {
      // Insert before anchor
      if (content.includes(file.anchor)) {
        content = content.replace(file.anchor, `${statsMd}\n\n${file.anchor}`);
      } else {
        console.warn(`Anchor ${file.anchor} not found in ${file.path}`);
      }
    }

    fs.writeFileSync(file.path, content, 'utf-8');
    console.log(`Updated stats in: ${file.path}`);
  });
}

function build() {
  if (!fs.existsSync(dataFile) || !fs.existsSync(categoriesFile)) {
    console.error('Data or categories file not found.');
    process.exit(1);
  }

  const projectDb = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  const categoriesDb = JSON.parse(fs.readFileSync(categoriesFile, 'utf-8'));

  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const stats = {
    totalProjects: projectDb.projects.length,
    categories: {},
    platforms: {},
    lastUpdated: new Date().toISOString()
  };

  // 1. Generate Category Pages
  categoriesDb.forEach((category) => {
    const catProjects = projectDb.projects.filter(p => 
      Array.isArray(p.categories) && p.categories.includes(category.id)
    );

    stats.categories[category.id] = {
      name: category.name,
      count: catProjects.length
    };

    const mdContent = generateMarkdown(category, catProjects);
    const outputPath = path.join(docsDir, `${category.id}.md`);
    fs.writeFileSync(outputPath, mdContent, 'utf-8');
    console.log(`Generated category doc: ${outputPath} (${catProjects.length} items)`);
  });

  // 2. Generate Platform Pages
  const platforms = ["Windows", "macOS", "Android", "iOS", "Linux", "Web"];
  platforms.forEach(platform => {
    const platformProjects = projectDb.projects.filter(p => 
      Array.isArray(p.platforms) && p.platforms.includes(platform)
    );

    if (platformProjects.length > 0) {
      stats.platforms[platform] = platformProjects.length;
      
      const pseudoCategory = {
        name: `${platform} 应用软件`,
        description: `专为 ${platform} 平台打造的高质量应用与工具。`
      };
      const mdContent = generateMarkdown(pseudoCategory, platformProjects);
      const outputName = platform.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const outputPath = path.join(docsDir, `platform-${outputName}.md`);
      fs.writeFileSync(outputPath, mdContent, 'utf-8');
      console.log(`Generated platform doc: ${outputPath} (${platformProjects.length} items)`);
    }
  });

  const statsPath = path.join(__dirname, '../data/stats.json');
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), 'utf-8');
  console.log(`Generated stats: ${statsPath}`);

  // Sync stats to READMEs
  updateReadmes(stats);

  console.log('\nDocs generation completed successfully.');
}

build();
