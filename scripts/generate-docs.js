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
}

build();
